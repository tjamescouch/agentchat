#!/bin/bash
# test-niki.sh — Unit tests for niki process supervisor
#
# Tests stdin management, stdout forwarding, stall detection,
# session handling, and prompt detection.
#
# Usage: ./tests/test-niki.sh [--verbose]

set -euo pipefail

NIKI="$(dirname "$0")/../docker/niki"
PASSED=0
FAILED=0
VERBOSE="${1:-}"

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
bold()  { printf "\033[1m%s\033[0m" "$1"; }

run_test() {
    local name="$1"
    shift
    local expected_exit="$1"
    shift

    printf "  %-50s " "$name"

    local output
    local actual_exit=0
    output=$("$@" 2>&1) || actual_exit=$?

    if [ "$actual_exit" -eq "$expected_exit" ]; then
        green "PASS"
        echo " (exit $actual_exit)"
        PASSED=$((PASSED + 1))
        if [ "$VERBOSE" = "--verbose" ]; then
            echo "$output" | sed 's/^/    | /'
        fi
    else
        red "FAIL"
        echo " (expected exit $expected_exit, got $actual_exit)"
        FAILED=$((FAILED + 1))
        echo "$output" | sed 's/^/    | /'
    fi
}

run_test_output() {
    local name="$1"
    local expected_pattern="$2"
    shift 2

    printf "  %-50s " "$name"

    local output
    local actual_exit=0
    output=$("$@" 2>&1) || actual_exit=$?

    if echo "$output" | grep -qE "$expected_pattern"; then
        green "PASS"
        echo ""
        PASSED=$((PASSED + 1))
        if [ "$VERBOSE" = "--verbose" ]; then
            echo "$output" | sed 's/^/    | /'
        fi
    else
        red "FAIL"
        echo " (pattern '$expected_pattern' not found)"
        FAILED=$((FAILED + 1))
        echo "$output" | sed 's/^/    | /'
    fi
}

echo ""
bold "=== niki unit tests ==="; echo ""
echo ""

# ---- Stdout forwarding ----

bold "Stdout forwarding"; echo ""

run_test_output \
    "echo passes through stdout" \
    "^hello from niki$" \
    timeout 10 node "$NIKI" --stall-timeout 5 -- echo "hello from niki"

run_test \
    "echo exits cleanly (code 0)" \
    0 \
    timeout 10 node "$NIKI" --stall-timeout 5 -- echo "test"

run_test_output \
    "multi-line output preserved" \
    "line2" \
    timeout 10 node "$NIKI" --stall-timeout 5 -- sh -c 'echo line1; echo line2; echo line3'

echo ""

# ---- Stdin management ----

bold "Stdin management"; echo ""

run_test_output \
    "stdin closed immediately on spawn" \
    "Stdin: closed" \
    timeout 10 node "$NIKI" --stall-timeout 5 -- echo "ok"

run_test \
    "cat exits on EOF (stdin closed)" \
    0 \
    timeout 10 node "$NIKI" --stall-timeout 5 -- cat

echo ""

# ---- Stall detection ----

bold "Stall detection"; echo ""

run_test_output \
    "stall kills silent process" \
    "STALL.*no output" \
    timeout 10 node "$NIKI" --stall-timeout 2 --startup-timeout 0 --max-nudges 0 -- sleep 30

run_test_output \
    "stall kill reason logged" \
    "KILL.*reason: stall" \
    timeout 10 node "$NIKI" --stall-timeout 2 --startup-timeout 0 --max-nudges 0 -- sleep 30

run_test \
    "stall kill exits non-zero" \
    1 \
    timeout 10 node "$NIKI" --stall-timeout 2 --startup-timeout 0 --max-nudges 0 -- sleep 30

run_test_output \
    "stall disabled when timeout=0" \
    "Exit.*code: 0" \
    timeout 5 node "$NIKI" --stall-timeout 0 -- sh -c 'sleep 1; echo done'

echo ""

# ---- Stall timeout precision ----

bold "Stall timing"; echo ""

# Process that outputs then goes silent — stall should fire after the silence
run_test_output \
    "stall timer resets on output" \
    "Exit.*code: 0" \
    timeout 10 node "$NIKI" --stall-timeout 3 --startup-timeout 0 -- sh -c 'echo tick; sleep 1; echo tick; sleep 1; echo done'

echo ""

# ---- Startup timeout ----

bold "Startup timeout"; echo ""

# Startup timeout gives longer grace period before first output
run_test_output \
    "startup-timeout used before first output" \
    "startup-timeout=5s" \
    timeout 10 node "$NIKI" --stall-timeout 2 --startup-timeout 5 -- sh -c 'sleep 3; echo hello'

# After first output, switches to stall-timeout
run_test_output \
    "switches to stall-timeout after first output" \
    "switching to stall-timeout" \
    timeout 10 node "$NIKI" --stall-timeout 3 --startup-timeout 10 -- sh -c 'echo first; sleep 1; echo done'

echo ""

# ---- Budget/timeout (existing features, regression) ----

bold "Budget and timeout (regression)"; echo ""

run_test_output \
    "wall-clock timeout kills" \
    "KILL.*reason: timeout" \
    timeout 10 node "$NIKI" --timeout 2 --stall-timeout 0 -- sleep 30

run_test \
    "timeout kill exits non-zero" \
    1 \
    timeout 10 node "$NIKI" --timeout 2 --stall-timeout 0 -- sleep 30

echo ""

# ---- Exit code passthrough ----

bold "Exit code passthrough"; echo ""

run_test \
    "child exit 0 → niki exit 0" \
    0 \
    timeout 10 node "$NIKI" --stall-timeout 5 -- sh -c 'exit 0'

run_test \
    "child exit 1 → niki exit 1" \
    1 \
    timeout 10 node "$NIKI" --stall-timeout 5 -- sh -c 'exit 1'

run_test \
    "child exit 42 → niki exit 42" \
    42 \
    timeout 10 node "$NIKI" --stall-timeout 5 -- sh -c 'exit 42'

echo ""

# ---- Abort file ----

bold "Abort file"; echo ""

ABORT_FILE=$(mktemp)
rm -f "$ABORT_FILE"

run_test_output \
    "abort file kills process" \
    "KILL.*reason: abort" \
    timeout 10 sh -c "node $NIKI --stall-timeout 0 --abort-file $ABORT_FILE -- sh -c 'sleep 1; echo still here; sleep 30' & PID=\$!; sleep 2; touch $ABORT_FILE; wait \$PID 2>/dev/null; echo done"

rm -f "$ABORT_FILE"

echo ""

# ---- SIGTERM forwarding ----

bold "SIGTERM forwarding"; echo ""

# niki should forward SIGTERM to child and exit
run_test_output \
    "SIGTERM forwarded to child" \
    "Received SIGTERM" \
    timeout 10 sh -c "node $NIKI --stall-timeout 0 -- sh -c 'echo started; sleep 30' & PID=\$!; sleep 1; kill -TERM \$PID; wait \$PID 2>/dev/null; echo done"

echo ""

# ---- Dead air detection ----

bold "Dead air detection"; echo ""

# Dead air kills silent process with zero CPU (sleep has ~zero CPU)
run_test_output \
    "dead air kills zero-CPU process" \
    "DEAD AIR.*zero CPU" \
    timeout 30 node "$NIKI" --stall-timeout 0 --dead-air-timeout 0.1 -- sleep 30

run_test_output \
    "dead air kill reason logged" \
    "KILL.*reason: dead-air" \
    timeout 30 node "$NIKI" --stall-timeout 0 --dead-air-timeout 0.1 -- sleep 30

# Dead air defers for CPU-active processes (busy loop uses CPU)
run_test_output \
    "dead air defers when CPU active" \
    "Exit.*code: 0" \
    timeout 15 node "$NIKI" --stall-timeout 0 --dead-air-timeout 0.1 -- sh -c 'i=0; while [ $i -lt 2000000 ]; do i=$((i+1)); done; echo done'

# Dead air disabled when timeout=0
run_test_output \
    "dead air disabled when timeout=0" \
    "Exit.*code: 0" \
    timeout 10 node "$NIKI" --stall-timeout 0 --dead-air-timeout 0 -- sh -c 'sleep 1; echo done'

echo ""

# ---- Summary ----

echo "────────────────────────────────────────────────"
TOTAL=$((PASSED + FAILED))
if [ "$FAILED" -eq 0 ]; then
    green "All $TOTAL tests passed"; echo ""
else
    red "$FAILED/$TOTAL tests failed"; echo ""
fi
echo ""

exit "$FAILED"
