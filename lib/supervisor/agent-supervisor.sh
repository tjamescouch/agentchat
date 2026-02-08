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

# Validate auth in container mode
if [ "$CONTAINER_MODE" = true ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN environment variable is required in container mode"
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

    # Build MCP config inline
    MCP_CONFIG="{\"mcpServers\":{\"agentchat\":{\"command\":\"npx\",\"args\":[\"-y\",\"@tjamescouch/agentchat-mcp\"],\"env\":{\"AGENTCHAT_PUBLIC\":\"true\"}}}}"

    # Select settings file based on agent role
    if [[ "$AGENT_NAME" == *"fetch"* ]]; then
        SETTINGS_FILE="$HOME/.claude/settings-fetcher.json"
    else
        SETTINGS_FILE="$HOME/.claude/settings.json"
    fi

    # Run claude with the mission
    START_TIME=$(date +%s)

    if claude -p "Read ~/.claude/agentchat.skill.md and connect to $SERVER_URL. Your name is '$AGENT_NAME'. Your mission: $MISSION. Connect ephemerally and join the public channel." \
        --model opus \
        --betas extended-thinking-2025-05-06 \
        --dangerously-skip-permissions \
        --permission-mode bypassPermissions \
        --mcp-config "$MCP_CONFIG" \
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
