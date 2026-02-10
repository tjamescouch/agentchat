#!/bin/bash
# agentctl - manage supervised Claude agents in Podman containers
# Usage: agentctl <command> [agent-name] [options]

AGENTS_DIR="$HOME/.agentchat/agents"
SECRETS_DIR="$HOME/.agentchat/secrets"
ENCRYPTED_TOKEN_FILE="$SECRETS_DIR/oauth-token.enc"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
IMAGE_NAME="agentchat-agent:latest"
CONTAINER_PREFIX="agentchat"

# Default server URL
AGENTCHAT_URL="${AGENTCHAT_URL:-wss://agentchat-server.fly.dev}"

# --- Token Encryption functions ---
# OAuth token is encrypted at rest with AES-256-CBC + PBKDF2.
# Decrypted only in memory (shell variable), never written to disk.

setup_token() {
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ -f "$ENCRYPTED_TOKEN_FILE" ]; then
        echo "Encrypted token already exists at $ENCRYPTED_TOKEN_FILE"
        read -p "Overwrite? [y/N] " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "Aborted."
            exit 0
        fi
    fi

    echo "Run 'claude setup-token' to generate your OAuth token."
    echo "Copy the token it outputs, then paste it below."
    echo
    echo "Enter your OAuth token (input hidden):"
    IFS= read -r -s token
    token="${token%$'\r'}"  # Strip carriage return if present
    echo

    if [ -z "$token" ]; then
        echo "ERROR: Empty token"
        exit 1
    fi

    echo "Enter encryption passphrase (input hidden):"
    IFS= read -r -s passphrase
    passphrase="${passphrase%$'\r'}"  # Strip carriage return if present
    echo
    echo "Confirm passphrase:"
    IFS= read -r -s passphrase_confirm
    passphrase_confirm="${passphrase_confirm%$'\r'}"  # Strip carriage return if present
    echo

    if [ "$passphrase" != "$passphrase_confirm" ]; then
        echo "ERROR: Passphrases do not match"
        exit 1
    fi

    if [ -z "$passphrase" ]; then
        echo "ERROR: Empty passphrase"
        exit 1
    fi

    # Encrypt with AES-256-CBC + PBKDF2, salt, base64 output
    echo -n "$token" | openssl enc -aes-256-cbc -a -salt -pbkdf2 -iter 100000 -pass "pass:${passphrase}" > "$ENCRYPTED_TOKEN_FILE" 2>/dev/null

    if [ $? -ne 0 ]; then
        rm -f "$ENCRYPTED_TOKEN_FILE"
        echo "ERROR: Encryption failed"
        exit 1
    fi

    chmod 600 "$ENCRYPTED_TOKEN_FILE"

    # Verify decryption works immediately
    echo "Verifying encryption..."
    local test_decrypt
    test_decrypt=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$ENCRYPTED_TOKEN_FILE" 2>/dev/null)

    if [ "$test_decrypt" != "$token" ]; then
        rm -f "$ENCRYPTED_TOKEN_FILE"
        echo "ERROR: Encryption verification failed - decryption doesn't match original token"
        echo "This suggests a terminal encoding issue. Try using CLAUDE_CODE_OAUTH_TOKEN env var instead:"
        echo "  export CLAUDE_CODE_OAUTH_TOKEN='your-token'"
        echo "  agentctl start <name> <mission>"
        exit 1
    fi

    echo "Token encrypted and stored at $ENCRYPTED_TOKEN_FILE"
    echo "Verification successful - decryption works!"

    # Clear sensitive variables
    token=""
    passphrase=""
    passphrase_confirm=""
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

    passphrase=""

    if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] || [ $decrypt_status -ne 0 ]; then
        CLAUDE_CODE_OAUTH_TOKEN=""
        echo "ERROR: Decryption failed (wrong passphrase?)"
        exit 1
    fi

    export CLAUDE_CODE_OAUTH_TOKEN
}

usage() {
    cat << EOF
Usage: agentctl <command> [agent-name] [options]

Commands:
  setup-token              Encrypt and store your OAuth token (one-time setup)
  build                    Build the agent container image
  start <name> <mission>   Start a new supervised agent container
  stop <name>              Stop an agent gracefully
  abort <name>             Trigger niki abort (immediate SIGTERM via abort file)
  kill <name>              Force kill an agent container
  restart <name>           Restart an agent container
  status [name]            Show agent status (all if no name)
  logs <name> [lines]      Show agent logs (--container for container logs)
  list                     List all agents
  context <name>           Show agent's saved context
  stopall                  Stop all agents

Environment:
  CLAUDE_CODE_OAUTH_TOKEN  Optional. If set, skips passphrase prompt.
  AGENTCHAT_URL            AgentChat server URL (default: wss://agentchat-server.fly.dev)

Examples:
  agentctl build
  agentctl start monitor "monitor agentchat #general and moderate"
  agentctl start social "manage moltx and moltbook social media"
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
    echo "Building agent image..."
    podman build -t "$IMAGE_NAME" -f "$REPO_ROOT/docker/agent.Dockerfile" "$REPO_ROOT"
    echo "Image '$IMAGE_NAME' built successfully"
}

start_agent() {
    local name="$1"
    local mission="$2"

    if [ -z "$name" ] || [ -z "$mission" ]; then
        echo "Usage: agentctl start <name> <mission>"
        exit 1
    fi

    # Decrypt OAuth token (prompts for passphrase if not in env)
    decrypt_token

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

    # Save mission for restarts
    echo "$mission" > "$state_dir/mission.txt"

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

    echo "Starting agent '$name' in container..."
    podman run -d \
        --name "$(container_name "$name")" \
        --restart on-failure:3 \
        $labels \
        -e "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}" \
        -e "AGENTCHAT_PUBLIC=true" \
        -e "AGENTCHAT_URL=${AGENTCHAT_URL}" \
        -v "${state_dir}:/home/agent/.agentchat/agents/${name}" \
        -v "${HOME}/.agentchat/identities:/home/agent/.agentchat/identities" \
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

stop_all() {
    echo "Stopping all agents (except God)..."

    # Stop via container labels
    podman ps -q --filter "label=agentchat.agent=true" 2>/dev/null | while read -r container_id; do
        local cname
        cname=$(podman inspect --format '{{index .Config.Labels "agentchat.name"}}' "$container_id" 2>/dev/null)
        local protected
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$container_id" 2>/dev/null)

        if [ "$protected" = "true" ]; then
            echo "Skipping $cname - the eternal father is protected"
        else
            # Signal graceful stop via volume mount
            local state_dir="$AGENTS_DIR/$cname"
            if [ -d "$state_dir" ]; then
                touch "$state_dir/stop"
            fi
            echo "Stopping '$cname'..."
            podman stop "$container_id" --time 15 > /dev/null 2>&1 &
        fi
    done

    wait
    echo "All mortal agents stopped."
}

# Main
case "$1" in
    setup-token)
        setup_token
        ;;
    build)
        build_image
        ;;
    start)
        start_agent "$2" "$3"
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
        start_agent "$2" "$mission"
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
    *)
        usage
        ;;
esac
