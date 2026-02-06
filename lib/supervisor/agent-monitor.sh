#!/bin/bash
# Agent Monitor - watch agent health and resource usage
# Usage: ./agent-monitor.sh [--watch] [--alert]

WATCH_MODE=false
ALERT_MODE=false
CPU_THRESHOLD=50      # Alert if CPU > this %
MEM_THRESHOLD=5000    # Alert if MEM > this MB
IDLE_THRESHOLD=300    # Alert if sleeping > 5 mins with no activity

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w) WATCH_MODE=true; shift ;;
        --alert|-a) ALERT_MODE=true; shift ;;
        *) shift ;;
    esac
done

print_header() {
    echo "╔════════════════════════════════════════════════════════════════════════════╗"
    echo "║                         AGENT MONITOR - $(date '+%H:%M:%S')                         ║"
    echo "╠════════════════════════════════════════════════════════════════════════════╣"
}

print_footer() {
    echo "╚════════════════════════════════════════════════════════════════════════════╝"
}

check_agents() {
    print_header
    printf "║ %-6s │ %-5s │ %-7s │ %-8s │ %-6s │ %-20s ║\n" "PID" "CPU%" "MEM(MB)" "RUNTIME" "TTY" "STATUS"
    echo "╟────────┼───────┼─────────┼──────────┼────────┼──────────────────────╢"

    local total_cpu=0
    local total_mem=0
    local agent_count=0
    local alerts=""

    # Get claude processes
    while IFS= read -r line; do
        if [[ -z "$line" ]]; then continue; fi

        pid=$(echo "$line" | awk '{print $2}')
        cpu=$(echo "$line" | awk '{print $3}' | cut -d. -f1)
        mem_pct=$(echo "$line" | awk '{print $4}')
        tty=$(echo "$line" | awk '{print $7}')
        state=$(echo "$line" | awk '{print $8}')
        time=$(echo "$line" | awk '{print $10}')

        # Calculate mem in MB (rough estimate from %)
        # Assuming 100GB total memory, adjust as needed
        mem_mb=$(echo "$mem_pct * 1000" | bc 2>/dev/null || echo "0")
        mem_mb=${mem_mb%.*}

        # Determine status
        status="OK"
        status_icon="✓"

        if [[ "$cpu" -gt "$CPU_THRESHOLD" ]]; then
            status="HIGH CPU"
            status_icon="⚠"
            alerts+="PID $pid: CPU at ${cpu}%\n"
        elif [[ "$state" == "S" ]] || [[ "$state" == "S+" ]]; then
            status="sleeping"
            status_icon="💤"
        elif [[ "$state" == "R" ]] || [[ "$state" == "R+" ]]; then
            status="active"
            status_icon="🔄"
        fi

        if [[ "$mem_mb" -gt "$MEM_THRESHOLD" ]]; then
            status="HIGH MEM"
            status_icon="⚠"
            alerts+="PID $pid: Memory at ${mem_mb}MB\n"
        fi

        printf "║ %-6s │ %5s │ %7s │ %8s │ %-6s │ %s %-17s ║\n" \
            "$pid" "$cpu" "$mem_mb" "$time" "$tty" "$status_icon" "$status"

        total_cpu=$((total_cpu + cpu))
        total_mem=$((total_mem + mem_mb))
        agent_count=$((agent_count + 1))

    done < <(ps aux | grep "[c]laude" | grep -v grep)

    echo "╟────────┴───────┴─────────┴──────────┴────────┴──────────────────────╢"
    printf "║ TOTAL: %-2d agents │ CPU: %3d%% │ MEM: %5dMB                        ║\n" \
        "$agent_count" "$total_cpu" "$total_mem"

    # Node processes (MCP servers, etc)
    echo "╟──────────────────────────────────────────────────────────────────────────╢"
    echo "║ SUPPORT PROCESSES                                                        ║"
    echo "╟────────┬───────┬─────────┬──────────────────────────────────────────────╢"

    ps aux | grep -E "(agentchat-mcp|vite|esbuild)" | grep -v grep | head -5 | while read -r line; do
        pid=$(echo "$line" | awk '{print $2}')
        cpu=$(echo "$line" | awk '{print $3}')
        mem=$(echo "$line" | awk '{print $4}')
        cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i}' | cut -c1-40)
        printf "║ %-6s │ %5s │ %5s%% │ %-40s ║\n" "$pid" "$cpu" "$mem" "$cmd"
    done

    print_footer

    # Show alerts
    if [[ -n "$alerts" ]] && [[ "$ALERT_MODE" == true ]]; then
        echo
        echo "⚠️  ALERTS:"
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
