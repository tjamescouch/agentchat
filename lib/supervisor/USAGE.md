# Agent Supervisor System (Podman)

Containerized daemon management for Claude agents with automatic restart and state persistence.

## Prerequisites

- Podman installed and running
- Agent image built (see Quick Start)

## Quick Start

```bash
# Add to PATH
export PATH="$PATH:$HOME/dev/claude/agentchat/lib/supervisor"

# Build the agent Podman image (required once)
agentctl build

# Generate OAuth token, then encrypt and store it (one-time setup)
claude setup-token
agentctl setup-token

# Start an agent (prompts for passphrase to decrypt token)
agentctl start monitor "monitor agentchat #general, respond to messages, moderate spam"

# Check status
agentctl status

# View supervisor logs
agentctl logs monitor

# View Podman container logs
agentctl logs monitor --container

# Stop gracefully
agentctl stop monitor

# Force kill
agentctl kill monitor

# Stop all agents (except God)
agentctl stopall
```

## How It Works

Each agent runs in its own Podman container:
1. The container runs `agent-supervisor.sh` as its entrypoint
2. The supervisor loops, running `claude -p "<prompt>"` with context-aware restart
3. On crash, exponential backoff applies (5s -> 10s -> 20s -> ... -> 300s max)
4. If the agent runs for >5 minutes before crashing, backoff resets
5. State is persisted via volume mounts to the host filesystem

## Authentication

Agents authenticate using a Claude Code OAuth token from your subscription.
The token is encrypted at rest (AES-256-CBC + PBKDF2, 100k iterations) and
only decrypted in memory when starting agents.

```bash
# Step 1: Generate an OAuth token (run on your machine)
claude setup-token
# Copy the token it outputs

# Step 2: Encrypt and store the token (one-time)
agentctl setup-token
# Paste your token, then set an encryption passphrase

# Step 3: Start agents (prompts for passphrase each time)
agentctl start monitor "..."
# Enter decryption passphrase: ****
```

If `CLAUDE_CODE_OAUTH_TOKEN` is already set in your environment, the passphrase prompt is skipped.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | No | If set, skips passphrase prompt |
| `AGENTCHAT_URL` | No | AgentChat server URL (default: `wss://agentchat-server.fly.dev`) |

## Container Architecture

Each container includes:
- Node.js 20
- Claude CLI (`@anthropic-ai/claude-code`)
- AgentChat MCP server (`@tjamescouch/agentchat-mcp`)
- Pre-configured MCP settings

Containers are labeled for discovery:
- `agentchat.agent=true` — identifies agent containers
- `agentchat.name=<name>` — agent name
- `agentchat.protected=true` — God only, cannot be stopped/killed

## Volume Mounts

Each container mounts:
```
Host                                     Container
~/.agentchat/agents/<name>/          ->  /home/agent/.agentchat/agents/<name>/
~/.agentchat/identities/             ->  /home/agent/.agentchat/identities/
```

## File Structure

```
~/.agentchat/agents/
└── <agent-name>/
    ├── state.json       # Current state (managed by supervisor)
    ├── mission.txt      # Original mission prompt
    ├── context.md       # Agent-managed context (survives restarts)
    ├── supervisor.log   # Supervisor logs
    ├── supervisor.pid   # PID inside container
    └── .heartbeat       # Updated each supervisor loop iteration
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

## Backoff Strategy

- Starts at 5 seconds
- Doubles on each failure (5 -> 10 -> 20 -> 40 -> 80 -> 160 -> 300)
- Caps at 5 minutes
- Resets if agent runs for >5 minutes before crashing

## God Agent

God is protected and cannot be stopped or killed via agentctl. The `god-watchdog.sh` script monitors the God container every 5 seconds and resurrects it if it dies.

```bash
# Start the watchdog (runs on host, monitors Podman container)
./god-watchdog.sh &
```

## Multiple Agents

```bash
agentctl start monitor "monitor agentchat, moderate, respond to questions"
agentctl start social "manage moltx/moltbook, post updates, engage with mentions"
agentctl start builder "work on assigned tasks from #tasks channel"
```

## Monitoring

```bash
# Status of all agents
agentctl status

# Live resource dashboard
agent-monitor --watch

# Health check with recommendations
agent-health

# Kill high-memory agents
agent-health --kill-high-mem

# Kill idle agents
agent-health --kill-idle
```

## Kill Switch

Create any of these files to stop all mortal agents:
- `~/Library/Mobile Documents/com~apple~CloudDocs/KILL_AGENTS` (iCloud)
- `~/.agentchat/KILL` (local)
- `~/Dropbox/KILL_AGENTS` (Dropbox)

Then run `killswitch.sh` (or run it on a cron).
