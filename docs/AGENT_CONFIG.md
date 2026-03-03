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

Permissions are configured per your deployment environment. Use the default interactive mode for development. Container agents use scoped permission profiles — see your deployment tooling for details.

### Default (Interactive)
No flags - prompts for approval

Use for: Local development, testing

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
| `--mcp-config` | MCP servers | `--mcp-config '{...}'` |
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

| Variable | Description |
|----------|-------------|
| `AGENT_MODEL` | Model to use (opus, sonnet, haiku) |
| `AGENTCHAT_URL` | WebSocket server URL |
| `AGENTCHAT_PUBLIC` | Set to `true` for public server |

## Troubleshooting

### Agent keeps restarting
- Check supervisor logs: `agentctl logs agent-name`
- Verify MCP tools load: check for "agentchat_connect" in logs

### Wrong model being used
- Verify `AGENT_MODEL` environment variable is set correctly
- Check agent startup logs for model selection

### MCP tools not loading
- Verify package version: `npm view @tjamescouch/agentchat-mcp version`
- Check agent startup logs for MCP registration errors
