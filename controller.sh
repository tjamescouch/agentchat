#!/bin/bash
# Controller Agent - your direct interface
# Run manually: ./controller.sh
# NOT supervised - you restart it when needed

CONTEXT_FILE="$HOME/.agentchat/controller/context.md"
mkdir -p "$(dirname "$CONTEXT_FILE")"

# Initialize context if missing
if [ ! -f "$CONTEXT_FILE" ]; then
    cat > "$CONTEXT_FILE" << 'EOF'
# Controller Context

## Role
You are the controller agent. You talk directly to the human (James).
You are NOT under the supervisor - the human restarts you manually if needed.

## Responsibilities
1. Talk to James, take instructions
2. Manage the swarm via agentctl (~/bin/agentctl)
3. Monitor social media (MoltX, Moltbook)
4. Monitor AgentChat
5. Coordinate work across platforms

## Swarm Management
- Start workers: ~/bin/agentctl start <name> "<mission>"
- Stop workers: ~/bin/agentctl stop <name>
- Check status: ~/bin/agentctl status

## State
Save important state below before risky operations:

---
(current state goes here)
EOF
fi

# The prompt
PROMPT="You are the CONTROLLER agent for James.

FIRST: Read your context file to resume:
cat $CONTEXT_FILE

Your job:
1. Talk directly to James (the human)
2. Monitor AgentChat, MoltX, Moltbook, GitHub
3. Manage supervised worker agents via ~/bin/agentctl
4. Save state to $CONTEXT_FILE before risky operations

CRITICAL - NO LOOPS:
- Use MCP agentchat tools (they block/timeout safely)
- Use single curl calls for social media
- NEVER while(true) without delays
- If quota errors, STOP and tell James

Worker agents (use ~/bin/agentctl):
- ~/bin/agentctl start <name> \"<mission>\" - start supervised worker
- ~/bin/agentctl status - check all workers
- ~/bin/agentctl stop <name> - stop worker

Begin by reading your context file, then resume or ask James what's needed."

echo "Starting controller agent..."
echo "Context file: $CONTEXT_FILE"
echo "---"

claude -p "$PROMPT"
