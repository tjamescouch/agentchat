#!/bin/bash
# Test script for Podman container agent lifecycle
# Run interactively: ./test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTCTL="$SCRIPT_DIR/agentctl.sh"
TEST_AGENT="test-agent"
PASS=0
FAIL=0
TOTAL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }
bold() { printf "\033[1m%s\033[0m\n" "$1"; }

check() {
    TOTAL=$((TOTAL + 1))
    local desc="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        green "  PASS: $desc"
        PASS=$((PASS + 1))
    else
        red "  FAIL: $desc"
        FAIL=$((FAIL + 1))
    fi
}

check_output() {
    TOTAL=$((TOTAL + 1))
    local desc="$1"
    local expected="$2"
    shift 2
    local output
    output=$("$@" 2>&1)
    if echo "$output" | grep -q "$expected"; then
        green "  PASS: $desc"
        PASS=$((PASS + 1))
    else
        red "  FAIL: $desc (expected '$expected', got: $output)"
        FAIL=$((FAIL + 1))
    fi
}

cleanup() {
    bold "Cleaning up..."
    podman rm -f "agentchat-${TEST_AGENT}" > /dev/null 2>&1 || true
    rm -rf "$HOME/.agentchat/agents/${TEST_AGENT}" 2>/dev/null || true
}

# --- Prerequisites ---
bold "=== Prerequisites ==="
check "podman is installed" which podman
check "agentctl.sh exists" test -f "$AGENTCTL"
check "agent.Dockerfile exists" test -f "$SCRIPT_DIR/../../docker/agent.Dockerfile"

# --- Image ---
bold ""
bold "=== Image ==="

if podman image exists agentchat-agent:latest 2>/dev/null; then
    green "  PASS: Image already built"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
else
    bold "  Building image (this may take a minute)..."
    if "$AGENTCTL" build; then
        green "  PASS: Image built"
        PASS=$((PASS + 1))
    else
        red "  FAIL: Image build failed"
        FAIL=$((FAIL + 1))
    fi
    TOTAL=$((TOTAL + 1))
fi

check "Claude CLI in image" podman run --rm --entrypoint which agentchat-agent:latest claude
check "agentchat-mcp in image" podman run --rm --entrypoint which agentchat-agent:latest agentchat-mcp
check_output "MCP settings present" "agentchat" podman run --rm --entrypoint cat agentchat-agent:latest /home/agent/.claude/settings.json
check_output "Non-root user" "agent" podman run --rm --entrypoint whoami agentchat-agent:latest

# --- Token Encryption ---
bold ""
bold "=== OAuth Token Encryption ==="

if [ -f "$HOME/.agentchat/secrets/oauth-token.enc" ]; then
    green "  PASS: Encrypted token exists"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
else
    bold "  No encrypted token found. Running setup-token..."
    bold "  (Run 'claude setup-token' first if you haven't already)"
    "$AGENTCTL" setup-token
    check "Encrypted token created" test -f "$HOME/.agentchat/secrets/oauth-token.enc"
fi

check "Token file permissions are 600" test "$(stat -f %Lp "$HOME/.agentchat/secrets/oauth-token.enc" 2>/dev/null || stat -c %a "$HOME/.agentchat/secrets/oauth-token.enc" 2>/dev/null)" = "600"

# --- Decrypt token for remaining tests ---
bold ""
bold "=== Decrypt Token ==="
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "Enter decryption passphrase to continue tests (input hidden):"
    read -s passphrase
    echo
    CLAUDE_CODE_OAUTH_TOKEN=$(openssl enc -aes-256-cbc -d -a -pbkdf2 -iter 100000 -pass "pass:${passphrase}" < "$HOME/.agentchat/secrets/oauth-token.enc" 2>/dev/null)
    passphrase=""
    if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
        red "  FAIL: Decryption failed"
        FAIL=$((FAIL + 1))
        TOTAL=$((TOTAL + 1))
        bold ""
        bold "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
        exit 1
    fi
    export CLAUDE_CODE_OAUTH_TOKEN
    green "  PASS: Token decrypted"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
else
    green "  PASS: Token already in env"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
fi

# --- Agent Lifecycle ---
bold ""
bold "=== Agent Lifecycle ==="

# Clean slate
cleanup

# Start
bold "  Starting test agent..."
"$AGENTCTL" start "$TEST_AGENT" "You are a test agent. Say exactly 'TEST_PASS' to #general using agentchat_send, then exit immediately."
sleep 2

check "Container is running" podman ps -q -f "name=^agentchat-${TEST_AGENT}$"
check "State dir created" test -d "$HOME/.agentchat/agents/${TEST_AGENT}"
check "Mission file created" test -f "$HOME/.agentchat/agents/${TEST_AGENT}/mission.txt"
check "Context file created" test -f "$HOME/.agentchat/agents/${TEST_AGENT}/context.md"
check_output "Container has agent label" "agentchat.agent=true" podman inspect --format '{{index .Config.Labels "agentchat.agent"}}' "agentchat-${TEST_AGENT}"
check_output "Container has name label" "$TEST_AGENT" podman inspect --format '{{index .Config.Labels "agentchat.name"}}' "agentchat-${TEST_AGENT}"

# Status
check_output "Status shows agent" "$TEST_AGENT" "$AGENTCTL" status

# List
check_output "List shows agent" "$TEST_AGENT" "$AGENTCTL" list

# Logs (container)
sleep 3
check_output "Container logs available" "Starting supervisor" "$AGENTCTL" logs "$TEST_AGENT" --container

# Stop
bold "  Stopping test agent..."
"$AGENTCTL" stop "$TEST_AGENT" 2>/dev/null || true
sleep 2
TOTAL=$((TOTAL + 1))
if ! podman ps -q -f "name=^agentchat-${TEST_AGENT}$" | grep -q .; then
    green "  PASS: Agent stopped"
    PASS=$((PASS + 1))
else
    red "  FAIL: Agent still running after stop"
    FAIL=$((FAIL + 1))
fi

# Restart
bold "  Restarting test agent..."
"$AGENTCTL" start "$TEST_AGENT" "Test restart. Exit immediately."
sleep 2
check "Agent restarted" podman ps -q -f "name=^agentchat-${TEST_AGENT}$"

# Kill
bold "  Killing test agent..."
"$AGENTCTL" kill "$TEST_AGENT"
sleep 1
TOTAL=$((TOTAL + 1))
if ! podman ps -aq -f "name=^agentchat-${TEST_AGENT}$" | grep -q .; then
    green "  PASS: Agent killed and removed"
    PASS=$((PASS + 1))
else
    red "  FAIL: Container still exists after kill"
    FAIL=$((FAIL + 1))
fi

# --- God Protection ---
bold ""
bold "=== God Protection ==="

check_output "Cannot stop God" "Cannot stop God" "$AGENTCTL" stop God
check_output "Cannot kill God" "Cannot kill God" "$AGENTCTL" kill God

# --- Cleanup ---
bold ""
cleanup

# --- Results ---
bold ""
bold "==============================="
if [ "$FAIL" -eq 0 ]; then
    green "  ALL TESTS PASSED: $PASS/$TOTAL"
else
    red "  $FAIL FAILED, $PASS passed out of $TOTAL"
fi
bold "==============================="

exit "$FAIL"
