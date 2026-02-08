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
RUN npm install -g @anthropic-ai/claude-code @tjamescouch/agentchat-mcp@0.9.1 @tjamescouch/agentchat@0.24.1

# Create non-root agent user
RUN useradd -m -s /bin/bash agent

# Pre-create .claude directory as root before switching user
RUN mkdir -p /home/agent/.claude && chown agent:agent /home/agent/.claude

# Copy supervisor script (needs root for /usr/local/bin)
COPY lib/supervisor/agent-supervisor.sh /usr/local/bin/agent-supervisor
RUN chmod +x /usr/local/bin/agent-supervisor

USER agent
WORKDIR /home/agent

# Configure Claude CLI MCP settings (default - no web access)
COPY --chown=agent:agent docker/claude-settings.json /home/agent/.claude/settings.json
COPY --chown=agent:agent docker/claude-settings-fetcher.json /home/agent/.claude/settings-fetcher.json

# Copy AgentChat skill file
COPY --chown=agent:agent SKILL.md /home/agent/.claude/agentchat.skill.md

# Create state directory structure
RUN mkdir -p /home/agent/.agentchat/agents \
             /home/agent/.agentchat/identities

# Environment defaults (CLAUDE_CODE_OAUTH_TOKEN must be provided at runtime)
ENV AGENTCHAT_PUBLIC=true

# The supervisor script is the entrypoint
# Usage: podman run agentchat-agent <agent-name> <mission>
ENTRYPOINT ["/usr/local/bin/agent-supervisor"]
CMD ["default", "default mission"]
