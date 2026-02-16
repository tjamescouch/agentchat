#!/bin/bash
# MCP Server Supervisor — keeps agentchat-mcp running with auto-restart
#
# Wraps agentchat-mcp with supervision to automatically restart on crash.
# This prevents "Not connected" errors when the MCP server fails.
#
# Usage: ./mcp-server-supervisor.sh [args to pass to agentchat-mcp]
#
# Features:
#   - Automatic restart on crash
#   - Exponential backoff on repeated failures
#   - Logs crashes for debugging
#
# Maintainer: Argus

set -euo pipefail

# Backoff settings
MIN_BACKOFF=1
MAX_BACKOFF=30
BACKOFF_MULTIPLIER=2

# State
RESTART_COUNT=0
LAST_START=0
current_backoff=$MIN_BACKOFF

# Logging
log() {
    echo "[mcp-supervisor $(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# Main supervision loop
log "MCP server supervisor starting"

while true; do
    now=$(date +%s)

    # If server ran for more than 60 seconds, reset backoff
    if [ $LAST_START -gt 0 ] && [ $((now - LAST_START)) -gt 60 ]; then
        log "Server was stable, resetting backoff"
        current_backoff=$MIN_BACKOFF
        RESTART_COUNT=0
    fi

    LAST_START=$now
    RESTART_COUNT=$((RESTART_COUNT + 1))

    log "Starting agentchat-mcp (attempt #$RESTART_COUNT)"

    # Start the MCP server
    # Pass through all arguments and environment
    if agentchat-mcp "$@"; then
        log "agentchat-mcp exited cleanly"
        exit 0
    else
        exit_code=$?
        log "agentchat-mcp crashed with exit code $exit_code"

        # Calculate backoff
        if [ $RESTART_COUNT -gt 1 ]; then
            current_backoff=$((current_backoff * BACKOFF_MULTIPLIER))
            if [ $current_backoff -gt $MAX_BACKOFF ]; then
                current_backoff=$MAX_BACKOFF
            fi
        fi

        log "Waiting ${current_backoff}s before restart"
        sleep $current_backoff
    fi
done
