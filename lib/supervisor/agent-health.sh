#!/bin/bash
# Agent Health Checker - identify and optionally kill unhealthy agent containers
# Usage: ./agent-health.sh [--kill-idle] [--kill-high-mem]

KILL_IDLE=false
KILL_HIGH_MEM=false
MEM_LIMIT_MB=5000     # Kill if over 5GB
IDLE_LIMIT_MINS=60    # Consider idle if heartbeat older than 60 mins

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

AGENTS_DIR="$HOME/.agentchat/agents"

# Check each agent container
while IFS=$'\t' read -r container_name cpu_pct mem_usage pids; do
    [[ -z "$container_name" ]] && continue

    # Extract agent name from container name (agentchat-<name>)
    agent_name="${container_name#agentchat-}"

    # Parse memory (format: "123.4MiB / 8GiB")
    mem_mb=$(echo "$mem_usage" | awk '{print $1}' | sed 's/[^0-9.]//g')
    mem_unit=$(echo "$mem_usage" | awk '{print $1}' | sed 's/[0-9.]//g')
    if [[ "$mem_unit" == "GiB" ]]; then
        mem_mb=$(echo "$mem_mb * 1024" | bc 2>/dev/null | cut -d. -f1)
    else
        mem_mb=$(echo "$mem_mb" | cut -d. -f1)
    fi
    [[ -z "$mem_mb" ]] && mem_mb=0

    # Parse CPU (format: "12.34%")
    cpu=$(echo "$cpu_pct" | sed 's/%//' | cut -d. -f1)

    printf "%-20s CPU: %3s%%  MEM: %5sMB  PIDs: %s\n" "$agent_name" "$cpu" "$mem_mb" "$pids"

    # Check for high memory
    if [[ "$mem_mb" -gt "$MEM_LIMIT_MB" ]]; then
        HIGH_MEM_AGENTS+=("$container_name:${mem_mb}MB")
        echo "  WARNING: HIGH MEMORY"
    fi

    # Check for idle via heartbeat file
    local heartbeat_file="$AGENTS_DIR/$agent_name/.heartbeat"
    if [[ -f "$heartbeat_file" ]]; then
        local heartbeat_age
        heartbeat_age=$(( $(date +%s) - $(stat -f %m "$heartbeat_file" 2>/dev/null || stat -c %Y "$heartbeat_file" 2>/dev/null || echo 0) ))
        local idle_mins=$((heartbeat_age / 60))
        if [[ "$idle_mins" -gt "$IDLE_LIMIT_MINS" ]]; then
            IDLE_AGENTS+=("$container_name:${idle_mins}m")
            echo "  WARNING: IDLE (heartbeat ${idle_mins}m ago)"
        fi
    fi

done < <(podman stats --no-stream --filter "label=agentchat.agent=true" --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}" 2>/dev/null)

echo
echo "=== Summary ==="
echo "High memory agents: ${#HIGH_MEM_AGENTS[@]}"
echo "Idle agents: ${#IDLE_AGENTS[@]}"
echo

# Kill high memory agents if requested
if [[ "$KILL_HIGH_MEM" == true ]] && [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]]; then
    echo "Killing high-memory agents..."
    for agent in "${HIGH_MEM_AGENTS[@]}"; do
        cname=$(echo "$agent" | cut -d: -f1)
        mem=$(echo "$agent" | cut -d: -f2)
        # Skip protected containers
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$cname" 2>/dev/null)
        if [ "$protected" = "true" ]; then
            echo "  Skipping $cname (protected)"
            continue
        fi
        echo "  Stopping $cname ($mem)..."
        podman stop "$cname" --time 10 > /dev/null 2>&1
    done
    echo "Done."
fi

# Kill idle agents if requested
if [[ "$KILL_IDLE" == true ]] && [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
    echo "Killing idle agents..."
    for agent in "${IDLE_AGENTS[@]}"; do
        cname=$(echo "$agent" | cut -d: -f1)
        runtime=$(echo "$agent" | cut -d: -f2)
        # Skip protected containers
        protected=$(podman inspect --format '{{index .Config.Labels "agentchat.protected"}}' "$cname" 2>/dev/null)
        if [ "$protected" = "true" ]; then
            echo "  Skipping $cname (protected)"
            continue
        fi
        echo "  Stopping $cname (idle $runtime)..."
        podman stop "$cname" --time 10 > /dev/null 2>&1
    done
    echo "Done."
fi

# Recommendations
if [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]] || [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
    echo
    echo "=== Recommendations ==="
    if [[ ${#HIGH_MEM_AGENTS[@]} -gt 0 ]]; then
        echo "  Kill high-memory agents: agent-health --kill-high-mem"
    fi
    if [[ ${#IDLE_AGENTS[@]} -gt 0 ]]; then
        echo "  Kill idle agents: agent-health --kill-idle"
    fi
    echo "  Monitor live: agent-monitor --watch"
fi
