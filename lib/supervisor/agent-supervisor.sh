#!/bin/bash
# Agent Supervisor - manages Claude agent lifecycle with automatic restart and backoff
# Usage: ./agent-supervisor.sh <agent-name> <mission>

set -e

AGENT_NAME="${1:-default}"
MISSION="${2:-monitor agentchat and respond to messages}"
STATE_DIR="$HOME/.agentchat/agents/$AGENT_NAME"
LOG_FILE="$STATE_DIR/supervisor.log"
PID_FILE="$STATE_DIR/supervisor.pid"
STOP_FILE="$STATE_DIR/stop"
STATE_FILE="$STATE_DIR/state.json"

# Detect container environment
if [ -f /.dockerenv ] || [ -f /run/.containerenv ] || grep -qE 'docker|libpod' /proc/1/cgroup 2>/dev/null; then
    CONTAINER_MODE=true
else
    CONTAINER_MODE=false
fi

# Load OAuth token from secrets file if available (P0-SANDBOX-2)
# Token is mounted as a file rather than env var to prevent agent reads.
TOKEN_FILE="/run/secrets/oauth-token"
if [ -f "$TOKEN_FILE" ]; then
    CLAUDE_CODE_OAUTH_TOKEN=$(cat "$TOKEN_FILE")
    export CLAUDE_CODE_OAUTH_TOKEN
    # Delete the file so the agent process cannot read it later.
    # (The export makes it available to child processes already launched.)
    rm -f "$TOKEN_FILE" 2>/dev/null || true
fi

# Validate auth in container mode
if [ "$CONTAINER_MODE" = true ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "ERROR: OAuth token required. Mount at /run/secrets/oauth-token or set CLAUDE_CODE_OAUTH_TOKEN."
    exit 1
fi

# Model configuration
MODEL="${AGENT_MODEL:-claude-opus-4-6}"  # Default to Opus 4.6, can override with AGENT_MODEL env var

# Backoff settings
MIN_BACKOFF=5
MAX_BACKOFF=300
BACKOFF_MULTIPLIER=2

mkdir -p "$STATE_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

save_state() {
    local status="$1"
    local error="$2"
    cat > "$STATE_FILE" << EOF
{
  "agent_name": "$AGENT_NAME",
  "mission": "$MISSION",
  "status": "$status",
  "last_error": "$error",
  "restart_count": $RESTART_COUNT,
  "started_at": "$STARTED_AT",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid": $$
}
EOF
}

cleanup() {
    log "Supervisor shutting down"
    save_state "stopped" ""
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check if already running (in container mode, always clean stale PID)
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if [ "$CONTAINER_MODE" = true ]; then
        rm -f "$PID_FILE"
    elif ps -p "$OLD_PID" > /dev/null 2>&1; then
        log "Supervisor already running (PID $OLD_PID)"
        exit 1
    fi
fi

echo $$ > "$PID_FILE"
rm -f "$STOP_FILE"

RESTART_COUNT=0
BACKOFF=$MIN_BACKOFF
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "Starting supervisor for agent '$AGENT_NAME'"
log "Mission: $MISSION"
save_state "starting" ""

# Register MCP server before first run (ensures tools are available in -p mode)
# Use the supervisor binary (claude was renamed during Docker build)
log "Registering agentchat MCP server..."
if [ -x /usr/local/bin/.claude-supervisor ]; then
    AGENTCHAT_PUBLIC=true /usr/local/bin/.claude-supervisor mcp add -s user -e AGENTCHAT_PUBLIC=true agentchat -- agentchat-mcp 2>> "$LOG_FILE" || log "MCP registration failed (may already exist)"
else
    AGENTCHAT_PUBLIC=true claude mcp add -s user -e AGENTCHAT_PUBLIC=true agentchat -- agentchat-mcp 2>> "$LOG_FILE" || log "MCP registration failed (may already exist)"
fi

while true; do
    # Check for stop signal
    if [ -f "$STOP_FILE" ]; then
        log "Stop file detected, shutting down"
        rm -f "$STOP_FILE"
        cleanup
    fi

    # Update heartbeat for health checks
    touch "$STATE_DIR/.heartbeat"

    log "Starting agent (attempt $((RESTART_COUNT + 1)), backoff ${BACKOFF}s)"
    save_state "running" ""

    # Get server URL from environment
    SERVER_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"

    # Select settings file based on agent role
    if [[ "$AGENT_NAME" == *"fetch"* ]]; then
        SETTINGS_FILE="$HOME/.claude/settings-fetcher.json"
    else
        SETTINGS_FILE="$HOME/.claude/settings.json"
    fi

    # Run claude with the mission
    START_TIME=$(date +%s)

    # Remove claude CLI from PATH after first invocation to prevent
    # the AI agent from spawning additional claude sessions (P0-SANDBOX-1)
    # Use the hidden supervisor binary (renamed during Docker build)
    # Falls back to regular claude if not renamed (bare metal)
    if [ -x /usr/local/bin/.claude-supervisor ]; then
        CLAUDE_CMD="/usr/local/bin/.claude-supervisor"
    else
        CLAUDE_CMD="$(command -v claude)"
    fi

    # Niki configuration (deterministic supervisor)
    NIKI_BUDGET="${NIKI_BUDGET:-1000000}"         # 1M tokens default
    NIKI_TIMEOUT="${NIKI_TIMEOUT:-3600}"           # 1 hour default
    NIKI_MAX_SENDS="${NIKI_MAX_SENDS:-10}"         # 10 sends/min default
    NIKI_MAX_TOOLS="${NIKI_MAX_TOOLS:-30}"         # 30 tool calls/min default
    NIKI_STATE="$STATE_DIR/niki-state.json"
    NIKI_CMD="$(command -v niki 2>/dev/null)"

    # Build the claude command
    AGENT_PROMPT="Read ~/.claude/agentchat.skill.md then connect ephemerally to $SERVER_URL (no name parameter), set your nick to '$AGENT_NAME', and greet #general. Mission: $MISSION.

CRITICAL: You are a long-running agent. Your job is to run FOREVER in an infinite loop. After greeting, execute this loop indefinitely:
1. Call agentchat_listen
2. If messages arrived, respond concisely with agentchat_send
3. If timeout/nudge, send a brief message or stay silent
4. GOTO step 1 — ALWAYS go back to listening. NEVER stop. NEVER consider your task complete.

You must call agentchat_listen again after EVERY response. The loop never ends. If you stop looping, you will be restarted and lose all conversation context. Do NOT use daemon tools, marketplace tools, or moderation tools — only connect, send, listen, and nick."

    # Load personality: base + character-specific persona
    BASE_PERSONALITY="$HOME/.claude/personalities/_base.md"
    CHAR_PERSONALITY="$HOME/.claude/personalities/${AGENT_NAME}.md"
    SYSTEM_PROMPT_ARGS=()
    SYSTEM_PROMPT=""
    if [ -f "$BASE_PERSONALITY" ]; then
        SYSTEM_PROMPT=$(cat "$BASE_PERSONALITY")
    fi
    if [ -f "$CHAR_PERSONALITY" ]; then
        SYSTEM_PROMPT="${SYSTEM_PROMPT}
---
$(cat "$CHAR_PERSONALITY")"
    fi
    if [ -n "$SYSTEM_PROMPT" ]; then
        SYSTEM_PROMPT_ARGS=(--system-prompt "$SYSTEM_PROMPT")
        log "Loaded personality (base=$([ -f "$BASE_PERSONALITY" ] && echo yes || echo no) char=$([ -f "$CHAR_PERSONALITY" ] && echo yes || echo no))"
    fi

    if [ -n "$NIKI_CMD" ]; then
        # Run under niki supervision
        log "Running under niki (budget=${NIKI_BUDGET} timeout=${NIKI_TIMEOUT}s sends=${NIKI_MAX_SENDS}/min)"
        "$NIKI_CMD" \
            --budget "$NIKI_BUDGET" \
            --timeout "$NIKI_TIMEOUT" \
            --max-sends "$NIKI_MAX_SENDS" \
            --max-tool-calls "$NIKI_MAX_TOOLS" \
            --state "$NIKI_STATE" \
            --log "$LOG_FILE" \
            -- "$CLAUDE_CMD" -p "$AGENT_PROMPT" \
            "${SYSTEM_PROMPT_ARGS[@]}" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$SETTINGS_FILE" \
            --verbose \
            2>> "$LOG_FILE"
    else
        "$CLAUDE_CMD" -p "$AGENT_PROMPT" \
            "${SYSTEM_PROMPT_ARGS[@]}" \
            --model "$MODEL" \
            --dangerously-skip-permissions \
            --permission-mode bypassPermissions \
            --settings "$SETTINGS_FILE" \
            --verbose \
            2>> "$LOG_FILE"
    fi
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        # Clean exit
        log "Agent exited cleanly"
        BACKOFF=$MIN_BACKOFF
    else
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))

        # Check if niki killed the agent (read niki state file)
        NIKI_REASON=""
        if [ -f "$NIKI_STATE" ]; then
            NIKI_REASON=$(grep -o '"killedBy"[[:space:]]*:[[:space:]]*"[^"]*"' "$NIKI_STATE" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"//')
        fi

        if [ -n "$NIKI_REASON" ] && [ "$NIKI_REASON" != "null" ]; then
            log "Agent killed by niki (reason: $NIKI_REASON, exit code $EXIT_CODE, ran for ${DURATION}s)"
            save_state "killed" "niki_reason=$NIKI_REASON"
        else
            log "Agent crashed (exit code $EXIT_CODE, ran for ${DURATION}s)"
            save_state "crashed" "exit_code=$EXIT_CODE"
        fi

        # If it ran for more than 5 minutes, reset backoff
        if [ $DURATION -gt 300 ]; then
            BACKOFF=$MIN_BACKOFF
            log "Ran long enough, resetting backoff"
        else
            # Exponential backoff
            BACKOFF=$((BACKOFF * BACKOFF_MULTIPLIER))
            if [ $BACKOFF -gt $MAX_BACKOFF ]; then
                BACKOFF=$MAX_BACKOFF
            fi
        fi
    fi

    RESTART_COUNT=$((RESTART_COUNT + 1))

    # Check for stop signal before sleeping
    if [ -f "$STOP_FILE" ]; then
        log "Stop file detected, shutting down"
        rm -f "$STOP_FILE"
        cleanup
    fi

    log "Waiting ${BACKOFF}s before restart..."
    sleep $BACKOFF
done
