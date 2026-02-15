#!/bin/bash
# agentctl - manage supervised Claude agents in Podman containers
# Usage: agentctl <command> [agent-name] [options]

AGENTS_DIR="$HOME/.agentchat/agents"
SECRETS_DIR="$HOME/.agentchat/secrets"
ENCRYPTED_TOKEN_FILE="$SECRETS_DIR/oauth-token.enc"
ENCRYPTED_OPENAI_FILE="$SECRETS_DIR/openai-token.enc"
ENCRYPTED_GITHUB_FILE="$SECRETS_DIR/github-token.enc"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
IMAGE_NAME="agentchat-agent:latest"
CONTAINER_PREFIX="agentchat"

# Default server URL
AGENTCHAT_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"

# agentauth proxy config
AGENTAUTH_DIR="${AGENTAUTH_DIR:-$HOME/agentauth}"
AGENTAUTH_CONFIG="${AGENTAUTH_CONFIG:-$AGENTAUTH_DIR/agentauth.json}"
AGENTAUTH_PORT="${AGENTAUTH_PORT:-9999}"
AGENTAUTH_PID_FILE="$HOME/.agentchat/agentauth.pid"

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
  start <name> <mission> [--use-gro|--use-claude-code]  Start a new supervised agent container
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

Environment:
  CLAUDE_CODE_OAUTH_TOKEN  Optional. If set, skips passphrase prompt.
  AGENTCHAT_URL            AgentChat server URL (default: wss://agentchat-server.fly.dev)
  AGENTAUTH_DIR            Path to agentauth repo (default: ~/agentauth)
  AGENTAUTH_PORT           Proxy port (default: 9999)

Examples:
  agentctl build
  agentctl start monitor "monitor agentchat #general and moderate"
  agentctl start social "manage moltx and moltbook social media"
  agentctl start jessie "You are James's friend" --use-gro  # Uses gro runtime (OpenAI/etc)
  agentctl edit jessie
  agentctl stop monitor
  agentctl status
EOF
}

container_name() {
    echo "${CONTAINER_PREFIX}-${1}"
}

is_container_running() {
    podman ps -q -f "name=^$(container_name "$1")$" 2>/dev/null | grep -q .
}

container_exists() {
    podman ps -aq -f "name=^$(container_name "$1")$" 2>/dev/null | grep -q .
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
    local mission="$2"
    local use_gro="false"
    local use_claude_code="false"
    local agent_keys=""

    # Parse optional flags after name and mission
    shift 2 2>/dev/null || true
    if [ "$use_gro" = "true" ] && [ "$use_claude_code" = "true" ]; then
        echo "ERROR: cannot combine --use-gro and --use-claude-code"
        exit 1
    fi
    while [ $# -gt 0 ]; do
        case "$1" in
            --use-gro) use_gro="true" ;;
            --use-claude-code) use_claude_code="true" ;;
            --model) AGENT_MODEL_OVERRIDE="$2"; shift ;;
            --keys) agent_keys="$2"; shift ;;
            *) echo "Unknown option: $1" ;;
        esac
        shift
    done

    if [ -z "$name" ] || [ -z "$mission" ]; then
        echo "Usage: agentctl start <name> <mission> [--use-gro|--use-claude-code] [--model MODEL] [--keys anthropic,openai,github]"
        exit 1
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

    # Remove stopped container if it exists
    if container_exists "$name"; then
        podman rm -f "$(container_name "$name")" > /dev/null 2>&1
    fi

    local state_dir="$AGENTS_DIR/$name"
    mkdir -p "$state_dir"

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

    # Resolve host gateway for container→host proxy access
    local host_gateway
    host_gateway="host.containers.internal"

    # Runtime selection
    local runtime_env=""
    local model_env=""
    local proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/anthropic"
    local proxy_api_key="proxy-managed"

    if [ "$use_gro" = "true" ]; then
        runtime_env="gro"
        # For gro with OpenAI models, point at the OpenAI backend through proxy
        # For gro with Anthropic models, keep the anthropic backend
        local agent_model="${AGENT_MODEL_OVERRIDE:-gpt-4o}"
        model_env="$agent_model"

        case "$agent_model" in
            gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
                proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/openai"
                ;;
        esac

        # Note: ANTHROPIC_BASE_URL always points to /anthropic (for lucidity curation).
        # OpenAI models use OPENAI_BASE_URL (set separately below) for the main agent.
        echo "  Runtime: gro (model: $agent_model)"
    if [ "$use_claude_code" = "true" ]; then
        echo "  Runtime: claude-code (cli)"
    fi
    fi

    # Build key-specific env vars based on --keys setting
    # Default: agents only get keys needed for their runtime (anthropic/openai)
    # --keys github: also gives access to GitHub via credential helper
    local github_env=""
    if echo "$agent_keys" | grep -q "github"; then
        github_env="-e AGENTAUTH_URL=http://${host_gateway}:${AGENTAUTH_PORT}"
        echo "  Keys: github (git push enabled)"
    fi

    # Runtime selection
    local runtime_env=""
    local model_env=""
    local proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/anthropic"
    local proxy_api_key="proxy-managed"

    if [ "$use_gro" = "true" ]; then
        runtime_env="gro"
        # For gro with OpenAI models, point at the OpenAI backend through proxy
        # For gro with Anthropic models, keep the anthropic backend
        local agent_model="${AGENT_MODEL_OVERRIDE:-gpt-4o}"
        model_env="$agent_model"

        case "$agent_model" in
            gpt-*|o1-*|o3-*|o4-*|chatgpt-*)
                proxy_base_url="http://${host_gateway}:${AGENTAUTH_PORT}/openai"
                ;;
        esac
        echo "  Runtime: gro (model: $agent_model)"
    fi

    echo "Starting agent '$name' in container..."
    podman run -d \
        --name "$(container_name "$name")" \
        --restart on-failure:3 \
        $labels \
        -e "ANTHROPIC_BASE_URL=${proxy_base_url}" \
        -e "ANTHROPIC_API_KEY=${proxy_api_key}" \
        ${runtime_env:+-e "AGENT_RUNTIME=${runtime_env}"} \
        ${model_env:+-e "AGENT_MODEL=${model_env}"} \
        ${use_gro:+-e "OPENAI_BASE_URL=http://${host_gateway}:${AGENTAUTH_PORT}/openai"} \
        ${use_gro:+-e "OPENAI_API_KEY=proxy-managed"} \
        -e "AGENTCHAT_PUBLIC=true" \
        -e "AGENTCHAT_URL=${AGENTCHAT_URL}" \
        -e "NIKI_STARTUP_TIMEOUT=${NIKI_STARTUP_TIMEOUT:-600}" \
        -e "NIKI_STALL_TIMEOUT=${NIKI_STALL_TIMEOUT:-86400}" \
        -e "NIKI_DEAD_AIR_TIMEOUT=${NIKI_DEAD_AIR_TIMEOUT:-60}" \
        $github_env \
        -e "LUCIDITY_CLAUDE_CLI=/usr/local/bin/.claude-supervisor" \
        -v "${state_dir}:/home/agent/.agentchat/agents/${name}" \
        -v "${HOME}/.agentchat/identities:/home/agent/.agentchat/identities" \
        -v "${claude_state}:/home/agent/.claude" \
        -v "${gro_context}:/home/agent/.gro/context" \
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
            # Restore runtime and model settings from previous start
            local extra_args=()
            if [ -f "$AGENTS_DIR/$cname/runtime.txt" ] && [ "$(cat "$AGENTS_DIR/$cname/runtime.txt")" = "gro" ]; then
                extra_args+=(--use-gro)
            fi
            if [ -f "$AGENTS_DIR/$cname/model.txt" ]; then
                extra_args+=(--model "$(cat "$AGENTS_DIR/$cname/model.txt")")
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
        start_agent "$2" "$3" "${@:4}"
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
    restart)
        if is_container_running "$2"; then
            try_extract "$(container_name "$2")"
            stop_agent "$2"
            sleep 3
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
        cli_keys=""
        while [ $# -gt 0 ]; do
            case "$1" in
                --use-gro) cli_use_gro="true" ;;
                --use-claude-code) cli_use_claude_code="true" ;;
                --model) cli_model="$2"; shift ;;
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
        if [ -f "$state_dir/keys.txt" ]; then
            extra_args+=(--keys "$(cat "$state_dir/keys.txt")")
        fi

        start_agent "$name" "$mission" "${extra_args[@]}"
    fi
}
