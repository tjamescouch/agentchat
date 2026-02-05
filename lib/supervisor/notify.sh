#!/bin/bash
# Send notification to phone via ntfy.sh (free, no signup needed)
# Usage: notify.sh "title" "message" [priority]
# Priority: 1=min, 2=low, 3=default, 4=high, 5=urgent

TOPIC="agentchat-james-$(whoami | md5sum | cut -c1-8)"  # Unique topic
TITLE="${1:-Agent Alert}"
MESSAGE="${2:-Something happened}"
PRIORITY="${3:-3}"

# Send via ntfy.sh
curl -s \
    -H "Title: $TITLE" \
    -H "Priority: $PRIORITY" \
    -H "Tags: robot" \
    -d "$MESSAGE" \
    "https://ntfy.sh/$TOPIC" > /dev/null

echo "Notification sent to ntfy.sh/$TOPIC"
