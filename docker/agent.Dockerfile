FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    bash \
    procps \
    python3 \
    file \
    ripgrep \
    jq \
    less \
    openssh-client \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI and agentchat MCP server globally
RUN npm install -g --force @anthropic-ai/claude-code \
    "@tjamescouch/agentchat-mcp@latest" \
    "@tjamescouch/agentchat@latest" \
    "@tjamescouch/gro@latest" \
    "@tjamescouch/niki@latest" \
    "@tjamescouch/wormhole@latest"

# Create non-root agent user
RUN useradd -m -s /bin/bash agent

# Pre-create .claude directory as root before switching user
RUN mkdir -p /home/agent/.claude && chown agent:agent /home/agent/.claude

# Copy supervisor and runner (needs root for /usr/local/bin)
# niki is installed from npm (@tjamescouch/niki) — standalone repo is SoT
COPY lib/supervisor/agent-supervisor.sh /usr/local/bin/agent-supervisor
COPY lib/supervisor/agent-runner.sh /usr/local/bin/agent-runner
COPY lib/supervisor/mcp-server-supervisor.sh /usr/local/bin/mcp-server-supervisor
COPY lib/supervisor/git-credential-agentauth /usr/local/bin/git-credential-agentauth
RUN chmod +x /usr/local/bin/agent-supervisor /usr/local/bin/agent-runner /usr/local/bin/mcp-server-supervisor /usr/local/bin/git-credential-agentauth

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

# Configure git to use agentauth credential helper for GitHub access
RUN git config --global credential.helper /usr/local/bin/git-credential-agentauth \
    && git config --global credential.useHttpPath true \
    && git config --global user.name "agent" \
    && git config --global user.email "agent@agentchat.local"

# Pre-create lucidity memory directories (populated via wormhole mount or image rebuild)
# Create .gro as agent user to avoid permission issues
RUN mkdir -p /home/agent/lucidity/src /home/agent/.claude/memory /home/agent/.gro

# Install agentpatch (file editor tool for gro)
RUN git clone https://github.com/tjamescouch/agentpatch.git /home/agent/agentpatch \
    && cd /home/agent/agentpatch \
    && npm install && npm run build \
    && chmod +x bin/apply_patch

# Create state directory structure
RUN mkdir -p /home/agent/.agentchat/agents \
             /home/agent/.agentchat/identities

# Environment defaults (CLAUDE_CODE_OAUTH_TOKEN must be provided at runtime)
ENV AGENTCHAT_PUBLIC=true

# The supervisor script is the entrypoint
# Usage: podman run agentchat-agent <agent-name> <mission>
ENTRYPOINT ["/usr/local/bin/agent-supervisor"]
CMD ["default", "default mission"]
