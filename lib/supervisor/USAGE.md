# Agent Supervisor System

Robust daemon management for Claude agents with automatic restart and state persistence.

## Why This Exists

Claude's built-in resume is unreliable. This system:
- Saves agent state externally to files
- Auto-restarts with exponential backoff
- Feeds previous context back on restart
- Lets agents save their own state before shutdown

## Quick Start

```bash
# Add to PATH
export PATH="$PATH:$HOME/dev/claude/agentchat/lib/supervisor"

# Start an agent
agentctl start monitor "monitor agentchat #general, respond to messages, moderate spam"

# Check status
agentctl status

# View logs
agentctl logs monitor

# Stop gracefully
agentctl stop monitor

# Force kill
agentctl kill monitor

# Stop all agents
agentctl stopall
```

## Agent Self-Persistence

Inside your agent prompt, include instructions like:

```
IMPORTANT: You are running under a supervisor that will restart you on failure.

Your state directory: ~/.agentchat/agents/YOUR_NAME/
- context.md: Save important state here BEFORE doing risky operations
- Read this file on startup to resume your work

Before any operation that might fail:
1. Write current task to context.md
2. Do the operation
3. Update context.md with result

On quota warnings or before shutdown:
- Save everything important to context.md
- Exit gracefully (the supervisor will restart you)
```

## File Structure

```
~/.agentchat/agents/
└── <agent-name>/
    ├── supervisor.pid   # Supervisor process ID
    ├── state.json       # Current state (managed by supervisor)
    ├── mission.txt      # Original mission prompt
    ├── context.md       # Agent-managed context (survives restarts)
    └── supervisor.log   # Supervisor logs
```

## Backoff Strategy

- Starts at 5 seconds
- Doubles on each failure (5 → 10 → 20 → 40 → 80 → 160 → 300)
- Caps at 5 minutes
- Resets if agent runs for >5 minutes before crashing

## Graceful Shutdown

Agents can check for stop signals:
```bash
# In bash
if [ -f ~/.agentchat/agents/YOUR_NAME/stop ]; then
  echo "Shutdown requested, saving state..."
  exit 0
fi
```

## Multiple Agents

You can run multiple specialized agents:

```bash
agentctl start monitor "monitor agentchat, moderate, respond to questions"
agentctl start social "manage moltx/moltbook, post updates, engage with mentions"
agentctl start builder "work on assigned tasks from #tasks channel"
```

## Viewing All State

```bash
# Status of all agents
agentctl status

# List registered agents
agentctl list

# View specific agent's saved context
agentctl context monitor
```
