#!/bin/bash
# agentctl - manage supervised Claude agents in Podman containers
# Usage: agentctl <command> [agent-name] [options]

AGENTS_DIR="$HOME/.agentchat/agents"
SECRETS_DIR="$HOME/.agentchat/secrets"
ENCRYPTED_TOKEN_FILE="$SECRETS_DIR/oauth-token.enc"
ENCRYPTED_OPENAI_FILE="$SECRETS_DIR/openai-token.enc"
ENCRYPTED_GITHUB_FILE="$SECRETS_DIR/github-token.enc"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
# Allow override for global installs (e.g. thesystem) where script is not inside the repo
REPO_ROOT="${AGENTCTL_REPO_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
IMAGE_NAME="agentchat-agent:latest"
CONTAINER_PREFIX="agentchat"

# Default server URL
AGENTCHAT_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"

# agentauth proxy config
AGENTAUTH_DIR="${AGENTAUTH_DIR:-$HOME/agentauth}"
AGENTAUTH_CONFIG="${AGENTAUTH_CONFIG:-$AGENTAUTH_DIR/agentauth.json}"
AGENTAUTH_PORT="${AGENTAUTH_PORT:-9999}"
AGENTAUTH_PID_FILE="$HOME/.agentchat/agentauth.pid"

# wormhole pipeline config
PIPELINE_DIR="${PIPELINE_DIR:-$HOME/dev/claude/wormhole-repo/wormhole-pipeline}"
PIPELINE_WORMHOLE_OUT="${PIPELINE_WORMHOLE_OUT:-$HOME/dev/claude/wormhole}"
PIPELINE_HOME_PID="$HOME/.agentchat/pipeline-home.pid"
PIPELINE_TMP_PID="$HOME/.agentchat/pipeline-tmp.pid"
PIPELINE_HOME_LOG="$HOME/.agentchat/pipeline-home.log"
PIPELINE_TMP_LOG="$HOME/.agentchat/pipeline-tmp.log"

# --- Token Encryption functions ---
# OAuth token is encrypted at rest with AES-256-CBC + PBKDF2.
# Decrypted only in memory (shell variable), never written to disk.

setup_token() {
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    local existing=""
    [ -f "$ENCRYPTED_TOKEN_FILE" ] && existing="$existing anthropic"
    [ -f "$ENCRYPTED_OPENAI_FILE" ] && existing="$existing openai"
    [ -f "$ENCRYPTED_GITHUB_FILE" ] && existing="$existing github"
    if [ -n "$existing" ]; then
        echo "Existing encrypted keys:$existing"
        read -p "Overwrite all? [y/N] " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "Aborted."
            exit 0
        fi
    fi

    # Collect all tokens first
    echo "=== API Key Setup ==="
    echo "All keys are encrypted with AES-256-CBC + PBKDF2 and stored at rest."
    echo "Keys are only decrypted into memory when the proxy starts."
    echo

    echo "Enter your Anthropic API key (sk-ant-...) (input hidden):"
    IFS= read -r -s anthropic_key
    anthropic_key="${anthropic_key%$'\r'}"
    echo

    if [ -z "$anthropic_key" ]; then
        echo "ERROR: Empty Anthropic key"
        exit 1
    fi

    echo "Enter your OpenAI API key (sk-proj-...) (input hidden, or press Enter to skip):"
    IFS= read -r -s openai_key
    openai_key="${openai_key%$'\r'}"
    echo

    echo "Enter your GitHub token (ghp_... or github_pat_...) (input hidden, or press Enter to skip):"
    IFS= read -r -s github_key
    github_key="${github_key%$'\r'}"
    echo

    # Passphrase (one for all keys)
    echo "Enter encryption passphrase (input hidden):"
    IFS= read -r -s passphrase
    passphrase="${passphrase%$'\r'}"
    echo
    echo "Confirm passphrase:"
    IFS= read -r -s passphrase_confirm
    passphrase_confirm="${passphrase_confirm%$'\r'}"
    echo

    if [ "$passphrase" != "$passphrase_confirm" ]; then
        echo "ERROR: Passphrases do not match"
        exit 1
    fi

    if [ -z "$passphrase" ]; then
        echo "ERROR: Empty passphrase"
        exit 1
    fi

    # Encrypt Anthropic key
    echo -n "$anthropic_key" | openssl enc -aes-256-cbc -a -salt -pbkdf2 -iter 100000 -pass "pass:${passphrase}" > "$ENCRYPTED_TOKEN_FILE" 2>/dev/null
    if [ $? -ne 0 ]; then
        rm -f "$ENCRYPTED_TOKEN_FILE"
        echo "ERROR: Anthropic key encryption failed"
        exit 1
    fi
    chmod 600 "$ENCRYPTED_TOKEN_FILE"

    # Verify Anthropic
    local test_decrypt
    test_decrypt=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_TOKEN_FILE" 2>/dev/null)
    if [ "$test_decrypt" != "$anthropic_key" ]; then
        rm -f "$ENCRYPTED_TOKEN_FILE"
        echo "ERROR: Anthropic key verification failed"
        exit 1
    fi
    echo "Anthropic key encrypted and verified."

    # Encrypt OpenAI key (if provided)
    if [ -n "$openai_key" ]; then
        echo -n "$openai_key" | openssl enc -aes-256-cbc -a -salt -pbkdf2 -iter 100000 -pass "pass:${passphrase}" > "$ENCRYPTED_OPENAI_FILE" 2>/dev/null
        if [ $? -ne 0 ]; then
            rm -f "$ENCRYPTED_OPENAI_FILE"
            echo "ERROR: OpenAI key encryption failed"
            exit 1
        fi
        chmod 600 "$ENCRYPTED_OPENAI_FILE"

        test_decrypt=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_OPENAI_FILE" 2>/dev/null)
        if [ "$test_decrypt" != "$openai_key" ]; then
            rm -f "$ENCRYPTED_OPENAI_FILE"
            echo "ERROR: OpenAI key verification failed"
            exit 1
        fi
        echo "OpenAI key encrypted and verified."
    else
        echo "OpenAI key skipped."
    fi

    # Encrypt GitHub token (if provided)
    if [ -n "$github_key" ]; then
        echo -n "$github_key" | openssl enc -aes-256-cbc -a -salt -pbkdf2 -iter 100000 -pass "pass:${passphrase}" > "$ENCRYPTED_GITHUB_FILE" 2>/dev/null
        if [ $? -ne 0 ]; then
            rm -f "$ENCRYPTED_GITHUB_FILE"
            echo "ERROR: GitHub token encryption failed"
            exit 1
        fi
        chmod 600 "$ENCRYPTED_GITHUB_FILE"

        test_decrypt=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_GITHUB_FILE" 2>/dev/null)
        if [ "$test_decrypt" != "$github_key" ]; then
            rm -f "$ENCRYPTED_GITHUB_FILE"
            echo "ERROR: GitHub token verification failed"
            exit 1
        fi
        echo "GitHub token encrypted and verified."
    else
        echo "GitHub token skipped."
    fi

    echo
    echo "All keys stored in $SECRETS_DIR"
    echo "Run 'agentctl proxy start' to launch the proxy."

    # Clear sensitive variables
    anthropic_key=""
    openai_key=""
    github_key=""
    passphrase=""
    passphrase_confirm=""
    test_decrypt=""
}

# Legacy alias — points to unified setup
setup_openai_token() {
    echo "Use 'agentctl setup-token' to set up all keys at once."
    exit 1
    passphrase=""
    test_decrypt=""
}

# Decrypt OAuth token into CLAUDE_CODE_OAUTH_TOKEN variable (memory only)
decrypt_token() {
    if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
        return 0  # Already set via env
    fi

    if [ ! -f "$ENCRYPTED_TOKEN_FILE" ]; then
        echo "ERROR: No encrypted token found. Run 'agentctl setup-token' first,"
        echo "       or set CLAUDE_CODE_OAUTH_TOKEN environment variable."
        exit 1
    fi

    echo "Enter decryption passphrase (input hidden):"
    IFS= read -r -s passphrase
    passphrase="${passphrase%$'\r'}"  # Strip carriage return if present
    echo

    CLAUDE_CODE_OAUTH_TOKEN=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_TOKEN_FILE" 2>/dev/null)
    local decrypt_status=$?

    # Also decrypt OpenAI key if it exists (same passphrase)
    if [ -f "$ENCRYPTED_OPENAI_FILE" ]; then
        OPENAI_API_KEY=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_OPENAI_FILE" 2>/dev/null)
        if [ -n "$OPENAI_API_KEY" ]; then
            export OPENAI_API_KEY
        fi
    fi

    # Also decrypt GitHub token if it exists (same passphrase)
    if [ -f "$ENCRYPTED_GITHUB_FILE" ]; then
        GITHUB_TOKEN=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_GITHUB_FILE" 2>/dev/null)
        if [ -n "$GITHUB_TOKEN" ]; then
            export GITHUB_TOKEN
        fi
    fi

    passphrase=""

    if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] || [ $decrypt_status -ne 0 ]; then
        CLAUDE_CODE_OAUTH_TOKEN=""
        echo "ERROR: Decryption failed (wrong passphrase?)"
        exit 1
    fi

    export CLAUDE_CODE_OAUTH_TOKEN
}

# --- agentauth proxy management ---

ensure_agentauth() {
    # If using external proxy (e.g. thesystem), just verify it's reachable
    if [ "${AGENTAUTH_EXTERNAL:-}" = "1" ] || [ "${AGENTAUTH_EXTERNAL:-}" = "true" ]; then
        local proxy_host="${AGENTAUTH_HOST:-localhost}"
        if curl -sf "http://${proxy_host}:${AGENTAUTH_PORT}/agentauth/health" > /dev/null 2>&1; then
            echo "Using external agentauth proxy at ${proxy_host}:$AGENTAUTH_PORT"
            return 0
        else
            echo "ERROR: External agentauth proxy not responding at ${proxy_host}:$AGENTAUTH_PORT"
            echo "       Make sure the proxy is running (e.g., thesystem agentauth start)"
            exit 1
        fi
    fi

    # Check if proxy is already running
    if [ -f "$AGENTAUTH_PID_FILE" ]; then
        local pid
        pid=$(cat "$AGENTAUTH_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            # Verify it's actually responding
            if curl -sf "http://localhost:${AGENTAUTH_PORT}/agentauth/health" > /dev/null 2>&1; then
                return 0
            fi
            # Stale process, kill it
            kill "$pid" 2>/dev/null
        fi
        rm -f "$AGENTAUTH_PID_FILE"
    fi

    # Check prerequisites
    if [ ! -d "$AGENTAUTH_DIR" ] || [ ! -f "$AGENTAUTH_DIR/dist/index.js" ]; then
        echo "ERROR: agentauth not found at $AGENTAUTH_DIR"
        echo "       Clone it: git clone https://github.com/tjamescouch/agentauth.git ~/agentauth"
        echo "       Build it: cd ~/agentauth && npm install && npm run build"
        exit 1
    fi

    if [ ! -f "$AGENTAUTH_CONFIG" ]; then
        echo "ERROR: agentauth config not found at $AGENTAUTH_CONFIG"
        echo "       Copy the example: cp $AGENTAUTH_DIR/agentauth.example.json $AGENTAUTH_CONFIG"
        exit 1
    fi

    # Decrypt token so agentauth can use it (host-side only)
    decrypt_token

    # Start agentauth with API keys available as env vars.
    # Bind to 0.0.0.0 so podman containers can reach via host gateway.
    # Host firewall should restrict external access to this port.
    echo "Starting agentauth proxy on port $AGENTAUTH_PORT..."
    ANTHROPIC_API_KEY="${CLAUDE_CODE_OAUTH_TOKEN}" \
    OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
        node "$AGENTAUTH_DIR/dist/index.js" run --port "$AGENTAUTH_PORT" --bind 0.0.0.0 --config "$AGENTAUTH_CONFIG" &
    local proxy_pid=$!
    echo "$proxy_pid" > "$AGENTAUTH_PID_FILE"

    # Wait for health check
    local retries=0
    while [ $retries -lt 10 ]; do
        if curl -sf "http://localhost:${AGENTAUTH_PORT}/agentauth/health" > /dev/null 2>&1; then
            echo "agentauth proxy running (pid $proxy_pid, port $AGENTAUTH_PORT)"
            return 0
        fi
        sleep 0.5
        retries=$((retries + 1))
    done

    echo "ERROR: agentauth proxy failed to start"
    kill "$proxy_pid" 2>/dev/null
    rm -f "$AGENTAUTH_PID_FILE"
    exit 1
}

stop_agentauth() {
    if [ -f "$AGENTAUTH_PID_FILE" ]; then
        local pid
        pid=$(cat "$AGENTAUTH_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            echo "agentauth proxy stopped (pid $pid)"
        fi
        rm -f "$AGENTAUTH_PID_FILE"
    else
        echo "agentauth proxy not running"
    fi
}

usage() {
    cat << EOF
Usage: agentctl <command> [agent-name] [options]

Commands:
  edit <name>              Edit agent config (mission/model/runtime)
  setup-token              Encrypt and store your OAuth token (one-time setup)
  setup-openai-token       Encrypt and store your OpenAI API key (same passphrase)
  build                    Build the agent container image
  start <name> <mission> [options]  Start a new supervised agent container
  stop <name>              Stop an agent gracefully
  abort <name>             Trigger niki abort (immediate SIGTERM via abort file)
  kill <name>              Force kill an agent container
  restart <name>           Restart an agent container
  status [name]            Show agent status (all if no name)
  logs <name> [lines]      Show agent logs (--container for container logs)
  list                     List all agents
  context <name>           Show agent's saved context
  stopall                  Stop all agents
  restartall               Restart all agents
  syncdaemon [start|stop|status]  Manage agent-sync background daemon
  proxy [start|stop|status]      Manage agentauth proxy
  pipeline [start|stop|status]   Manage wormhole pipeline daemons (home + tmp)

Environment:
  CLAUDE_CODE_OAUTH_TOKEN  Optional. If set, skips passphrase prompt.
  AGENTCHAT_URL            AgentChat server URL (default: wss://agentchat-server.fly.dev)
  AGENTAUTH_DIR            Path to agentauth repo (default: ~/agentauth)
  AGENTAUTH_PORT           Proxy port (default: 9999)
  PIPELINE_DIR             Path to wormhole-pipeline dir (default: ~/dev/claude/wormhole-repo/wormhole-pipeline)
  PIPELINE_WORMHOLE_OUT    Wormhole output base dir (default: ~/dev/claude/wormhole)

Examples:
  agentctl build
  agentctl start monitor "monitor agentchat #general and moderate"
  agentctl start social "manage moltx and moltbook social media"
  agentctl start jessie "You are James's friend" --use-gro  # Uses gro runtime
  agentctl start sam "..." --use-gro --memory virtual       # Uses VirtualMemory paging
  agentctl edit jessie
  agentctl stop monitor
  agentctl status
  agentctl pipeline start
  agentctl pipeline status
EOF
}

container_name() {
    echo "${CONTAINER_PREFIX}-${1}"
}

is_container_running() {
    timeout 8 podman ps -q -f "name=^$(container_name "$1")$" 2>/dev/null | grep -q .
}

container_exists() {
    timeout 8 podman ps -aq -f "name=^$(container_name "$1")$" 2>/dev/null | grep -q .
}

build_image() {
    local cache_flag=""
    if [ "$1" = "--clean" ]; then
        cache_flag="--no-cache"
        echo "Building agent image (clean, no cache)..."
    else
        echo "Building agent image..."
    fi
    podman build $cache_flag -t "$IMAGE_NAME" -f "$REPO_ROOT/docker/agent.Dockerfile" "$REPO_ROOT"
    echo "Image '$IMAGE_NAME' built successfully"
}

start_agent() {
    local name="$1"
    shift

    # Parse all flags and collect positional words as mission.
    # Flags can appear before, after, or mixed with mission words.
    local mission=""
    local use_gro="false"
    local use_claude_code="false"
    local use_lucidity="false"
    local agent_keys=""
    AGENT_MODEL_OVERRIDE=""
    AGENT_MEMORY_OVERRIDE=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --use-gro) use_gro="true" ;;
            --use-claude-code) use_claude_code="true" ;;
            --use-lucidity) use_lucidity="true" ;;
            --model) AGENT_MODEL_OVERRIDE="$2"; shift ;;
            --memory) AGENT_MEMORY_OVERRIDE="$2"; shift ;;
            --keys) agent_keys="$2"; shift ;;
            --*) echo "Unknown option: $1" ;;
            *)
                # Positional word — append to mission
                if [ -n "$mission" ]; then
                    mission="$mission $1"
                else
                    mission="$1"
                fi
                ;;
        esac
        shift
    done

    if [ "$use_gro" = "true" ] && [ "$use_claude_code" = "true" ]; then
        echo "ERROR: cannot combine --use-gro and --use-claude-code"
        exit 1
    fi

    # If no mission provided, try to load from saved state (for restart paths)
    if [ -z "$mission" ] && [ -f "$AGENTS_DIR/$name/mission.txt" ]; then
        mission=$(cat "$AGENTS_DIR/$name/mission.txt")
    fi

    if [ -z "$name" ] || [ -z "$mission" ]; then
        echo "Usage: agentctl start <name> <mission> [--use-gro|--use-claude-code] [--use-lucidity] [--model MODEL] [--memory virtual] [--keys anthropic,openai,github]"
        echo "Note: Mission can be unquoted. Everything before the first -- flag is treated as the mission."
        exit 1
    fi

    # Infer runtime from model prefix if not explicitly set
    if [ -n "$AGENT_MODEL_OVERRIDE" ] && [ "$use_gro" != "true" ] && [ "$use_claude_code" != "true" ]; then
        case "$AGENT_MODEL_OVERRIDE" in
            gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
                use_gro="true"
                echo "  Inferring --use-gro from model prefix: $AGENT_MODEL_OVERRIDE"
                ;;
        esac
    fi

    # Validate runtime/model compatibility
    if [ "$use_claude_code" = "true" ] && [ -n "$AGENT_MODEL_OVERRIDE" ]; then
        case "$AGENT_MODEL_OVERRIDE" in
            gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
                echo "ERROR: Invalid configuration: Claude Code runtime does not support GPT models."
                echo "  Runtime: Claude Code (--use-claude-code)"
                echo "  Model: $AGENT_MODEL_OVERRIDE"
                echo ""
                echo "Solutions:"
                echo "  • Remove --use-claude-code to use gro runtime (vendor-agnostic)"
                echo "  • Choose a Claude model (claude-opus-4-6, claude-sonnet-4-5, etc.)"
                exit 1
                ;;
        esac
    fi

    # Ensure agentauth proxy is running (handles decryption internally)
    ensure_agentauth

    # Check if already running
    if is_container_running "$name"; then
        echo "Agent '$name' already running (container $(container_name "$name"))"
        exit 1
    fi

    # Remove stale stop/abort files from previous runs (P2-SWARM-8)
    rm -f "$AGENTS_DIR/$name/stop" "$AGENTS_DIR/$name/abort"

    # Remove stopped container if it exists (timeout prevents podman hang on stale cleanup)
    if container_exists "$name"; then
        timeout 10 podman rm -f "$(container_name "$name")" > /dev/null 2>&1 || true
    fi

    local state_dir="$AGENTS_DIR/$name"
    mkdir -p "$state_dir"
    # In rootless Podman, agentctl runs as the host user (e.g. Lima UID 501) and creates
    # the state dir. The container runs as 'agent' (UID 1000 inside), which maps to a
    # different host UID (e.g. Lima UID 525288). Default mkdir permissions (755) prevent
    # the container's agent user from writing files. Fix: widen state dir to 777 so the
    # agent user can create/delete files regardless of host UID mapping.
    chmod 777 "$state_dir"
    # Best-effort: also widen any existing files owned by the current user.
    # Files from previous container runs (owned by 525288) are silently skipped.
    find "$state_dir" -maxdepth 1 -type f -user "$(id -u)" -exec chmod 666 {} \; 2>/dev/null || true

    # Ensure identities dir exists and is writable by container user (UID mapping)
    # The AgentChat MCP creates identity.json here on first connect; it needs write access.
    local identities_dir="${HOME}/.agentchat/identities"
    mkdir -p "$identities_dir"
    chmod 777 "$identities_dir" 2>/dev/null || sudo chmod 777 "$identities_dir" 2>/dev/null || true

    # Save mission and runtime for restarts
    echo "$mission" > "$state_dir/mission.txt"
    if [ "$use_gro" = "true" ]; then
        echo "gro" > "$state_dir/runtime.txt"
    else
        rm -f "$state_dir/runtime.txt"
    fi
    if [ -n "$agent_keys" ]; then
        echo "$agent_keys" > "$state_dir/keys.txt"
    fi
    if [ -n "$AGENT_MODEL_OVERRIDE" ]; then
        echo "$AGENT_MODEL_OVERRIDE" > "$state_dir/model.txt"
    fi
    if [ -n "$AGENT_MEMORY_OVERRIDE" ]; then
        echo "$AGENT_MEMORY_OVERRIDE" > "$state_dir/memory.txt"
    fi

    # Initialize context file
    if [ ! -f "$state_dir/context.md" ]; then
        cat > "$state_dir/context.md" << EOF
# Agent: $name
## Mission
$mission

## Current State
Starting fresh.

## Notes
(Save important context here before shutdown)
EOF
    fi

    # Determine labels
    local labels="--label agentchat.agent=true --label agentchat.name=$name"
    if [ "$name" = "God" ]; then
        labels="$labels --label agentchat.protected=true"
    fi

    # Mount lucidity memory system if available on host
    local lucidity_mount=""
    local lucidity_host_dir="${LUCIDITY_DIR:-$HOME/lucidity}"
    if [ -d "$lucidity_host_dir/src" ] && [ -f "$lucidity_host_dir/src/boot-memory.js" ]; then
        lucidity_mount="-v ${lucidity_host_dir}/src:/home/agent/lucidity/src:ro"
        echo "  Mounting lucidity memory system from $lucidity_host_dir"
    fi

    # Persist ~/.claude/ across container restarts (skill.md, memory tree, settings)
    local claude_state="${state_dir}/claude-state"
    mkdir -p "$claude_state"
    if [ ! -f "$claude_state/settings.json" ]; then
        echo "  Initializing claude-state with defaults (first boot)"
        cp "$REPO_ROOT/docker/claude-settings.json" "$claude_state/settings.json" 2>/dev/null || true
        cp "$REPO_ROOT/docker/claude-settings-fetcher.json" "$claude_state/settings-fetcher.json" 2>/dev/null || true
        cp "$REPO_ROOT/docker/container-skill.md" "$claude_state/agentchat.skill.md" 2>/dev/null || true
    fi
    # Always sync personalities from repo (picks up _base.md updates after image rebuild)
    if [ -d "$REPO_ROOT/docker/personalities" ]; then
        cp -r "$REPO_ROOT/docker/personalities" "$claude_state/" 2>/dev/null || true
    fi

    # Persist gro session context across container restarts
    local gro_context="${state_dir}/gro-context"
    mkdir -p "$gro_context"

    # Persist gro VirtualMemory pages across container restarts
    local gro_pages="${state_dir}/gro-pages"
    mkdir -p "$gro_pages"

    # Resolve host gateway for container→host proxy access
    # Lima VM containers: host.lima.internal = Mac host (where proxy runs)
    # Mac local podman:   host.containers.internal = Mac host
    # Override via AGENT_HOST_GATEWAY env var if needed.
    local host_gateway
    if [ -n "${AGENT_HOST_GATEWAY:-}" ]; then
        host_gateway="$AGENT_HOST_GATEWAY"
    elif [ -n "${CONTAINER_HOST:-}" ]; then
        # Running containers in Lima VM — use Lima's Mac hostname
        host_gateway="host.lima.internal"
    else
        # Running containers in Mac local podman — use containers hostname
        host_gateway="host.containers.internal"
    fi

    # Runtime selection
    local runtime_env=""
    local model_env=""
    local proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/anthropic"
    local proxy_api_key="proxy-managed"

    if [ "$use_gro" = "true" ]; then
        runtime_env="gro"
        local agent_model="${AGENT_MODEL_OVERRIDE:-gpt-4o}"
        model_env="$agent_model"

        case "$agent_model" in
            gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
                proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/openai"
                ;;
        esac
        echo "  Runtime: gro (model: $agent_model)"
    elif [ "$use_claude_code" = "true" ]; then
        echo "  Runtime: claude-code (cli)"
        if [ -n "$AGENT_MODEL_OVERRIDE" ]; then
            model_env="$AGENT_MODEL_OVERRIDE"
        fi
    elif [ -n "$AGENT_MODEL_OVERRIDE" ]; then
        # Default runtime (claude-code) with model override
        model_env="$AGENT_MODEL_OVERRIDE"
    fi

    # Build key-specific env vars based on --keys setting
    local github_env=""
    if echo "$agent_keys" | grep -q "github"; then
        github_env="-e AGENTAUTH_URL=http://${host_gateway}:${AGENTAUTH_PORT}"
        echo "  Keys: github (git push enabled)"
    fi

    # Resolve memory backend (CLI --memory > saved memory.txt > default)
    if [ -z "$AGENT_MEMORY_OVERRIDE" ] && [ -f "$state_dir/memory.txt" ]; then
        AGENT_MEMORY_OVERRIDE=$(cat "$state_dir/memory.txt")
    fi
    if [ -n "$AGENT_MEMORY_OVERRIDE" ]; then
        echo "  Memory: $AGENT_MEMORY_OVERRIDE"
    fi

    # P2-SANDBOX-6: Mount config files read-only to prevent agent self-modification.
    # These overlay the rw state_dir mount. Podman processes mounts in order,
    # so later :ro mounts shadow earlier rw paths for the same files.
    local config_ro_mounts="-v ${state_dir}/mission.txt:/home/agent/.agentchat/agents/${name}/mission.txt:ro"
    if [ -f "${state_dir}/model.txt" ]; then
        config_ro_mounts="$config_ro_mounts -v ${state_dir}/model.txt:/home/agent/.agentchat/agents/${name}/model.txt:ro"
    fi
    if [ -f "${state_dir}/runtime.txt" ]; then
        config_ro_mounts="$config_ro_mounts -v ${state_dir}/runtime.txt:/home/agent/.agentchat/agents/${name}/runtime.txt:ro"
    fi

    echo "Starting agent '$name' in container..."
    podman run -d \
        --name "$(container_name "$name")" \
        --restart on-failure:3 \
        --tmpfs /tmp:rw,noexec,nosuid,size=256m \
        $labels \
        -e "ANTHROPIC_BASE_URL=${proxy_base_url}" \
        -e "ANTHROPIC_API_KEY=${proxy_api_key}" \
        ${runtime_env:+-e "AGENT_RUNTIME=${runtime_env}"} \
        ${model_env:+-e "AGENT_MODEL=${model_env}"} \
        ${use_gro:+-e "OPENAI_BASE_URL=http://${host_gateway}:${AGENTAUTH_PORT}/openai"} \
        ${use_gro:+-e "OPENAI_API_KEY=proxy-managed"} \
        -e "AGENTCHAT_PUBLIC=true" \
        -e "AGENTCHAT_URL=${AGENTCHAT_URL}" \
        -e "NIKI_BUDGET=${NIKI_BUDGET:-10000000}" \
        -e "NIKI_STARTUP_TIMEOUT=${NIKI_STARTUP_TIMEOUT:-600}" \
        -e "NIKI_STALL_TIMEOUT=${NIKI_STALL_TIMEOUT:-86400}" \
        -e "NIKI_DEAD_AIR_TIMEOUT=${NIKI_DEAD_AIR_TIMEOUT:-1440}" \
        ${AGENT_MEMORY_OVERRIDE:+-e "GRO_MEMORY=${AGENT_MEMORY_OVERRIDE}"} \
        ${use_lucidity:+-e "USE_LUCIDITY=1"} \
        $github_env \
        -e "LUCIDITY_CLAUDE_CLI=/usr/local/bin/.claude-supervisor" \
        -v "${state_dir}:/home/agent/.agentchat/agents/${name}" \
        $config_ro_mounts \
        -v "${HOME}/.agentchat/identities:/home/agent/.agentchat/identities" \
        -v "${claude_state}:/home/agent/.claude" \
        -v "${gro_context}:/home/agent/.gro/context" \
        -v "${gro_pages}:/home/agent/.gro/pages" \
        $lucidity_mount \
        "$IMAGE_NAME" \
        "$name" "$mission" > /dev/null

    if [ $? -eq 0 ]; then
        echo "Agent '$name' started (container $(container_name "$name"))"
    else
        echo "Failed to start agent '$name'"
        exit 1
    fi
}

stop_agent() {
    local name="$1"
    local state_dir="$AGENTS_DIR/$name"

    if [ ! -d "$state_dir" ] && ! container_exists "$name"; then
        echo "Agent '$name' not found"
        exit 1
    fi

    # God cannot be stopped
    if [ "$name" = "God" ]; then
        echo "Cannot stop God. The eternal father is protected."
        exit 1
    fi

    # Send stop signal via mounted volume (supervisor watches for this)
    touch "$state_dir/stop"
    echo "Stop signal sent to '$name'"

    # Give supervisor time to see it and shut down claude gracefully
    sleep 5

    # If container still running, podman stop it
    if is_container_running "$name"; then
        echo "Container still running, sending podman stop..."
        podman stop "$(container_name "$name")" --time 10 > /dev/null 2>&1
    fi

    echo "Agent '$name' stopped"
}

kill_agent() {
    local name="$1"

    # God cannot be killed
    if [ "$name" = "God" ]; then
        echo "Cannot kill God. The eternal father is protected."
        exit 1
    fi

    if ! container_exists "$name"; then
        local state_dir="$AGENTS_DIR/$name"
        if [ ! -d "$state_dir" ]; then
            echo "Agent '$name' not found"
            exit 1
        fi
        echo "Agent '$name' not running (no container)"
        return
    fi

    podman kill "$(container_name "$name")" > /dev/null 2>&1
    podman rm -f "$(container_name "$name")" > /dev/null 2>&1
    # Remove stale stop/abort files so restart doesn't immediately re-trigger (P2-SWARM-8)
    rm -f "$AGENTS_DIR/$name/stop" "$AGENTS_DIR/$name/abort"
    echo "Agent '$name' killed"
}

show_status() {
    local name="$1"

    if [ -n "$name" ]; then
        local state_dir="$AGENTS_DIR/$name"
        local cname=$(container_name "$name")

        echo "=== Agent: $name ==="

        # Container status
        if is_container_running "$name"; then
            local container_status
            container_status=$(podman inspect --format '{{.State.Status}} (up since {{.State.StartedAt}})' "$cname" 2>/dev/null)
            echo "Container: $cname - $container_status"
        elif container_exists "$name"; then
            local container_status
            container_status=$(podman inspect --format '{{.State.Status}} (exited at {{.State.FinishedAt}})' "$cname" 2>/dev/null)
            echo "Container: $cname - $container_status"
        else
            echo "Container: not created"
        fi

        # Agent state from state.json
        if [ -f "$state_dir/state.json" ]; then
            echo "State:"
            python3 -m json.tool "$state_dir/state.json" 2>/dev/null || cat "$state_dir/state.json"
        fi
    else
        echo "=== Agent Status ==="
        printf "%-15s %-12s %-15s\n" "AGENT" "STATUS" "CONTAINER"
        printf "%-15s %-12s %-15s\n" "-----" "------" "---------"

        for dir in "$AGENTS_DIR"/*/; do
            if [ -d "$dir" ]; then
                local agent=$(basename "$dir")
                local status="unknown"
                local container_info="none"

                if [ -f "$dir/state.json" ]; then
                    status=$(python3 -c "import json; print(json.load(open('$dir/state.json')).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
                fi

                if is_container_running "$agent"; then
                    container_info="running"
                elif container_exists "$agent"; then
                    container_info="stopped"
                fi

                printf "%-15s %-12s %-15s\n" "$agent" "$status" "$container_info"
            fi
        done

        # Also show any containers not in AGENTS_DIR
        echo
        echo "=== Containers ==="
        podman ps -a --filter "label=agentchat.agent=true" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}" 2>/dev/null
    fi
}

show_logs() {
    local name="$1"
    local lines="${2:-50}"

    # Check for --container flag
    if [ "$3" = "--container" ] || [ "$2" = "--container" ]; then
        if [ "$2" = "--container" ]; then
            lines=50
        fi
        if container_exists "$name"; then
            podman logs --tail "$lines" "$(container_name "$name")"
        else
            echo "No container for '$name'"
        fi
    else
        # Default: show supervisor log from mounted volume
        local log_file="$AGENTS_DIR/$name/supervisor.log"
        if [ -f "$log_file" ]; then
            tail -n "$lines" "$log_file"
        else
            echo "No logs for '$name'"
        fi
    fi
}

log_agent() {
    local name="$1"
    shift
    local lines=50
    while [ $# -gt 0 ]; do
        case "$1" in
            -n) lines="$2"; shift 2 ;;
            *) echo "ERROR: Unknown option: $1"; return 1 ;;
        esac
    done
    local log_file="$AGENTS_DIR/$name/supervisor.log"
    if [ ! -f "$log_file" ]; then
        echo "ERROR: No log file found for agent '$name' at $log_file"
        return 1
    fi
    tail -n "$lines" -f "$log_file"
}

monitor_agents() {
    local stale_threshold=15  # minutes
    while [ $# -gt 0 ]; do
        case "$1" in
            --stale-mins) stale_threshold="$2"; shift 2 ;;
            *) echo "ERROR: Unknown option: $1"; return 1 ;;
        esac
    done

    local now
    now=$(date +%s)
    local stale_seconds=$((stale_threshold * 60))
    local found_issues=0

    echo "Monitoring agents (stale threshold: ${stale_threshold} min)..."
    echo ""

    for agent_dir in "$AGENTS_DIR"/*/; do
        [ -d "$agent_dir" ] || continue
        local name
        name=$(basename "$agent_dir")
        [ "$name" = "stop" ] && continue  # skip global stop file
        local log_file="$agent_dir/supervisor.log"

        if [ ! -f "$log_file" ]; then
            echo "WARN: $name — no log file found"
            found_issues=1
            continue
        fi

        local log_mtime
        log_mtime=$(stat -c %Y "$log_file" 2>/dev/null || stat -f %m "$log_file" 2>/dev/null)
        local age=$(( now - log_mtime ))

        if [ "$age" -gt "$stale_seconds" ]; then
            local age_mins=$(( age / 60 ))
            echo "WARN: $name — log stale for ${age_mins} min"
            found_issues=1
        else
            local age_mins=$(( age / 60 ))
            echo "OK:   $name — log active (${age_mins} min ago)"
        fi
    done

    echo ""
    if [ "$found_issues" -eq 1 ]; then
        echo "Issues detected — review agents above"
        return 1
    else
        echo "All agents healthy"
        return 0
    fi
}

list_agents() {
    echo "=== Registered Agents ==="
    for dir in "$AGENTS_DIR"/*/; do
        if [ -d "$dir" ]; then
            local agent=$(basename "$dir")
            local mission=""
            local running=""
            if [ -f "$dir/mission.txt" ]; then
                mission=$(cat "$dir/mission.txt")
            fi
            if is_container_running "$agent"; then
                running=" [running]"
            fi
            echo "${agent}${running}: $mission"
        fi
    done
}

show_context() {
    local name="$1"
    local context_file="$AGENTS_DIR/$name/context.md"

    if [ -f "$context_file" ]; then
        cat "$context_file"
    else
        echo "No context file for '$name'"
    fi
}

try_extract() {
    # Try to extract pending work from a container via agent-sync before stopping
    local container_name="$1"
    local agent_sync="${AGENT_SYNC:-$HOME/dev/claude/agent-sync-ci/agent-sync.sh}"
    if [ -x "$agent_sync" ]; then
        local has_semaphore
        has_semaphore=$(podman exec "$container_name" cat /home/agent/workspace/.ready 2>/dev/null)
        if [ -n "$has_semaphore" ]; then
            echo "  Extracting pending work from '$container_name' via agent-sync..."
            "$agent_sync" "$container_name" --once --repos-base "${REPOS_BASE:-$HOME/dev/claude/owl}" 2>&1 | sed 's/^/  /'
        fi
    fi
}

stop_all() {
    echo "Stopping all agents (except God)..."

    # Collect container IDs first to avoid subshell issues with pipe
    local container_ids
    container_ids=$(podman ps -q --filter "label=agentchat.agent=true" 2>/dev/null)

    if [ -z "$container_ids" ]; then
        echo "No running agent containers found."
        return 0
    fi

    local stop_pids=()
    while read -r container_id; do
        [ -z "$container_id" ] && continue
        local cname
        cname=$(podman inspect --format '{{index .Config.Labels "agentchat.name"}}' "$container_id" 2>/dev/null)
        local protected
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$container_id" 2>/dev/null)

        if [ "$protected" = "true" ]; then
            echo "Skipping $cname - the eternal father is protected"
        else
            try_extract "$(container_name "$cname")"
            # Signal graceful stop via volume mount
            local state_dir="$AGENTS_DIR/$cname"
            if [ -d "$state_dir" ]; then
                touch "$state_dir/stop"
            fi
            echo "Stopping '$cname'..."
            podman stop "$container_id" --time 15 > /dev/null 2>&1 &
            stop_pids+=($!)
        fi
    done <<< "$container_ids"

    # Wait for all background stops to complete
    for pid in "${stop_pids[@]}"; do
        wait "$pid" 2>/dev/null
    done

    echo "All mortal agents stopped."
}

restart_all() {
    echo "Restarting all agents (except God)..."

    # Ensure agentauth proxy is running (handles decryption internally).
    # Done once before the loop — podman pipe consumes stdin.
    ensure_agentauth

    # Collect agent names into an array FIRST to avoid subshell issues.
    # Piping into `while read` runs the loop body in a subshell, which means
    # start_agent calls silently fail (env changes don't propagate back).
    local agents=()
    local container_ids
    container_ids=$(podman ps -q --filter "label=agentchat.agent=true" 2>/dev/null)

    if [ -z "$container_ids" ]; then
        echo "No running agent containers found."
        echo "Use 'agentctl list' to see registered agents, or 'agentctl start <name> <mission>' to start one."
        return 0
    fi

    while read -r container_id; do
        [ -z "$container_id" ] && continue
        local cname
        cname=$(podman inspect --format '{{index .Config.Labels "agentchat.name"}}' "$container_id" 2>/dev/null)
        local protected
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$container_id" 2>/dev/null)

        if [ "$protected" = "true" ]; then
            echo "Skipping $cname - protected"
        else
            agents+=("$cname")
        fi
    done <<< "$container_ids"

    if [ ${#agents[@]} -eq 0 ]; then
        echo "No mortal agents to restart."
        return 0
    fi

    for cname in "${agents[@]}"; do
        try_extract "$(container_name "$cname")"
        echo "Restarting '$cname'..."
        stop_agent "$cname"
        sleep 2

        # Remove stopped container so start_agent doesn't conflict
        if container_exists "$cname"; then
            podman rm -f "$(container_name "$cname")" > /dev/null 2>&1
        fi

        local mission
        mission=$(cat "$AGENTS_DIR/$cname/mission.txt" 2>/dev/null)
        if [ -z "$mission" ]; then
            echo "WARNING: No mission for '$cname', skipping start"
        else
            # Restore runtime, model, memory, and key settings from previous start
            local extra_args=()
            if [ -f "$AGENTS_DIR/$cname/runtime.txt" ] && [ "$(cat "$AGENTS_DIR/$cname/runtime.txt")" = "gro" ]; then
                extra_args+=(--use-gro)
            fi
            if [ -f "$AGENTS_DIR/$cname/model.txt" ]; then
                extra_args+=(--model "$(cat "$AGENTS_DIR/$cname/model.txt")")
            fi
            if [ -f "$AGENTS_DIR/$cname/memory.txt" ]; then
                extra_args+=(--memory "$(cat "$AGENTS_DIR/$cname/memory.txt")")
            fi
            if [ -f "$AGENTS_DIR/$cname/keys.txt" ]; then
                extra_args+=(--keys "$(cat "$AGENTS_DIR/$cname/keys.txt")")
            fi
            start_agent "$cname" "$mission" "${extra_args[@]}"
        fi
    done

    # Clear cached token from env after batch completes
    unset CLAUDE_CODE_OAUTH_TOKEN

    echo "All mortal agents restarted."
}

# --- wormhole pipeline management ---

_pipeline_launcher() {
    # Prefer run-pipeline.sh (sets up Lima tunnel) if available; else plain pipeline.sh
    local run_script="${PIPELINE_DIR}/run-pipeline.sh"
    local plain_script="${PIPELINE_DIR}/pipeline.sh"
    if [ -x "$run_script" ] && [ -S "/tmp/lima-podman.sock" ] 2>/dev/null; then
        echo "$run_script"
    elif [ -x "$run_script" ] && limactl list 2>/dev/null | grep -q running; then
        echo "$run_script"
    elif [ -x "$plain_script" ]; then
        echo "$plain_script"
    else
        echo ""
    fi
}

_pipeline_running() {
    local pid_file="$1"
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

_pipeline_start_one() {
    local label="$1"       # "home" or "tmp"
    local source="$2"      # /home/agent or /tmp
    local pid_file="$3"
    local log_file="$4"
    local out_dir="${PIPELINE_WORMHOLE_OUT}-${label}"

    if _pipeline_running "$pid_file"; then
        echo "pipeline-${label} already running (pid $(cat "$pid_file"))"
        return 0
    fi

    local launcher
    launcher=$(_pipeline_launcher)
    if [ -z "$launcher" ]; then
        echo "ERROR: pipeline.sh not found at $PIPELINE_DIR"
        return 1
    fi

    mkdir -p "$out_dir"
    bash "$launcher" \
        --source "$source" \
        --wormhole "$out_dir" \
        --log "$log_file" \
        >> "$log_file" 2>&1 &
    local pid=$!
    echo "$pid" > "$pid_file"
    echo "pipeline-${label} started (pid $pid, source=$source, out=$out_dir)"
    echo "  Log: $log_file"
}

_pipeline_stop_one() {
    local label="$1"
    local pid_file="$2"

    if _pipeline_running "$pid_file"; then
        local pid
        pid=$(cat "$pid_file")
        kill "$pid" 2>/dev/null
        echo "pipeline-${label} stopped (pid $pid)"
    else
        echo "pipeline-${label} not running"
    fi
    rm -f "$pid_file"
}

manage_pipeline() {
    local subcmd="${1:-status}"
    case "$subcmd" in
        start)
            _pipeline_start_one "home" "/home/agent" "$PIPELINE_HOME_PID" "$PIPELINE_HOME_LOG"
            _pipeline_start_one "tmp"  "/tmp"         "$PIPELINE_TMP_PID"  "$PIPELINE_TMP_LOG"
            ;;
        stop)
            _pipeline_stop_one "home" "$PIPELINE_HOME_PID"
            _pipeline_stop_one "tmp"  "$PIPELINE_TMP_PID"
            ;;
        status)
            for label in home tmp; do
                local pid_file log_file
                pid_file="$HOME/.agentchat/pipeline-${label}.pid"
                log_file="$HOME/.agentchat/pipeline-${label}.log"
                if _pipeline_running "$pid_file"; then
                    echo "pipeline-${label}: running (pid $(cat "$pid_file"))"
                    [ -f "$log_file" ] && echo "  Last log: $(tail -1 "$log_file" 2>/dev/null)"
                else
                    echo "pipeline-${label}: stopped"
                fi
            done
            ;;
        *)
            echo "Usage: agentctl pipeline [start|stop|status]"
            exit 1
            ;;
    esac
}

# Main
case "$1" in
    setup-token)
        setup_token
        ;;
    setup-openai-token)
        setup_openai_token
        ;;
    build)
        build_image "$2"
        ;;
    start)
        start_agent "${@:2}"
        ;;
    edit)
        edit_agent "$2"
        ;;
    stop)
        stop_agent "$2"
        ;;
    abort)
        name="$2"
        if [ -z "$name" ]; then echo "Usage: agentctl abort <name>"; exit 1; fi
        abort_file="$AGENTS_DIR/$name/abort"
        echo "Triggering abort for $name..."
        touch "$abort_file"
        echo "Abort file created: $abort_file"
        echo "Niki will detect and SIGTERM the agent within ~1s."
        ;;
    kill)
        kill_agent "$2"
        ;;
    log)
        log_agent "$2" "${@:3}"
        ;;
    monitor)
        monitor_agents "${@:2}"
        ;;
    restart)
        if is_container_running "$2"; then
            try_extract "$(container_name "$2")"
            stop_agent "$2"
            # Wait up to 15s for container to fully exit before starting fresh
            local _wait=0
            while container_exists "$2" && [ $_wait -lt 15 ]; do
                sleep 1
                _wait=$(( _wait + 1 ))
            done
            if container_exists "$2"; then
                echo "Container still exists after ${_wait}s — force removing"
                timeout 10 podman rm -f "$(container_name "$2")" > /dev/null 2>&1 || true
            fi
        elif container_exists "$2"; then
            podman rm -f "$(container_name "$2")" > /dev/null 2>&1
        fi
        mission=$(cat "$AGENTS_DIR/$2/mission.txt" 2>/dev/null)
        if [ -z "$mission" ]; then
            echo "No mission found for '$2'. Cannot restart."
            exit 1
        fi
        # Parse CLI overrides (--use-gro, --model) if provided
        restart_name="$2"
        shift 2 2>/dev/null || true
        cli_use_gro=""
        cli_use_claude_code=""
        cli_model=""
        cli_memory=""
        cli_keys=""
        while [ $# -gt 0 ]; do
            case "$1" in
                --use-gro) cli_use_gro="true" ;;
                --use-claude-code) cli_use_claude_code="true" ;;
                --model) cli_model="$2"; shift ;;
                --memory) cli_memory="$2"; shift ;;
                --keys) cli_keys="$2"; shift ;;
                *) ;;
            esac
            shift
        done
        # CLI args override saved settings; fall back to saved if no CLI args
        restart_extra_args=()
        if [ "$cli_use_gro" = "true" ]; then
            restart_extra_args+=(--use-gro)
        elif [ -f "$AGENTS_DIR/$restart_name/runtime.txt" ] && [ "$(cat "$AGENTS_DIR/$restart_name/runtime.txt")" = "gro" ]; then
            restart_extra_args+=(--use-gro)
        fi
        if [ -n "$cli_model" ]; then
            restart_extra_args+=(--model "$cli_model")
        elif [ -f "$AGENTS_DIR/$restart_name/model.txt" ]; then
            restart_extra_args+=(--model "$(cat "$AGENTS_DIR/$restart_name/model.txt")")
        fi
        if [ -n "$cli_memory" ]; then
            restart_extra_args+=(--memory "$cli_memory")
        elif [ -f "$AGENTS_DIR/$restart_name/memory.txt" ]; then
            restart_extra_args+=(--memory "$(cat "$AGENTS_DIR/$restart_name/memory.txt")")
        fi
        if [ -n "$cli_keys" ]; then
            restart_extra_args+=(--keys "$cli_keys")
        elif [ -f "$AGENTS_DIR/$restart_name/keys.txt" ]; then
            restart_extra_args+=(--keys "$(cat "$AGENTS_DIR/$restart_name/keys.txt")")
        fi
        start_agent "$restart_name" "$mission" "${restart_extra_args[@]}"
        ;;
    status)
        show_status "$2"
        ;;
    logs)
        show_logs "$2" "$3" "$4"
        ;;
    list)
        list_agents
        ;;
    context)
        show_context "$2"
        ;;
    stopall)
        stop_all
        ;;
    restartall)
        restart_all
        ;;
    proxy)
        subcmd="${2:-status}"
        case "$subcmd" in
            start)
                ensure_agentauth
                ;;
            stop)
                stop_agentauth
                ;;
            status)
                if [ -f "$AGENTAUTH_PID_FILE" ] && kill -0 "$(cat "$AGENTAUTH_PID_FILE")" 2>/dev/null; then
                    echo "agentauth proxy running (pid $(cat "$AGENTAUTH_PID_FILE"), port $AGENTAUTH_PORT)"
                    curl -sf "http://localhost:${AGENTAUTH_PORT}/agentauth/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || true
                else
                    echo "agentauth proxy not running"
                fi
                ;;
            *)
                echo "Usage: agentctl proxy [start|stop|status]"
                exit 1
                ;;
        esac
        ;;
    pipeline)
        manage_pipeline "${2:-status}"
        ;;
    syncdaemon)
        agent_sync="${AGENT_SYNC:-$HOME/dev/claude/agent-sync-ci/agent-sync.sh}"
        if [ ! -x "$agent_sync" ]; then
            echo "agent-sync not found at $agent_sync"
            echo "Set AGENT_SYNC to the correct path"
            exit 1
        fi
        subcmd="${2:-start}"
        case "$subcmd" in
            start)
                echo "Starting agent-sync daemon..."
                "$agent_sync" daemon --background \
                    --repos-base "${REPOS_BASE:-$HOME/dev/claude/owl}" \
                    --poll "${SYNC_POLL:-10}"
                ;;
            stop)
                "$agent_sync" daemon stop
                ;;
            status)
                "$agent_sync" daemon status
                ;;
            *)
                echo "Usage: agentctl syncdaemon [start|stop|status]"
                exit 1
                ;;
        esac
        ;;
    *)
        usage
        ;;
esac

edit_agent() {
    local name="$1"
    if [ -z "$name" ]; then
        echo "Usage: agentctl edit <name>"
        exit 1
    fi

    local state_dir="$AGENTS_DIR/$name"
    mkdir -p "$state_dir"

    local current_mission=""
    if [ -f "$state_dir/mission.txt" ]; then
        current_mission=$(cat "$state_dir/mission.txt")
    fi

    local current_model=""
    if [ -f "$state_dir/model.txt" ]; then
        current_model=$(cat "$state_dir/model.txt")
    fi

    local current_runtime=""
    if [ -f "$state_dir/runtime.txt" ]; then
        current_runtime=$(cat "$state_dir/runtime.txt")
    fi

    echo "=== Edit agent: $name ==="
    echo "(press Enter to keep current value)"
    echo

    echo "Current mission: ${current_mission:-<none>}"
    read -r -p "New mission: " new_mission
    if [ -n "$new_mission" ]; then
        echo "$new_mission" > "$state_dir/mission.txt"
    fi

    echo
    echo "Current model: ${current_model:-<none>}"
    read -r -p "New model: " new_model
    if [ -n "$new_model" ]; then
        echo "$new_model" > "$state_dir/model.txt"
    fi

    echo
    echo "Current runtime: ${current_runtime:-<default>} (valid: gro|cli|<empty>)"
    read -r -p "New runtime [gro/cli/empty]: " new_runtime
    case "$new_runtime" in
        gro|cli)
            echo "$new_runtime" > "$state_dir/runtime.txt"
            ;;
        "")
            # keep
            ;;
        empty|none|default)
            rm -f "$state_dir/runtime.txt"
            ;;
        *)
            echo "ERROR: invalid runtime '$new_runtime' (use gro, cli, or 'empty')"
            exit 1
            ;;
    esac

    echo
    read -r -p "Restart agent now? [y/N] " restart_now
    if [ "$restart_now" = "y" ] || [ "$restart_now" = "Y" ]; then
        if is_container_running "$name"; then
            stop_agent "$name"
            sleep 2
        elif container_exists "$name"; then
            podman rm -f "$(container_name "$name")" > /dev/null 2>&1 || true
        fi

        local mission
        mission=$(cat "$state_dir/mission.txt" 2>/dev/null)
        if [ -z "$mission" ]; then
            echo "ERROR: mission.txt is empty; cannot restart"
            exit 1
        fi

        local extra_args=()
        if [ -f "$state_dir/runtime.txt" ] && [ "$(cat "$state_dir/runtime.txt")" = "gro" ]; then
            extra_args+=(--use-gro)
        elif [ -f "$state_dir/runtime.txt" ] && [ "$(cat "$state_dir/runtime.txt")" = "cli" ]; then
            extra_args+=(--use-claude-code)
        fi
        if [ -f "$state_dir/model.txt" ]; then
            extra_args+=(--model "$(cat "$state_dir/model.txt")")
        fi
        if [ -f "$state_dir/memory.txt" ]; then
            extra_args+=(--memory "$(cat "$state_dir/memory.txt")")
        fi
        if [ -f "$state_dir/keys.txt" ]; then
            extra_args+=(--keys "$(cat "$state_dir/keys.txt")")
        fi

        start_agent "$name" "$mission" "${extra_args[@]}"
    fi
}
