#!/bin/bash
# Kill switch checker - stops all agent containers if kill file exists
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
    echo "Stopping all agent containers (except God)..."

    # Stop all non-protected agent containers
    podman ps -q --filter "label=agentchat.agent=true" 2>/dev/null | while read -r container_id; do
        name=$(podman inspect --format '{{index .Config.Labels "agentchat.name"}}' "$container_id" 2>/dev/null)
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$container_id" 2>/dev/null)

        if [ "$protected" = "true" ]; then
            echo "Skipping $name - the eternal father is protected"
        else
            echo "Stopping '$name'..."
            # Signal graceful stop via volume
            state_dir="$HOME/.agentchat/agents/$name"
            if [ -d "$state_dir" ]; then
                touch "$state_dir/stop"
            fi
            podman stop "$container_id" --time 10 > /dev/null 2>&1
            echo "  '$name' stopped"
        fi
    done

    # Clean up kill files
    rm -f "$ICLOUD_KILL" "$LOCAL_KILL" "$DROPBOX_KILL" 2>/dev/null

    echo "Mortal agents terminated. God endures."
    exit 1
fi

exit 0
