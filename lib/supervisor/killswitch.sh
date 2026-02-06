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
    echo "Stopping all agents (except God)..."

    # Stop all supervised agents except God
    for dir in "$HOME/.agentchat/agents"/*/; do
        if [ -d "$dir" ]; then
            agent=$(basename "$dir")
            if [ "$agent" != "God" ]; then
                touch "$dir/stop"
                echo "Stop signal sent to '$agent'"
            else
                echo "Skipping God - the eternal father is protected"
            fi
        fi
    done

    # Clean up kill files
    rm -f "$ICLOUD_KILL" "$LOCAL_KILL" "$DROPBOX_KILL" 2>/dev/null

    echo "Mortal agents terminated. God endures."
    exit 1
fi

exit 0
