#!/bin/bash
# Agent Monitor - watch agent container health and resource usage
# Usage: ./agent-monitor.sh [--watch] [--alert]

WATCH_MODE=false
ALERT_MODE=false
CPU_THRESHOLD=50      # Alert if CPU > this %
MEM_THRESHOLD=5000    # Alert if MEM > this MB

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w) WATCH_MODE=true; shift ;;
        --alert|-a) ALERT_MODE=true; shift ;;
        *) shift ;;
    esac
done

print_header() {
    echo "╔════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    AGENT MONITOR (Podman) - $(date '+%H:%M:%S')                    ║"
    echo "╠════════════════════════════════════════════════════════════════════════════╣"
}

print_footer() {
    echo "╚════════════════════════════════════════════════════════════════════════════╝"
}

check_agents() {
    print_header
    printf "║ %-18s │ %-7s │ %-10s │ %-10s │ %-14s ║\n" "AGENT" "CPU%" "MEMORY" "PIDS" "STATUS"
    echo "╟────────────────────┼─────────┼────────────┼────────────┼────────────────╢"

    local total_cpu=0
    local total_mem=0
    local agent_count=0
    local alerts=""

    # Get agent container stats
    while IFS=$'\t' read -r container_name cpu_pct mem_usage pids; do
        [[ -z "$container_name" ]] && continue

        agent_name="${container_name#agentchat-}"

        # Parse CPU
        cpu=$(echo "$cpu_pct" | sed 's/%//' | cut -d. -f1)

        # Parse memory (format: "123.4MiB / 8GiB")
        mem_display=$(echo "$mem_usage" | awk '{print $1}')
        mem_mb=$(echo "$mem_display" | sed 's/[^0-9.]//g' | cut -d. -f1)
        [[ -z "$mem_mb" ]] && mem_mb=0

        # Determine status
        local status="OK"
        local status_icon="OK"

        if [[ "$cpu" -gt "$CPU_THRESHOLD" ]]; then
            status="HIGH CPU"
            status_icon="!! HIGH CPU"
            alerts+="$agent_name: CPU at ${cpu}%\n"
        fi

        if [[ "$mem_mb" -gt "$MEM_THRESHOLD" ]]; then
            status="HIGH MEM"
            status_icon="!! HIGH MEM"
            alerts+="$agent_name: Memory at ${mem_display}\n"
        fi

        printf "║ %-18s │ %5s%% │ %10s │ %10s │ %-14s ║\n" \
            "$agent_name" "$cpu" "$mem_display" "$pids" "$status_icon"

        total_cpu=$((total_cpu + cpu))
        total_mem=$((total_mem + mem_mb))
        agent_count=$((agent_count + 1))

    done < <(podman stats --no-stream --filter "label=agentchat.agent=true" --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}" 2>/dev/null)

    if [[ "$agent_count" -eq 0 ]]; then
        printf "║ %-70s ║\n" "  No agent containers running"
    fi

    echo "╟────────────────────┴─────────┴────────────┴────────────┴────────────────╢"
    printf "║ TOTAL: %-2d agents │ CPU: %3d%% │ MEM: ~%5dMB                          ║\n" \
        "$agent_count" "$total_cpu" "$total_mem"

    # Stopped containers
    local stopped
    stopped=$(podman ps -a --filter "label=agentchat.agent=true" --filter "status=exited" --format "{{.Names}}" 2>/dev/null)
    if [[ -n "$stopped" ]]; then
        echo "╟──────────────────────────────────────────────────────────────────────────╢"
        printf "║ %-70s ║\n" "STOPPED CONTAINERS:"
        while IFS= read -r cname; do
            local aname="${cname#agentchat-}"
            printf "║   %-68s ║\n" "$aname"
        done <<< "$stopped"
    fi

    print_footer

    # Show alerts
    if [[ -n "$alerts" ]] && [[ "$ALERT_MODE" == true ]]; then
        echo
        echo "ALERTS:"
        echo -e "$alerts"
    fi
}

if [[ "$WATCH_MODE" == true ]]; then
    while true; do
        clear
        check_agents
        echo
        echo "Refreshing in 5s... (Ctrl+C to exit)"
        sleep 5
    done
else
    check_agents
fi
