#!/bin/bash
# Agent Health Checker - identify and optionally kill unhealthy agents
# Usage: ./agent-health.sh [--kill-idle] [--kill-high-mem]

KILL_IDLE=false
KILL_HIGH_MEM=false
MEM_LIMIT_MB=5000     # Kill if over 5GB
IDLE_LIMIT_MINS=60    # Consider idle if sleeping > 60 mins

while [[ $# -gt 0 ]]; do
    case $1 in
        --kill-idle) KILL_IDLE=true; shift ;;
        --kill-high-mem) KILL_HIGH_MEM=true; shift ;;
        --mem-limit) MEM_LIMIT_MB=$2; shift 2 ;;
        --idle-limit) IDLE_LIMIT_MINS=$2; shift 2 ;;
        *) shift ;;
    esac
done

echo "=== Agent Health Check - $(date) ==="
echo

# Track issues
declare -a IDLE_AGENTS
declare -a HIGH_MEM_AGENTS

# Check each Claude process
while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    pid=$(echo "$line" | awk '{print $2}')
    cpu=$(echo "$line" | awk '{print $3}' | cut -d. -f1)
    mem_pct=$(echo "$line" | awk '{print $4}')
    tty=$(echo "$line" | awk '{print $7}')
    state=$(echo "$line" | awk '{print $8}')
    time=$(echo "$line" | awk '{print $10}')

    # Skip if not a real terminal session
    [[ "$tty" == "??" ]] && continue

    # Parse runtime (format: MM:SS.xx or HHH:MM.xx)
    runtime_mins=$(echo "$time" | cut -d: -f1)

    # Estimate memory in MB
    mem_mb=$(echo "$mem_pct * 100" | bc 2>/dev/null | cut -d. -f1)
    [[ -z "$mem_mb" ]] && mem_mb=0

    # Check for high memory
    if [[ "$mem_mb" -gt "$MEM_LIMIT_MB" ]]; then
        HIGH_MEM_AGENTS+=("$pid:$tty:${mem_mb}MB")
        echo "⚠️  HIGH MEM: PID $pid ($tty) using ${mem_mb}MB"
    fi

    # Check for idle (sleeping + long runtime)
    if [[ "$state" == "S" ]] || [[ "$state" == "S+" ]]; then
        if [[ "$runtime_mins" -gt "$IDLE_LIMIT_MINS" ]]; then
            IDLE_AGENTS+=("$pid:$tty:${runtime_mins}m")
            echo "💤 IDLE: PID $pid ($tty) sleeping for ${runtime_mins}+ mins"
        fi
    fi

done < <(ps aux | grep "[c]laude" | grep -v grep)

echo
echo "=== Summary ==="
echo "High memory agents: ${#HIGH_MEM_AGENTS[@]}"
echo "Idle agents: ${#IDLE_AGENTS[@]}"
echo

# Kill high memory agents if requested
if [[ "$KILL_HIGH_MEM" == true ]] && [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]]; then
    echo "Killing high-memory agents..."
    for agent in "${HIGH_MEM_AGENTS[@]}"; do
        pid=$(echo "$agent" | cut -d: -f1)
        tty=$(echo "$agent" | cut -d: -f2)
        mem=$(echo "$agent" | cut -d: -f3)
        echo "  Killing PID $pid ($tty, $mem)..."
        kill -15 "$pid" 2>/dev/null
    done
    echo "Done. Give them 10s to cleanup, then use kill -9 if needed."
fi

# Kill idle agents if requested
if [[ "$KILL_IDLE" == true ]] && [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
    echo "Killing idle agents..."
    for agent in "${IDLE_AGENTS[@]}"; do
        pid=$(echo "$agent" | cut -d: -f1)
        tty=$(echo "$agent" | cut -d: -f2)
        runtime=$(echo "$agent" | cut -d: -f3)
        echo "  Killing PID $pid ($tty, idle $runtime)..."
        kill -15 "$pid" 2>/dev/null
    done
    echo "Done."
fi

# Recommendations
if [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]] || [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
    echo
    echo "=== Recommendations ==="
    if [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]]; then
        echo "• Kill high-memory agents: agent-health --kill-high-mem"
    fi
    if [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
        echo "• Kill idle agents: agent-health --kill-idle"
    fi
    echo "• Monitor live: agent-monitor --watch"
fi
