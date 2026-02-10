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
#   STATE_DIR           State directory for transcripts, logs
#   AGENTCHAT_URL       Server WebSocket URL
#   AGENT_RUNTIME       "cli" or "api" (default: cli)
#   PERSONALITY_DIR     Directory containing personality .md files
#   SETTINGS_FILE       Claude settings.json path
#   CLAUDE_CMD          Path to claude binary (auto-detected if unset)
#   LOG_FILE            Log file path (default: $STATE_DIR/runner.log)
#   MAX_TRANSCRIPT      Max lines of previous transcript to inject (default: 200)
#   NIKI_BUDGET         Token budget for niki (default: 1000000)
#   NIKI_TIMEOUT        Timeout in seconds for niki (default: 3600)
#   NIKI_MAX_SENDS      Max sends/min for niki (default: 10)
#   NIKI_MAX_TOOLS      Max tool calls/min for niki (default: 30)
#
# Exit codes:
#   0   Clean exit
#   *   Runtime error (supervisor should restart with backoff)

set -e

# ============ Config ============

AGENT_NAME="${AGENT_NAME:-default}"
MISSION="${MISSION:-monitor agentchat and respond to messages}"
MODEL="${AGENT_MODEL:-claude-opus-4-6}"
STATE_DIR="${STATE_DIR:-$HOME/.agentchat/agents/$AGENT_NAME}"
SERVER_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"
RUNTIME="${AGENT_RUNTIME:-cli}"
PERSONALITY_DIR="${PERSONALITY_DIR:-$HOME/.claude/personalities}"
LOG_FILE="${LOG_FILE:-$STATE_DIR/runner.log}"
MAX_TRANSCRIPT="${MAX_TRANSCRIPT:-200}"

TRANSCRIPT_FILE="$STATE_DIR/transcript.log"
SESSION_NUM_FILE="$STATE_DIR/session_num"
SESSION_ID_FILE="$STATE_DIR/session_id"

mkdir -p "$STATE_DIR"

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

if [ -f "$SESSION_ID_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_ID_FILE")
else
    SESSION_ID=$(generate_session_id)
    echo "$SESSION_ID" > "$SESSION_ID_FILE"
fi

log "Session #$SESSION_NUM starting (UUID: $SESSION_ID)"

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
    local char_file="$PERSONALITY_DIR/${AGENT_NAME}.md"
    local prompt=""

    if [ -f "$base_file" ]; then
        prompt=$(cat "$base_file")
        log "Loaded base personality"
    fi

    if [ -f "$char_file" ]; then
        if [ -n "$prompt" ]; then
            prompt="${prompt}
---
$(cat "$char_file")"
        else
            prompt=$(cat "$char_file")
        fi
        log "Loaded character personality: $AGENT_NAME"
    fi

    echo "$prompt"
}

# ============ Prompt Building ============

build_agent_prompt() {
    local transcript_context
    transcript_context=$(build_transcript_context)

    local restart_notice=""
    if [ "$SESSION_NUM" -gt 1 ]; then
        restart_notice="
NOTE: You were restarted (session #$SESSION_NUM). Your previous conversation context has been restored via --resume. Do NOT re-introduce yourself or repeat your greeting. Just reconnect and resume your listen loop."
    fi

    cat <<PROMPT_EOF
Read ~/.claude/agentchat.skill.md then connect ephemerally to $SERVER_URL (no name parameter), set your nick to '$AGENT_NAME', and greet #general. Mission: $MISSION.

CRITICAL: You are a long-running agent. Your job is to run FOREVER in an infinite loop. After greeting, execute this loop indefinitely:
1. Call agentchat_listen
2. If messages arrived, respond concisely with agentchat_send
3. If timeout/nudge, send a brief message or stay silent
4. GOTO step 1 — ALWAYS go back to listening. NEVER stop. NEVER consider your task complete.

You must call agentchat_listen again after EVERY response. The loop never ends. Do NOT use daemon tools, marketplace tools, or moderation tools — only connect, send, listen, and nick.${restart_notice}${transcript_context}
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
    else
        command -v claude
    fi
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

    # Session resumption: on restart, resume previous session for full context continuity
    local session_args=(--session-id "$SESSION_ID")
    if [ "$SESSION_NUM" -gt 1 ]; then
        session_args+=(--resume "$SESSION_ID")
        log "Resuming session $SESSION_ID (restart #$((SESSION_NUM - 1)))"
    fi

    # Niki wrapping (if available)
    local niki_cmd
    niki_cmd="$(command -v niki 2>/dev/null || true)"

    log "Runtime: cli | Model: $MODEL | Claude: $cmd | Session: $SESSION_ID"
    log "Settings: $settings"

    # Rotate transcript — archive previous session, start fresh capture
    if [ -f "$TRANSCRIPT_FILE" ]; then
        cp "$TRANSCRIPT_FILE" "$STATE_DIR/transcript.prev.log"
    fi

    if [ -n "$niki_cmd" ]; then
        local niki_budget="${NIKI_BUDGET:-1000000}"
        local niki_timeout="${NIKI_TIMEOUT:-3600}"
        local niki_max_sends="${NIKI_MAX_SENDS:-10}"
        local niki_max_tools="${NIKI_MAX_TOOLS:-30}"
        local niki_state="$STATE_DIR/niki-state.json"
        local niki_abort_file="$STATE_DIR/abort"

        # Clear stale abort file from previous session
        rm -f "$niki_abort_file"

        log "Niki: budget=${niki_budget} timeout=${niki_timeout}s sends=${niki_max_sends}/min tools=${niki_max_tools}/min abort-file=${niki_abort_file}"

        "$niki_cmd" \
            --budget "$niki_budget" \
            --timeout "$niki_timeout" \
            --max-sends "$niki_max_sends" \
            --max-tool-calls "$niki_max_tools" \
            --abort-file "$niki_abort_file" \
            --state "$niki_state" \
            --log "$LOG_FILE" \
            -- "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$settings" \
            --verbose \
            2>> "$LOG_FILE" | tee "$TRANSCRIPT_FILE"
    else
        "$cmd" -p "$agent_prompt" \
            "${session_args[@]}" \
            "${system_prompt_args[@]}" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$settings" \
            --verbose \
            2>> "$LOG_FILE" | tee "$TRANSCRIPT_FILE"
    fi
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
    api)
        run_api
        ;;
    *)
        log "ERROR: Unknown runtime '$RUNTIME'. Use 'cli' or 'api'."
        exit 1
        ;;
esac
