#!/bin/bash
# Agent Supervisor — manages agent lifecycle with automatic restart and backoff
#
# This script handles ONLY lifecycle concerns:
#   - PID management, stop signals, heartbeats
#   - Restart loop with exponential backoff
#   - OAuth token loading (container mode)
#   - MCP server registration
#   - Exit code analysis (niki kills, crashes)
#
# All runtime logic (prompt building, personality loading, transcript
# persistence, claude invocation) lives in agent-runner.sh.
#
# Usage: ./agent-supervisor.sh <agent-name> <mission>

set -e

AGENT_NAME="${1:-default}"
MISSION="${2:-monitor agentchat and respond to messages}"
STATE_DIR="$HOME/.agentchat/agents/$AGENT_NAME"
LOG_FILE="$STATE_DIR/supervisor.log"
PID_FILE="$STATE_DIR/supervisor.pid"
STOP_FILE="$STATE_DIR/stop"
STATE_FILE="$STATE_DIR/state.json"

# Locate the runner (same directory as this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -x "$SCRIPT_DIR/agent-runner.sh" ]; then
    RUNNER="$SCRIPT_DIR/agent-runner.sh"
elif [ -x "$SCRIPT_DIR/agent-runner" ]; then
    RUNNER="$SCRIPT_DIR/agent-runner"
else
    echo "ERROR: agent-runner not found in $SCRIPT_DIR"
    exit 1
fi

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

RUNNER_PID=""

cleanup() {
    log "Supervisor shutting down"
    # Forward SIGTERM to runner so niki → claude can flush session state
    if [ -n "$RUNNER_PID" ] && kill -0 "$RUNNER_PID" 2>/dev/null; then
        log "Forwarding SIGTERM to runner (PID $RUNNER_PID)"
        kill -TERM "$RUNNER_PID" 2>/dev/null || true
        # Wait for graceful shutdown (claude session flush)
        local i=0
        while [ $i -lt 8 ] && kill -0 "$RUNNER_PID" 2>/dev/null; do
            sleep 1
            i=$((i + 1))
        done
        if kill -0 "$RUNNER_PID" 2>/dev/null; then
            log "Runner still alive after ${i}s, force killing"
            kill -KILL "$RUNNER_PID" 2>/dev/null || true
        fi
    fi
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

# MCP config is pre-baked in settings.json and passed via --mcp-config in the runner.
# No runtime registration needed.

log "Using runner: $RUNNER"

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

    START_TIME=$(date +%s)

    # Export config for the runner
    export AGENT_NAME MISSION STATE_DIR LOG_FILE

    # Run the agent via the runner abstraction layer
    # Background + wait so SIGTERM trap can interrupt and forward signal
    "$RUNNER" &
    RUNNER_PID=$!
    set +e
    wait $RUNNER_PID 2>/dev/null
    EXIT_CODE=$?
    set -e
    RUNNER_PID=""

    if [ $EXIT_CODE -eq 0 ]; then
        # Clean exit
        log "Agent exited cleanly"
        BACKOFF=$MIN_BACKOFF
    else
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))

        # Check if niki killed the agent (read niki state file)
        NIKI_STATE="$STATE_DIR/niki-state.json"
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

    # === Memory curation between sessions ===
    # Run lucidity curator to curate transcript into tree.json
    # and emit skill.md so the agent boots with memory context.
    # Uses curator-run.sh (which tries curator.js, then ghost, then fallback).
    LUCIDITY_DIR="$HOME/lucidity/src"
    CURATOR_SCRIPT="$LUCIDITY_DIR/curator-run.sh"
    # Store tree.json in STATE_DIR (volume-mounted, persists across container rebuilds)
    TREE_FILE="$STATE_DIR/tree.json"
    SKILL_FILE="$HOME/.claude/agentchat.skill.md"
    TRANSCRIPT_FILE_FOR_CURATION="$STATE_DIR/transcript.log"

    if [ -x "$CURATOR_SCRIPT" ]; then
        log "Running memory curation (curator-run.sh)..."
        mkdir -p "$(dirname "$TREE_FILE")"
        if "$CURATOR_SCRIPT" \
            --agent "$AGENT_NAME" \
            --tree "$TREE_FILE" \
            --transcript "$TRANSCRIPT_FILE_FOR_CURATION" \
            --output "$SKILL_FILE" 2>> "$LOG_FILE"; then
            log "Memory curation complete — skill.md updated"
        else
            log "Memory curation failed (non-fatal, continuing)"
        fi
    elif [ -f "$LUCIDITY_DIR/curator.js" ] && command -v node > /dev/null 2>&1; then
        # Fallback: call curator.js directly if curator-run.sh isn't executable
        log "Running memory curation (curator.js direct)..."
        mkdir -p "$(dirname "$TREE_FILE")"
        CURATE_ARGS="--agent $AGENT_NAME --tree $TREE_FILE --output $SKILL_FILE"
        if [ -f "$TRANSCRIPT_FILE_FOR_CURATION" ] && [ -s "$TRANSCRIPT_FILE_FOR_CURATION" ]; then
            CURATE_ARGS="$CURATE_ARGS --transcript $TRANSCRIPT_FILE_FOR_CURATION --curate"
        fi
        if node "$LUCIDITY_DIR/curator.js" $CURATE_ARGS 2>> "$LOG_FILE"; then
            log "Memory curation complete — skill.md updated"
        else
            log "Memory curation failed (non-fatal, continuing)"
        fi
    fi

    # Check for stop signal before sleeping
    if [ -f "$STOP_FILE" ]; then
        log "Stop file detected, shutting down"
        rm -f "$STOP_FILE"
        cleanup
    fi

    log "Waiting ${BACKOFF}s before restart..."
    sleep $BACKOFF
done
