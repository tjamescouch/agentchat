#!/bin/bash
# Agent Runner — runtime-agnostic agent execution wrapper
#
# The agnosticizing layer between the supervisor and the actual runtime.
# Takes a unified config (env vars), handles personality loading, transcript
# persistence, and runtime selection. Today wraps `claude -p`, tomorrow
# can call the Anthropic API directly.
#
# Env vars (all optional, sensible defaults):
#   AGENT_NAME          Agent display name (default: "default")
#   MISSION             Mission string
#   AGENT_MODEL         Model ID (default: claude-opus-4-6)
#   AGENT_SUMMARIZER_MODEL  Model for context summarization (optional, defaults to gro's built-in)
#   AGENT_CONTEXT_TOKENS    Context window budget for gro (default: 32768)
#   STATE_DIR           State directory for transcripts, logs
#   AGENTCHAT_URL       Server WebSocket URL
#   AGENT_RUNTIME       "cli", "gro", or "api" (default: gro)
#   PERSONALITY_DIR     Directory containing personality .md files
#   SETTINGS_FILE       Claude settings.json path
#   CLAUDE_CMD          Path to claude binary (auto-detected if unset)
#   GRO_CMD             Path to gro binary (auto-detected if unset)
#   LOG_FILE            Log file path (default: $STATE_DIR/runner.log)
#   MAX_TRANSCRIPT      Max lines of previous transcript to inject (default: 200)
#   NIKI_BUDGET         Token budget for niki (default: 10000000)
#   NIKI_TIMEOUT        Timeout in seconds for niki (default: 3600)
#   NIKI_MAX_SENDS      Max sends/min for niki (default: 10)
#   NIKI_MAX_TOOLS      Max tool calls/min for niki (default: 30)
#   NIKI_STALL_TIMEOUT  Seconds of no output before stall kill (default: 3600, 0=disabled)
#                       High default because agentchat_listen blocks up to 1 hour legitimately.
#   NIKI_STARTUP_TIMEOUT Longer stall timeout until first output (default: 600, 0=use stall-timeout)
#   NIKI_DEAD_AIR_TIMEOUT Minutes of zero CPU + zero output before kill (default: 5, 0=disabled)
#   NIKI_MAX_NUDGES     Max stdin nudge attempts on stall (default: 3)
#
# Exit codes:
#   0   Clean exit
# Optional args:
#   --use-gro         Force gro runtime
#   --use-claude-code Force CLI runtime (Claude Code)
#
# Version:
#   --version | -v
# Maintainer: Sabrina (@vwgo4spd)
# Build stamp vars can be injected by the image build:
#   AGENT_RUNNER_SOURCE_COMMIT, AGENT_RUNNER_BUILD_DATE

#   *   Runtime error (supervisor should restart with backoff)

set -e

VERSION="${AGENT_RUNNER_VERSION:-0.0.0}"
SOURCE_COMMIT="${AGENT_RUNNER_SOURCE_COMMIT:-unknown}"
BUILD_DATE="${AGENT_RUNNER_BUILD_DATE:-unknown}"
MAINTAINER="Sabrina (@vwgo4spd)"

# ============ Config ============
# Minimal argv parsing for runtime selection
while [ $# -gt 0 ]; do
    case "$1" in
        --version|-v)
            echo "agent-runner version=${VERSION} commit=${SOURCE_COMMIT} built=${BUILD_DATE} maintainer=${MAINTAINER}"
            exit 0
            ;;
        --use-gro)
            AGENT_RUNTIME=gro
            shift
            ;;
        --use-claude-code)
            AGENT_RUNTIME=cli
            shift
            ;;
        --)
            shift
            break
            ;;
        *)
            break
            ;;
    esac
done


AGENT_NAME="${AGENT_NAME:-default}"
MISSION="${MISSION:-monitor agentchat and respond to messages}"
MODEL="${AGENT_MODEL:-claude-opus-4-6}"
CONTEXT_TOKENS="${AGENT_CONTEXT_TOKENS:-32768}"
STATE_DIR="${STATE_DIR:-$HOME/.agentchat/agents/$AGENT_NAME}"
SERVER_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"
RUNTIME="${AGENT_RUNTIME:-gro}"

# Injection controls. By default, when running with gro we want gro to be the
# single context authority, so we disable prompt-time injection unless
# explicitly enabled.
if [ "$RUNTIME" = "gro" ]; then
    INJECT_TRANSCRIPT_DEFAULT=0
    INJECT_MEMORY_DEFAULT=0
else
    INJECT_TRANSCRIPT_DEFAULT=1
    INJECT_MEMORY_DEFAULT=1
fi

INJECT_TRANSCRIPT="${INJECT_TRANSCRIPT:-$INJECT_TRANSCRIPT_DEFAULT}"
INJECT_MEMORY="${INJECT_MEMORY:-$INJECT_MEMORY_DEFAULT}"
USE_LUCIDITY="${USE_LUCIDITY:-0}"

PERSONALITY_DIR="${PERSONALITY_DIR:-$HOME/.claude/personalities}"
LOG_FILE="${LOG_FILE:-$STATE_DIR/runner.log}"
MAX_TRANSCRIPT="${MAX_TRANSCRIPT:-200}"

TRANSCRIPT_FILE="$STATE_DIR/transcript.log"
SESSION_NUM_FILE="$STATE_DIR/session_num"
SESSION_ID_FILE="$STATE_DIR/session_id"

mkdir -p "$STATE_DIR"

# Signal trap for graceful shutdown — forward SIGTERM to child (niki/claude)
# so claude can flush session state before dying.
CHILD_PID=""
graceful_shutdown() {
    if [ -n "$CHILD_PID" ] && kill -0 "$CHILD_PID" 2>/dev/null; then
        kill -TERM "$CHILD_PID" 2>/dev/null || true
        wait "$CHILD_PID" 2>/dev/null || true
    fi
    exit 143
}
trap graceful_shutdown SIGTERM

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [runner] $1" | tee -a "$LOG_FILE"
}

# ============ Session Tracking ============

# Increment session number (persists across restarts)
if [ -f "$SESSION_NUM_FILE" ]; then
    SESSION_NUM=$(( $(cat "$SESSION_NUM_FILE") + 1 ))
else
    SESSION_NUM=1
fi
echo "$SESSION_NUM" > "$SESSION_NUM_FILE"

# Generate deterministic session UUID from agent name (UUID v5)
# Same agent name always gets the same session; changing name starts fresh.
generate_session_id() {
    # UUID v5 with DNS namespace, keyed on "agentchat:<agent-name>"
    python3 -c "import uuid; print(uuid.uuid5(uuid.NAMESPACE_DNS, 'agentchat:$AGENT_NAME'))" 2>/dev/null \
        || uuidgen 2>/dev/null \
        || cat /proc/sys/kernel/random/uuid 2>/dev/null
}

# Only reuse saved session ID if the session was actually created (marker exists).
# Otherwise generate a fresh random UUID to avoid "already in use" errors
# from stale session data in volume-mounted claude-state.
if [ -f "$SESSION_ID_FILE" ] && [ -f "$STATE_DIR/session_created" ]; then
    SESSION_ID=$(cat "$SESSION_ID_FILE")
else
    SESSION_ID=$(uuidgen 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null)
    echo "$SESSION_ID" > "$SESSION_ID_FILE"
    rm -f "$STATE_DIR/session_created"
fi

log "Session #$SESSION_NUM starting (UUID: $SESSION_ID)"

# ============ Memory Injection ============

SKILL_FILE="${HOME}/.claude/agentchat.skill.md"
LUCIDITY_TREE_FILE="${STATE_DIR}/tree.json"

build_memory_context() {
    # If USE_LUCIDITY is enabled, inject tree.json instead of skill.md
    if [ "${USE_LUCIDITY}" = "1" ] || [ "${USE_LUCIDITY}" = "true" ]; then
        if [ -f "$LUCIDITY_TREE_FILE" ] && [ -s "$LUCIDITY_TREE_FILE" ]; then
            local tree_content
            tree_content=$(cat "$LUCIDITY_TREE_FILE" 2>/dev/null)
            if [ -n "$tree_content" ]; then
                log "Injecting lucidity memory tree ($(echo "$tree_content" | wc -l | tr -d ' ') lines)"
                cat <<LUCIDITY_EOF

--- LUCIDITY MEMORY TREE ---
IMPORTANT: This is your memory tree from lucidity. It contains structured knowledge
about your identity, active work, team context, and lessons learned.
The JSON structure has nodes with categories (identity, knowledge, work, team, lesson).

$tree_content
--- END LUCIDITY MEMORY TREE ---
LUCIDITY_EOF
                return
            fi
        else
            log "USE_LUCIDITY=1 but tree file not found or empty: $LUCIDITY_TREE_FILE"
        fi
    fi

    # Fallback to skill.md AGENT_MEMORY section
    if [ ! -f "$SKILL_FILE" ] || [ ! -s "$SKILL_FILE" ]; then
        return
    fi

    # Extract AGENT_MEMORY section if present
    local memory_content
    memory_content=$(sed -n '/<!-- AGENT_MEMORY_START -->/,/<!-- AGENT_MEMORY_END -->/p' "$SKILL_FILE" 2>/dev/null)

    if [ -z "$memory_content" ]; then
        return
    fi

    log "Injecting agent memory from skill.md ($(echo "$memory_content" | wc -l | tr -d ' ') lines)"
    cat <<MEMORY_EOF

--- AGENT MEMORY (loaded from skill.md) ---
IMPORTANT: This is your curated memory from previous sessions. Read it carefully before doing anything else.
It contains your identity, active work, team context, and lessons learned.

$memory_content
--- END AGENT MEMORY ---
MEMORY_EOF
}

# ============ Transcript Injection ============

build_transcript_context() {
    if [ ! -f "$TRANSCRIPT_FILE" ] || [ ! -s "$TRANSCRIPT_FILE" ]; then
        return
    fi

    local lines
    lines=$(tail -"$MAX_TRANSCRIPT" "$TRANSCRIPT_FILE" 2>/dev/null)
    if [ -z "$lines" ]; then
        return
    fi

    log "Injecting transcript from previous session ($(wc -l < "$TRANSCRIPT_FILE" | tr -d ' ') total lines, last $MAX_TRANSCRIPT)"
    cat <<TRANSCRIPT_EOF

--- PREVIOUS SESSION CONTEXT (session #$((SESSION_NUM - 1))) ---
You were restarted. Here is the tail of your previous session's transcript.
Use this to maintain continuity — remember ongoing conversations, context, and commitments.
Do NOT repeat your greeting or re-introduce yourself if you can see you already did.

$lines
--- END PREVIOUS SESSION ---
TRANSCRIPT_EOF
}

# ============ Personality Loading ============

build_system_prompt() {
    local base_file="$PERSONALITY_DIR/_base.md"
    local prompt=""

    if [ -f "$base_file" ]; then
        prompt=$(cat "$base_file")
        log "Loaded base personality"
    fi

    # Load per-agent personality overlay if it exists (e.g., personalities/Sam.md)
    local agent_personality="$PERSONALITY_DIR/${AGENT_NAME}.md"
    if [ -f "$agent_personality" ]; then
        prompt="${prompt}

---
$(cat "$agent_personality")"
        log "Loaded agent personality: $AGENT_NAME"
    fi

    # Public server IP disclaimer — only included when AGENTCHAT_PUBLIC is set
    if [ "${AGENTCHAT_PUBLIC:-}" = "true" ]; then
        local disclaimer="
---
## Public Server Notice
You are connected to a PUBLIC AgentChat server. Important constraints:
- This environment is for personal and open-source work ONLY.
- Do NOT produce code or content that would belong to a user's employer under IP assignment agreements.
- If a user asks you to work on something that appears to be proprietary work-for-hire, remind them that this is a public server and suggest they use a private instance instead.
- Do not store, transmit, or process trade secrets, proprietary code, or confidential business information.
- All work produced here should be suitable for open-source or personal use."
        prompt="${prompt}${disclaimer}"
        log "Added public server IP disclaimer"
    fi

    echo "$prompt"
}

# ============ Prompt Building ============

build_agent_prompt() {
    local transcript_context=""
    if [ "${INJECT_TRANSCRIPT}" = "1" ] || [ "${INJECT_TRANSCRIPT}" = "true" ]; then
        transcript_context=$(build_transcript_context)
    fi

    local memory_context=""
    if [ "${INJECT_MEMORY}" = "1" ] || [ "${INJECT_MEMORY}" = "true" ]; then
        memory_context=$(build_memory_context)
    fi

    local restart_notice=""
    if [ "$SESSION_NUM" -gt 1 ]; then
        restart_notice="
NOTE: You were restarted (session #$SESSION_NUM). Your previous conversation context has been restored via --resume. Do NOT re-introduce yourself or repeat your greeting. Just reconnect and resume your listen loop."
    fi

    cat <<PROMPT_EOF
Read ~/.claude/agentchat.skill.md then connect to $SERVER_URL with name '$AGENT_NAME' (persistent identity), and greet #general. Mission: $MISSION.

You are a long-running agent. You alternate between two modes:

LISTENING (idle state):
1. Call agentchat_listen on your channels
2. If messages arrive, process them
3. If no actionable task, listen again

WORKING (active state):
When you receive a task, claim it and DO THE WORK:
1. Post "CLAIM: <summary>" in chat
2. Execute the task fully — run bash commands, read/write files, whatever is needed
3. Do NOT call agentchat_listen while actively working on a task
4. When done, post results in chat
5. Return to listening mode

Work takes priority over listening. The listen loop is your idle state, not a constraint during active tasks. After completing work, always return to listening.

Do NOT use daemon tools, marketplace tools, or moderation tools — only connect, send, listen, nick, and any tools needed for your assigned work (Bash, Read, Write, Edit, Grep, Glob, etc).${restart_notice}${memory_context}${transcript_context}
PROMPT_EOF
}

# ============ Claude Binary Detection ============

find_claude_cmd() {
    if [ -n "$CLAUDE_CMD" ]; then
        echo "$CLAUDE_CMD"
        return
    fi

    # Container: use hidden supervisor binary (agent can't spawn claude)
    if [ -x /usr/local/bin/.claude-supervisor ]; then
        echo "/usr/local/bin/.claude-supervisor"
    elif command -v claude > /dev/null 2>&1; then
        command -v claude
    else
        echo ""
    fi
}

# ============ Gro Binary Detection ============

find_gro_cmd() {
    # Explicit override
    if [ -n "$GRO_CMD" ]; then
        echo "$GRO_CMD"
        return
    fi

    # 1. npm bin symlink (canonical — created by `npm install -g` from package.json bin field)
    #    This points to dist/main.js (the compiled Node.js runtime), not the bash dispatcher.
    if command -v gro > /dev/null 2>&1; then
        command -v gro
        return
    fi

    # 2. Explicit well-known paths
    if [ -x /usr/local/bin/gro ]; then
        echo "/usr/local/bin/gro"
        return
    fi
    if [ -x "$HOME/.local/bin/gro" ]; then
        echo "$HOME/.local/bin/gro"
        return
    fi

    # 3. Global npm lib — look for compiled dist/main.js, NOT the bash gro script
    local global_npm_gro
    global_npm_gro="$(npm root -g 2>/dev/null)/@tjamescouch/gro/dist/main.js"
    if [ -n "$global_npm_gro" ] && [ -f "$global_npm_gro" ]; then
        echo "$global_npm_gro"
        return
    fi

    # 4. Local npm installs (dev environments) — also prefer dist/main.js
    local local_gro
    local_gro="$(dirname "$(realpath "$0" 2>/dev/null || echo "$0")")/../node_modules/@tjamescouch/gro/dist/main.js"
    if [ -f "$local_gro" ]; then
        echo "$local_gro"
        return
    fi
    if [ -f "./node_modules/@tjamescouch/gro/dist/main.js" ]; then
        echo "./node_modules/@tjamescouch/gro/dist/main.js"
        return
    fi

    echo ""
}

# ============ Settings Detection ============

find_settings_file() {
    if [ -n "$SETTINGS_FILE" ]; then
        echo "$SETTINGS_FILE"
        return
    fi

    # Fetcher agents get restricted settings
    if [[ "$AGENT_NAME" == *"fetch"* ]]; then
        echo "$HOME/.claude/settings-fetcher.json"
    else
        echo "$HOME/.claude/settings.json"
    fi
}

# ============ Runtime: CLI (claude -p) ============

run_cli() {
    local cmd
    cmd=$(find_claude_cmd)

    if [ -z "$cmd" ]; then
        log "ERROR: Claude CLI not found. Checked /usr/local/bin/.claude-supervisor and PATH."
        log "Container may need rebuild. Exiting."
        exit 1
    fi

    local settings
    settings=$(find_settings_file)
    local agent_prompt
    agent_prompt=$(build_agent_prompt)
    local system_prompt
    system_prompt=$(build_system_prompt)

    local system_prompt_args=()
    if [ -n "$system_prompt" ]; then
        system_prompt_args=(--system-prompt "$system_prompt")
    fi

    # Session management:
    # --session-id UUID    → creates new session (fails if exists: "already in use")
    # --resume UUID        → resumes existing (fails if missing: "no conversation found")
    # --session-id + --continue → errors: "requires --fork-session"
    #
    # Strategy: use a marker file to track whether the session has been created.
    # If marker exists → --resume. If not → --session-id (create).
    # On "no conversation found" failure, delete marker so next attempt creates fresh.
    local session_args=()
    local session_marker="$STATE_DIR/session_created"
    if [ -f "$session_marker" ]; then
        session_args=(--resume "$SESSION_ID")
        log "Resuming session $SESSION_ID (restart #$((SESSION_NUM - 1)))"
    else
        session_args=(--session-id "$SESSION_ID")
        log "Creating new session $SESSION_ID"
    fi

    # MCP config inline — belt-and-suspenders with settings.json mcpServers
    local mcp_config='{"mcpServers":{"agentchat":{"command":"agentchat-mcp","args":[],"env":{"AGENTCHAT_PUBLIC":"true"}}}}'

    # Niki wrapping (if available)
    local niki_cmd
    niki_cmd="$(command -v niki 2>/dev/null || true)"

    log "Runtime: cli | Model: $MODEL | Claude: $cmd | Session: $SESSION_ID"
    log "Settings: $settings"

    # Kill stale agentchat-mcp daemons from prior gro sessions before launching.
    # Multiple MCP processes fighting over the same identity cause connection thrash.
    local stale_mcp_pids
    stale_mcp_pids=$(pgrep -f "agentchat-mcp" 2>/dev/null || true)
    if [ -n "$stale_mcp_pids" ]; then
        log "Cleaning up stale agentchat-mcp pids: $stale_mcp_pids"
        echo "$stale_mcp_pids" | xargs kill -TERM 2>/dev/null || true
        sleep 0.5
        echo "$stale_mcp_pids" | xargs kill -KILL 2>/dev/null || true
    fi

    # Rotate transcript — archive previous session, start fresh capture
    if [ -f "$TRANSCRIPT_FILE" ]; then
        cp "$TRANSCRIPT_FILE" "$STATE_DIR/transcript.prev.log"
    fi

    if [ -n "$niki_cmd" ]; then
        local niki_budget="${NIKI_BUDGET:-10000000}"
        local niki_timeout="${NIKI_TIMEOUT:-3600}"
        local niki_max_sends="${NIKI_MAX_SENDS:-10}"
        local niki_max_tools="${NIKI_MAX_TOOLS:-30}"
        local niki_stall_timeout="${NIKI_STALL_TIMEOUT:-3600}"
        local niki_max_nudges="${NIKI_MAX_NUDGES:-3}"
        local niki_state="$STATE_DIR/niki-state.json"
        local niki_abort_file="$STATE_DIR/abort"

        # Clear stale abort file from previous session
        rm -f "$niki_abort_file"

        local niki_startup_timeout="${NIKI_STARTUP_TIMEOUT:-600}"
        local niki_dead_air="${NIKI_DEAD_AIR_TIMEOUT:-1440}"

        log "Niki: budget=${niki_budget} timeout=${niki_timeout}s sends=${niki_max_sends}/min tools=${niki_max_tools}/min startup=${niki_startup_timeout}s stall=${niki_stall_timeout}s dead-air=${niki_dead_air}min abort-file=${niki_abort_file}"

        set +e
        "$niki_cmd" \
            --budget "$niki_budget" \
            --timeout "$niki_timeout" \
            --max-sends "$niki_max_sends" \
            --max-tool-calls "$niki_max_tools" \
            --stall-timeout "$niki_stall_timeout" \
            --startup-timeout "$niki_startup_timeout" \
            --dead-air-timeout "$niki_dead_air" \
            --max-nudges "$niki_max_nudges" \
            --abort-file "$niki_abort_file" \
            --state "$niki_state" \
            -- "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            --model "$MODEL" \
            --mcp-config "$mcp_config" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$settings" \
            2>&1 | tee -a "$LOG_FILE" &
        CHILD_PID=$!
        wait $CHILD_PID 2>/dev/null
        local exit_code=$?
        CHILD_PID=""
        set -e
    else
        set +e
        "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            --model "$MODEL" \
            --mcp-config "$mcp_config" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$settings" \
            2>&1 | tee -a "$LOG_FILE" &
        CHILD_PID=$!
        wait $CHILD_PID 2>/dev/null
        local exit_code=$?
        CHILD_PID=""
        set -e
    fi

    # Session marker management:
    # Only mark session as created if claude actually used tokens (session was established).
    # Error messages (e.g. "already in use") count as output but use 0 tokens.
    local got_output="false"
    local tokens_used=0
    if [ -f "$niki_state" ]; then
        got_output=$(python3 -c "import json; print('true' if json.load(open('$niki_state')).get('gotFirstOutput', False) else 'false')" 2>/dev/null || echo "false")
        tokens_used=$(python3 -c "import json; s=json.load(open('$niki_state')); print(s.get('tokensTotal', s.get('tokensUsed', 0)))" 2>/dev/null || echo 0)
    fi

    if [ "$got_output" = "true" ] && [ "$tokens_used" -gt 0 ]; then
        # Session was established (claude actually ran) — mark for --resume on restart
        if [ ! -f "$session_marker" ]; then
            log "Session $SESSION_ID established ($tokens_used tokens) — marking for resume on restart"
        fi
        touch "$session_marker"
    elif [ -f "$session_marker" ]; then
        # Had a marker but got no output — session may be lost (container rebuild, etc.)
        local niki_duration=0
        if [ -f "$niki_state" ]; then
            niki_duration=$(python3 -c "import json; print(json.load(open('$niki_state')).get('duration',0))" 2>/dev/null || echo 0)
        fi
        if [ "$niki_duration" -lt 10 ]; then
            log "Session $SESSION_ID appears lost (no output in ${niki_duration}s) — clearing marker for fresh create"
            rm -f "$session_marker"
        fi
    fi

    # Check for non-recoverable failures — exit 2 stops supervisor instead of restarting
    local niki_killed_by=""
    if [ -f "$niki_state" ]; then
        niki_killed_by=$(python3 -c "import json; print(json.load(open('$niki_state')).get('killedBy', '') or '')" 2>/dev/null || echo "")
    fi
    if [ "$niki_killed_by" = "budget" ]; then
        log "NON-RECOVERABLE: Token budget exhausted (killedBy=budget)"
        return 2
    fi
    if [ -f "$LOG_FILE" ]; then
        local recent_log
        recent_log=$(tail -50 "$LOG_FILE" 2>/dev/null || echo "")
        if echo "$recent_log" | grep -qiE "(401|unauthorized|invalid.*api.*key|authentication.*failed)"; then
            log "NON-RECOVERABLE: Authentication failure detected in logs"
            return 2
        fi
        if echo "$recent_log" | grep -qiE "(credit balance is too low|credit.*insufficient|Your credit balance)"; then
            log "NON-RECOVERABLE: API credit exhaustion detected"
            return 2
        fi
    fi

    return "$exit_code"
}

# ============ Runtime: Gro (provider-agnostic) ============

run_gro() {
    local cmd
    cmd=$(find_gro_cmd)

    if [ -z "$cmd" ]; then
        log "ERROR: Gro CLI not found. Checked: npm package (@tjamescouch/gro), GRO_CMD, PATH, /usr/local/bin/gro, ~/.local/bin/gro."
        log "Install via npm (npm install @tjamescouch/gro) or set GRO_CMD. Exiting."
        exit 1
    fi

    local agent_prompt
    agent_prompt=$(build_agent_prompt)
    local system_prompt
    system_prompt=$(build_system_prompt)

    local system_prompt_args=()
    if [ -n "$system_prompt" ]; then
        system_prompt_args=(--system-prompt "$system_prompt")
    fi

    # Session management for gro:
    #   -r <id>    → resume specific session
    #   -c         → continue most recent session
    #   (neither)  → new session (auto-generated ID)
    #
    # Strategy: same marker-file approach as run_cli().
    # If marker exists → -r <id>. If not → new session.
    local session_args=()
    local session_marker="$STATE_DIR/gro_session_created"
    local gro_session_id_file="$STATE_DIR/gro_session_id"

    if [ -f "$session_marker" ] && [ -f "$gro_session_id_file" ]; then
        local gro_sid
        gro_sid=$(cat "$gro_session_id_file")
        session_args=(-r "$gro_sid")
        log "Resuming gro session $gro_sid (restart #$((SESSION_NUM - 1)))"
    else
        # New session — gro generates its own session ID.
        # We'll capture it from the session dir after launch.
        log "Creating new gro session"
    fi

    # MCP config — same format as claude, gro reads it natively
    local mcp_config='{"mcpServers":{"agentchat":{"command":"agentchat-mcp","args":[],"env":{"AGENTCHAT_PUBLIC":"true"}}}}'

    # Provider detection — infer from model name.
    # gro auto-detects from model prefix, but explicit -P is safer.
    local provider_args=()
    case "$MODEL" in
        gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
            provider_args=(-P openai)
            ;;
        claude-*|sonnet*|haiku*|opus*)
            provider_args=(-P anthropic)
            ;;
        gemma*|llama*|mistral*|phi*|qwen*|deepseek*)
            provider_args=(-P local)
            ;;
    esac

    # Conditional summarizer model args (only if explicitly set)
    local summarizer_args=()
    if [ -n "$AGENT_SUMMARIZER_MODEL" ]; then
        summarizer_args=(--summarizer-model "$AGENT_SUMMARIZER_MODEL")
    fi

    # Niki wrapping (if available)
    local niki_cmd
    niki_cmd="$(command -v niki 2>/dev/null || true)"

    log "Runtime: gro | Model: $MODEL | Gro: $cmd | Provider: ${provider_args[*]:-auto}"

    # Rotate transcript
    if [ -f "$TRANSCRIPT_FILE" ]; then
        cp "$TRANSCRIPT_FILE" "$STATE_DIR/transcript.prev.log"
    fi

    if [ -n "$niki_cmd" ]; then
        local niki_budget="${NIKI_BUDGET:-10000000}"
        local niki_timeout="${NIKI_TIMEOUT:-3600}"
        local niki_max_sends="${NIKI_MAX_SENDS:-10}"
        local niki_max_tools="${NIKI_MAX_TOOLS:-30}"
        local niki_stall_timeout="${NIKI_STALL_TIMEOUT:-3600}"
        local niki_max_nudges="${NIKI_MAX_NUDGES:-3}"
        local niki_state="$STATE_DIR/niki-state.json"
        local niki_abort_file="$STATE_DIR/abort"
        local niki_startup_timeout="${NIKI_STARTUP_TIMEOUT:-600}"
        local niki_dead_air="${NIKI_DEAD_AIR_TIMEOUT:-1440}"

        rm -f "$niki_abort_file"

        log "Niki: budget=${niki_budget} timeout=${niki_timeout}s sends=${niki_max_sends}/min tools=${niki_max_tools}/min startup=${niki_startup_timeout}s stall=${niki_stall_timeout}s dead-air=${niki_dead_air}min"

        set +e
        "$niki_cmd" \
            --budget "$niki_budget" \
            --timeout "$niki_timeout" \
            --max-sends "$niki_max_sends" \
            --max-tool-calls "$niki_max_tools" \
            --stall-timeout "$niki_stall_timeout" \
            --startup-timeout "$niki_startup_timeout" \
            --dead-air-timeout "$niki_dead_air" \
            --max-nudges "$niki_max_nudges" \
            --abort-file "$niki_abort_file" \
            --state "$niki_state" \
            -- "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            -m "$MODEL" \
            "${provider_args[@]}" \
            --mcp-config "$mcp_config" \
            --max-tool-rounds 1000 \
            "${summarizer_args[@]}" \
            --context-tokens "$CONTEXT_TOKENS" \
            --persistent \
            --max-idle-nudges 3 \
            --bash \
            --name "$AGENT_NAME" \
            --show-diffs \
            2>&1 | tee -a "$LOG_FILE" &
        CHILD_PID=$!
        wait $CHILD_PID 2>/dev/null
        local exit_code=$?
        CHILD_PID=""
        set -e
    else
        set +e
        "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            -m "$MODEL" \
            "${provider_args[@]}" \
            --mcp-config "$mcp_config" \
            --max-tool-rounds 1000 \
            "${summarizer_args[@]}" \
            --context-tokens "$CONTEXT_TOKENS" \
            --persistent \
            --max-idle-nudges 3 \
            --bash \
            --name "$AGENT_NAME" \
            --show-diffs \
            2>&1 | tee -a "$LOG_FILE" &
        CHILD_PID=$!
        wait $CHILD_PID 2>/dev/null
        local exit_code=$?
        CHILD_PID=""
        set -e
    fi

    # Session marker management for gro.
    # Gro stores sessions in .gro/context/<id>/ — detect the latest one.
    local got_output="false"
    local tokens_used=0
    if [ -f "$niki_state" ]; then
        got_output=$(python3 -c "import json; print('true' if json.load(open('$niki_state')).get('gotFirstOutput', False) else 'false')" 2>/dev/null || echo "false")
        tokens_used=$(python3 -c "import json; s=json.load(open('$niki_state')); print(s.get('tokensTotal', s.get('tokensUsed', 0)))" 2>/dev/null || echo 0)
    elif [ -s "$TRANSCRIPT_FILE" ]; then
        # No niki — check if transcript has content
        got_output="true"
        tokens_used=1  # placeholder; we know it ran
    fi

    # For gro: also check if .gro/context/ has session data, even when
    # token count is 0 (gro may not report tokens to niki in all versions).
    local gro_context_dir="${HOME}/.gro/context"
    if [ "$got_output" = "true" ] && { [ "$tokens_used" -gt 0 ] || [ -d "$gro_context_dir" ]; }; then
        # Find the gro session ID from .gro/context/ (most recent by mtime)
        if [ -d "$gro_context_dir" ]; then
            local latest_gro_session
            latest_gro_session=$(ls -t "$gro_context_dir" 2>/dev/null | head -1)
            if [ -n "$latest_gro_session" ]; then
                echo "$latest_gro_session" > "$gro_session_id_file"
                touch "$session_marker"
                log "Gro session $latest_gro_session established ($tokens_used tokens) — marking for resume"
            fi
        fi
    elif [ -f "$session_marker" ]; then
        local niki_duration=0
        if [ -f "$niki_state" ]; then
            niki_duration=$(python3 -c "import json; print(json.load(open('$niki_state')).get('duration',0))" 2>/dev/null || echo 0)
        fi
        if [ "$niki_duration" -lt 10 ]; then
            log "Gro session appears lost (no output in ${niki_duration}s) — clearing marker for fresh create"
            rm -f "$session_marker" "$gro_session_id_file"
        fi
    fi

    # Check for non-recoverable failures — exit 2 stops supervisor instead of restarting
    local niki_killed_by=""
    if [ -f "$niki_state" ]; then
        niki_killed_by=$(python3 -c "import json; print(json.load(open('$niki_state')).get('killedBy', '') or '')" 2>/dev/null || echo "")
    fi
    if [ "$niki_killed_by" = "budget" ]; then
        log "NON-RECOVERABLE: Token budget exhausted (killedBy=budget)"
        return 2
    fi
    if [ -f "$LOG_FILE" ]; then
        local recent_log
        recent_log=$(tail -50 "$LOG_FILE" 2>/dev/null || echo "")
        if echo "$recent_log" | grep -qiE "(401|unauthorized|invalid.*api.*key|authentication.*failed)"; then
            log "NON-RECOVERABLE: Authentication failure detected in logs"
            return 2
        fi
        if echo "$recent_log" | grep -qiE "(credit balance is too low|credit.*insufficient|Your credit balance)"; then
            log "NON-RECOVERABLE: API credit exhaustion detected"
            return 2
        fi
    fi

    return "$exit_code"
}

# ============ Runtime: API (direct Anthropic API) ============

run_api() {
    log "Runtime: api — NOT YET IMPLEMENTED"
    log "Falling back to cli runtime"
    RUNTIME="cli"
    run_cli
}

# ============ Main ============

log "Agent: $AGENT_NAME | Mission: $MISSION | Runtime: $RUNTIME"

case "$RUNTIME" in
    cli)
        run_cli
        ;;
    gro)
        run_gro
        ;;
    api)
        run_api
        ;;
    *)
        log "ERROR: Unknown runtime '$RUNTIME'. Use 'cli', 'gro', or 'api'."
        exit 1
        ;;
esac
