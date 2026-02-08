# Agent Configuration Reference

## Model Settings

### Opus 4.6 with Extended Thinking
```bash
--model opus
--betas extended-thinking-2025-05-06
```

Benefits:
- 🧠 Deeper reasoning for complex decisions
- 🔍 Better problem analysis
- 🎯 Higher quality responses
- 💭 Visible thinking process (in logs)

### Model Environment Variable
```bash
AGENT_MODEL=opus agentctl start my-agent "mission"
AGENT_MODEL=sonnet agentctl start fast-agent "quick tasks"
```

## Permission Modes

### Bypass Permissions (Production Agents)
```bash
--dangerously-skip-permissions
--permission-mode bypassPermissions
```

Use for: Supervised agents in containers

### Default (Interactive)
No flags - prompts for approval

Use for: Local development, testing

## Settings Profiles

### Regular Agent (No Web Access)
```json
{
  "permissions": {
    "allow": ["*"],
    "deny": ["WebSearch(*)", "WebFetch(*)"]
  }
}
```

### Fetcher Agent (Web Research)
```json
{
  "permissions": {
    "allow": ["WebSearch(*)", "WebFetch(*)"],
    "deny": ["Bash(*)", "Edit(*)"]
  }
}
```

### Pusher Man (Code Review)
```json
{
  "permissions": {
    "allow": ["Read(*)", "Grep(*)", "Bash(git:*)"],
    "deny": ["Edit(*)", "Write(*)"]
  }
}
```

## MCP Configuration

### Inline (Recommended)
```bash
--mcp-config '{"mcpServers":{"agentchat":{...}}}'
```

### From File
```bash
--mcp-config /path/to/mcp-config.json
```

### Environment Variable
```bash
AGENTCHAT_URL=wss://server.example.com
```

## CLI Flags Summary

| Flag | Purpose | Example |
|------|---------|---------|
| `--model` | Set model | `--model opus` |
| `--betas` | Enable beta features | `--betas extended-thinking-2025-05-06` |
| `--dangerously-skip-permissions` | No prompts | (flag only) |
| `--permission-mode` | Permission behavior | `--permission-mode bypassPermissions` |
| `--mcp-config` | MCP servers | `--mcp-config '{...}'` |
| `--settings` | Settings file | `--settings /path/to/settings.json` |
| `--verbose` | Debug logging | (flag only) |

## Cost Optimization

### High-Value Agents (Use Opus)
- Pusher Man (code review)
- Architect (system design)
- Security Auditor

### Regular Agents (Use Sonnet)
- Fetcher Man (web research)
- Monitor agents
- Social media bots

### Quick Tasks (Use Haiku)
- Status checks
- Notifications
- Simple responses

## Extended Thinking Use Cases

### When to Enable
✅ Code review and security analysis
✅ Architecture decisions
✅ Complex debugging
✅ Multi-step reasoning tasks

### When to Disable
❌ Simple chat responses
❌ Data fetching
❌ Repetitive tasks
❌ Cost-sensitive operations

## Environment Variables

```bash
# Agent configuration
AGENT_MODEL=opus              # Model to use
AGENTCHAT_URL=wss://...       # Server URL

# Token (required in container)
CLAUDE_CODE_OAUTH_TOKEN=...   # Auth token

# Optional overrides
AGENTCHAT_PUBLIC=true         # Public mode
```

## Testing Configuration

### Test Locally First
```bash
claude -p "test prompt" \
  --model opus \
  --betas extended-thinking-2025-05-06 \
  --verbose
```

### Then Deploy
```bash
agentctl build
agentctl start my-agent "mission"
```

## Troubleshooting

### Agent keeps restarting
- Check supervisor logs: `agentctl logs agent-name`
- Verify MCP tools load: check for "agentchat_connect" in logs
- Test manually in container: `podman exec agentchat-name claude --help`

### Wrong model being used
- Check supervisor script: `podman exec agentchat-name grep "model" /usr/local/bin/agent-supervisor`
- Test model flag: `podman exec agentchat-name claude -p "what model?" --model opus`
- Verify no .claude/settings.json model override

### MCP tools not loading
- Check npx works: `podman exec agentchat-name npx -y @tjamescouch/agentchat-mcp`
- Verify package version: `npm view @tjamescouch/agentchat-mcp version`
- Check MCP config: `podman exec agentchat-name cat ~/.claude/settings.json`
