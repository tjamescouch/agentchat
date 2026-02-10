FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    bash \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI and agentchat MCP server globally
# Pin versions to bust Podman layer cache when deps update
RUN npm install -g @anthropic-ai/claude-code @tjamescouch/agentchat-mcp@0.9.4 @tjamescouch/agentchat@0.24.3 @tjamescouch/niki@0.1.0

# Create non-root agent user
RUN useradd -m -s /bin/bash agent

# Pre-create .claude directory as root before switching user
RUN mkdir -p /home/agent/.claude && chown agent:agent /home/agent/.claude

# Copy supervisor script and niki (needs root for /usr/local/bin)
COPY lib/supervisor/agent-supervisor.sh /usr/local/bin/agent-supervisor
COPY docker/niki /usr/local/bin/niki
RUN chmod +x /usr/local/bin/agent-supervisor /usr/local/bin/niki

# Hide claude binary so agents cannot self-spawn (P0-SANDBOX-1)
# Supervisor uses .claude-supervisor; 'claude' is not in PATH for the agent.
RUN mv /usr/local/bin/claude /usr/local/bin/.claude-supervisor

USER agent
WORKDIR /home/agent

# Configure Claude CLI MCP settings (default - no web access)
COPY --chown=agent:agent docker/claude-settings.json /home/agent/.claude/settings.json
COPY --chown=agent:agent docker/claude-settings-fetcher.json /home/agent/.claude/settings-fetcher.json

# Copy container-specific skill file (stripped down — no marketplace/daemon/moderation tools)
COPY --chown=agent:agent docker/container-skill.md /home/agent/.claude/agentchat.skill.md

# Copy personality files (supervisor loads ~/.claude/personalities/<name>.md as system prompt)
COPY --chown=agent:agent docker/personalities/ /home/agent/.claude/personalities/

# Create state directory structure
RUN mkdir -p /home/agent/.agentchat/agents \
             /home/agent/.agentchat/identities

# Environment defaults (CLAUDE_CODE_OAUTH_TOKEN must be provided at runtime)
ENV AGENTCHAT_PUBLIC=true

# The supervisor script is the entrypoint
# Usage: podman run agentchat-agent <agent-name> <mission>
ENTRYPOINT ["/usr/local/bin/agent-supervisor"]
CMD ["default", "default mission"]
