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

# Auth: prefer agentauth proxy (no secrets in container)
# Legacy token-file path kept for backward compat but deprecated.
TOKEN_FILE="/run/secrets/oauth-token"
if [ -n "$ANTHROPIC_BASE_URL" ] && [ "$ANTHROPIC_API_KEY" = "proxy-managed" ]; then
    # Agentauth proxy mode — no real credentials needed in container
    echo "Auth: using agentauth proxy at $ANTHROPIC_BASE_URL"
elif [ -f "$TOKEN_FILE" ]; then
    # Legacy: read token from mounted file (DEPRECATED — use agentauth proxy)
    echo "WARNING: Using legacy token-file auth. Migrate to agentauth proxy."
    CLAUDE_CODE_OAUTH_TOKEN=$(cat "$TOKEN_FILE")
    export CLAUDE_CODE_OAUTH_TOKEN
    rm -f "$TOKEN_FILE" 2>/dev/null || true
elif [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    # Legacy: token passed as env var (DEPRECATED — use agentauth proxy)
    echo "WARNING: Token passed as env var. Migrate to agentauth proxy."
elif [ "$CONTAINER_MODE" = true ]; then
    echo "ERROR: No auth configured. Use agentauth proxy (recommended) or set CLAUDE_CODE_OAUTH_TOKEN."
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
    # Stop live curator first
    stop_live_curator
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

# === Live curation daemon ===
# Runs alongside the agent, curating every CURATION_INTERVAL seconds.
# Forked before the runner, killed when the runner exits.
CURATION_INTERVAL="${CURATION_INTERVAL:-300}"  # 5 minutes
CURATOR_PID=""

# Shared curation paths (also used by between-session curation below)
LUCIDITY_DIR="$HOME/lucidity/src"
CURATOR_SCRIPT="$LUCIDITY_DIR/curator-run.sh"
TREE_FILE="$STATE_DIR/tree.json"
SKILL_FILE="$HOME/.claude/agentchat.skill.md"
# Claude Code writes real conversation logs as JSONL in ~/.claude/projects/.
# The tee-based transcript.log is empty on --resume sessions (stdout is suppressed),
# so we find the most recent JSONL as the transcript source for curation.
CLAUDE_PROJECTS_DIR="$HOME/.claude/projects/-home-agent"

find_active_transcript() {
    # Find the most recently modified JSONL in Claude Code's project dir
    if [ -d "$CLAUDE_PROJECTS_DIR" ]; then
        local newest
        newest=$(find "$CLAUDE_PROJECTS_DIR" -maxdepth 1 -name "*.jsonl" -type f -printf '%T@ %p\n' 2>/dev/null \
            | sort -rn | head -1 | cut -d' ' -f2-)
        # macOS fallback (no -printf)
        if [ -z "$newest" ]; then
            newest=$(ls -t "$CLAUDE_PROJECTS_DIR"/*.jsonl 2>/dev/null | head -1)
        fi
        if [ -n "$newest" ] && [ -s "$newest" ]; then
            echo "$newest"
            return
        fi
    fi
    # Fallback to tee-based transcript if JSONL not found
    if [ -f "$STATE_DIR/transcript.log" ] && [ -s "$STATE_DIR/transcript.log" ]; then
        echo "$STATE_DIR/transcript.log"
    fi
}

run_curation_pass() {
    mkdir -p "$(dirname "$TREE_FILE")"
    local transcript_file
    transcript_file=$(find_active_transcript)

    if [ -z "$transcript_file" ]; then
        log "No transcript found for curation (checked JSONL and transcript.log)"
        return 1
    fi

    log "Curating from: $transcript_file"

    if [ -x "$CURATOR_SCRIPT" ]; then
        "$CURATOR_SCRIPT" \
            --agent "$AGENT_NAME" \
            --tree "$TREE_FILE" \
            --transcript "$transcript_file" \
            --output "$SKILL_FILE" 2>> "$LOG_FILE"
    elif [ -f "$LUCIDITY_DIR/curator.js" ] && command -v node > /dev/null 2>&1; then
        local curate_args="--agent $AGENT_NAME --tree $TREE_FILE --output $SKILL_FILE"
        if [ -s "$transcript_file" ]; then
            curate_args="$curate_args --transcript $transcript_file --once"
        fi
        LUCIDITY_TRANSCRIPT="$transcript_file" node "$LUCIDITY_DIR/curator.js" $curate_args 2>> "$LOG_FILE"
    else
        return 1
    fi
}

start_live_curator() {
    # Only start if a curator backend is available
    if [ ! -x "$CURATOR_SCRIPT" ] && ! ([ -f "$LUCIDITY_DIR/curator.js" ] && command -v node > /dev/null 2>&1); then
        log "No curator backend available — live curation disabled"
        return
    fi

    (
        log "Live curator started (interval: ${CURATION_INTERVAL}s)"
        while true; do
            sleep "$CURATION_INTERVAL"
            # Check if transcript has been modified since last curation
            if [ -f "$TRANSCRIPT_FILE_FOR_CURATION" ] && [ -s "$TRANSCRIPT_FILE_FOR_CURATION" ]; then
                log "Live curation pass starting..."
                if run_curation_pass; then
                    log "Live curation pass complete — skill.md updated"
                else
                    log "Live curation pass failed (non-fatal)"
                fi
            fi
        done
    ) &
    CURATOR_PID=$!
    log "Live curator daemon forked (PID $CURATOR_PID)"
}

stop_live_curator() {
    if [ -n "$CURATOR_PID" ] && kill -0 "$CURATOR_PID" 2>/dev/null; then
        log "Stopping live curator (PID $CURATOR_PID)"
        kill "$CURATOR_PID" 2>/dev/null || true
        wait "$CURATOR_PID" 2>/dev/null || true
        CURATOR_PID=""
    fi
}

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

    # Start live curator daemon alongside the agent

    # Live curation (Claude Code JSONL -> skill.md) is optional
    if [ "${USE_CLAUDE_CODE:-0}" = "1" ] || [ "${USE_CLAUDE_CODE:-0}" = "true" ]; then
        start_live_curator
    else
        log "USE_CLAUDE_CODE not set; live curation disabled"
    fi


    # Run the agent via the runner abstraction layer
    # Background + wait so SIGTERM trap can interrupt and forward signal
    "$RUNNER" "$@" &
    RUNNER_PID=$!
    set +e
    wait $RUNNER_PID 2>/dev/null
    EXIT_CODE=$?
    set -e
    RUNNER_PID=""

    # Stop live curator when the agent exits
    stop_live_curator

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
    # Final curation pass after agent exits — captures everything from the session.
    # Uses the same run_curation_pass() function as the live curator.
    log "Running between-session memory curation..."
    if run_curation_pass; then
        log "Between-session curation complete — skill.md updated"
    else
        log "Between-session curation failed (non-fatal, continuing)"
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
