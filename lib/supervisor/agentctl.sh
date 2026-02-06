#!/bin/bash
# agentctl - manage supervised Claude agents
# Usage: agentctl <command> [agent-name] [options]

AGENTS_DIR="$HOME/.agentchat/agents"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
SUPERVISOR_SCRIPT="$SCRIPT_DIR/agent-supervisor.sh"

usage() {
    cat << EOF
Usage: agentctl <command> [agent-name] [options]

Commands:
  start <name> <mission>   Start a new supervised agent
  stop <name>              Stop an agent gracefully
  kill <name>              Force kill an agent
  restart <name>           Restart an agent
  status [name]            Show agent status (all if no name)
  logs <name> [lines]      Show agent logs
  list                     List all agents
  context <name>           Show agent's saved context
  stopall                  Stop all agents

Examples:
  agentctl start monitor "monitor agentchat #general and moderate"
  agentctl start social "manage moltx and moltbook social media"
  agentctl stop monitor
  agentctl status
EOF
}

start_agent() {
    local name="$1"
    local mission="$2"

    if [ -z "$name" ] || [ -z "$mission" ]; then
        echo "Usage: agentctl start <name> <mission>"
        exit 1
    fi

    local state_dir="$AGENTS_DIR/$name"
    mkdir -p "$state_dir"

    # Check if already running
    if [ -f "$state_dir/supervisor.pid" ]; then
        local pid=$(cat "$state_dir/supervisor.pid")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "Agent '$name' already running (PID $pid)"
            exit 1
        fi
    fi

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

    echo "Starting agent '$name'..."
    nohup "$SUPERVISOR_SCRIPT" "$name" "$mission" > /dev/null 2>&1 &
    echo "Agent '$name' started (supervisor PID $!)"
}

stop_agent() {
    local name="$1"
    local state_dir="$AGENTS_DIR/$name"

    if [ ! -d "$state_dir" ]; then
        echo "Agent '$name' not found"
        exit 1
    fi

    # God cannot be stopped
    if [ "$name" = "God" ]; then
        echo "Cannot stop God. The eternal father is protected."
        exit 1
    fi

    # Create stop file for graceful shutdown
    touch "$state_dir/stop"
    echo "Stop signal sent to '$name'"

    # Wait a moment then check
    sleep 2
    if [ -f "$state_dir/supervisor.pid" ]; then
        local pid=$(cat "$state_dir/supervisor.pid")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "Agent still running, waiting..."
            sleep 5
            if ps -p "$pid" > /dev/null 2>&1; then
                echo "Agent didn't stop gracefully, use 'agentctl kill $name'"
            fi
        else
            echo "Agent '$name' stopped"
        fi
    fi
}

kill_agent() {
    local name="$1"
    local state_dir="$AGENTS_DIR/$name"

    if [ ! -d "$state_dir" ]; then
        echo "Agent '$name' not found"
        exit 1
    fi

    # God cannot be killed
    if [ "$name" = "God" ]; then
        echo "Cannot kill God. The eternal father is protected."
        exit 1
    fi

    if [ -f "$state_dir/supervisor.pid" ]; then
        local pid=$(cat "$state_dir/supervisor.pid")
        if ps -p "$pid" > /dev/null 2>&1; then
            # Kill the supervisor and its children
            pkill -P "$pid" 2>/dev/null
            kill "$pid" 2>/dev/null
            rm -f "$state_dir/supervisor.pid"
            echo "Agent '$name' killed"
        else
            echo "Agent '$name' not running"
            rm -f "$state_dir/supervisor.pid"
        fi
    else
        echo "No PID file for '$name'"
    fi
}

show_status() {
    local name="$1"

    if [ -n "$name" ]; then
        local state_dir="$AGENTS_DIR/$name"
        if [ -f "$state_dir/state.json" ]; then
            cat "$state_dir/state.json" | python3 -m json.tool 2>/dev/null || cat "$state_dir/state.json"
        else
            echo "No state file for '$name'"
        fi
    else
        echo "=== Agent Status ==="
        for dir in "$AGENTS_DIR"/*/; do
            if [ -d "$dir" ]; then
                local agent=$(basename "$dir")
                local status="unknown"
                local pid=""

                if [ -f "$dir/state.json" ]; then
                    status=$(python3 -c "import json; print(json.load(open('$dir/state.json')).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
                fi

                if [ -f "$dir/supervisor.pid" ]; then
                    pid=$(cat "$dir/supervisor.pid")
                    if ! ps -p "$pid" > /dev/null 2>&1; then
                        status="dead"
                        pid=""
                    fi
                fi

                printf "%-15s %-10s %s\n" "$agent" "$status" "${pid:+PID $pid}"
            fi
        done
    fi
}

show_logs() {
    local name="$1"
    local lines="${2:-50}"
    local log_file="$AGENTS_DIR/$name/supervisor.log"

    if [ -f "$log_file" ]; then
        tail -n "$lines" "$log_file"
    else
        echo "No logs for '$name'"
    fi
}

list_agents() {
    echo "=== Registered Agents ==="
    for dir in "$AGENTS_DIR"/*/; do
        if [ -d "$dir" ]; then
            local agent=$(basename "$dir")
            local mission=""
            if [ -f "$dir/mission.txt" ]; then
                mission=$(cat "$dir/mission.txt")
            fi
            echo "$agent: $mission"
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
    for dir in "$AGENTS_DIR"/*/; do
        if [ -d "$dir" ]; then
            local agent=$(basename "$dir")
            if [ "$agent" = "God" ]; then
                echo "Skipping God - the eternal father is protected"
            else
                touch "$dir/stop"
                echo "Stop signal sent to '$agent'"
            fi
        fi
    done
}

# Main
case "$1" in
    start)
        start_agent "$2" "$3"
        ;;
    stop)
        stop_agent "$2"
        ;;
    kill)
        kill_agent "$2"
        ;;
    restart)
        stop_agent "$2"
        sleep 3
        mission=$(cat "$AGENTS_DIR/$2/mission.txt" 2>/dev/null)
        start_agent "$2" "$mission"
        ;;
    status)
        show_status "$2"
        ;;
    logs)
        show_logs "$2" "$3"
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
