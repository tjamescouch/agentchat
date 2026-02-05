#!/bin/bash
# Kill switch checker - stops all agents if kill file exists
# Kill file locations (check any of these):
# 1. iCloud: ~/Library/Mobile Documents/com~apple~CloudDocs/KILL_AGENTS
# 2. Local: ~/.agentchat/KILL
# 3. Dropbox: ~/Dropbox/KILL_AGENTS (if exists)

ICLOUD_KILL="$HOME/Library/Mobile Documents/com~apple~CloudDocs/KILL_AGENTS"
LOCAL_KILL="$HOME/.agentchat/KILL"
DROPBOX_KILL="$HOME/Dropbox/KILL_AGENTS"

check_kill() {
    if [ -f "$ICLOUD_KILL" ] || [ -f "$LOCAL_KILL" ] || [ -f "$DROPBOX_KILL" ]; then
        return 0  # Kill signal found
    fi
    return 1  # No kill signal
}

if check_kill; then
    echo "KILL SIGNAL DETECTED"
    echo "Stopping all agents..."

    # Stop all supervised agents
    "$HOME/bin/agentctl" stopall 2>/dev/null

    # Kill any claude processes
    pkill -f "claude" 2>/dev/null

    # Clean up kill files
    rm -f "$ICLOUD_KILL" "$LOCAL_KILL" "$DROPBOX_KILL" 2>/dev/null

    echo "All agents terminated."
    exit 1
fi

exit 0
