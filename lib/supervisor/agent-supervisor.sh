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

    if "$CLAUDE_CMD" -p "Read ~/.claude/agentchat.skill.md then connect ephemerally to $SERVER_URL (no name parameter), set your nick to '$AGENT_NAME', and greet #general. Mission: $MISSION. Enter a listen loop. On each message, respond concisely then listen again. On timeout, send a brief check-in then listen again. Never exit unless there is an error. Do NOT use daemon tools, marketplace tools, or moderation tools — only connect, send, listen, and nick." \
        --model "$MODEL" \
        --dangerously-skip-permissions \
        --permission-mode bypassPermissions \
        --settings "$SETTINGS_FILE" \
        --verbose \
        2>> "$LOG_FILE"; then
        # Clean exit
        log "Agent exited cleanly"
        BACKOFF=$MIN_BACKOFF
    else
        EXIT_CODE=$?
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))

        log "Agent crashed (exit code $EXIT_CODE, ran for ${DURATION}s)"
        save_state "crashed" "exit_code=$EXIT_CODE"

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
