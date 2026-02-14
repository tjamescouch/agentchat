#!/bin/bash
# pushbot — idempotently push all branches from wormhole agent repos to remote
#
# Iterates over every agent directory in the wormhole, finds git repos,
# and pushes all branches to origin. Idempotent: if already up to date,
# it no-ops. Designed to run on metal where git credentials exist.
#
# Usage:
#   ./pushbot.sh [options]
#     --wormhole <path>   Wormhole directory (default: ~/dev/claude/wormhole)
#     --dry-run           Show what would be pushed without doing it
#     --verbose           Show detailed output
#     --once              Run once and exit (default: run once)
#     --watch <secs>      Run in a loop every N seconds
#
# Examples:
#   ./pushbot.sh                              # push everything once
#   ./pushbot.sh --dry-run                    # see what would be pushed
#   ./pushbot.sh --watch 300                  # push every 5 minutes
#   ./pushbot.sh --wormhole /tmp/wormhole     # custom wormhole path

set -uo pipefail
# Note: no -e — we handle errors explicitly so the daemon doesn't die on transient failures

# SECURITY: No self-update from wormhole — agents must not be able to exec code on metal

# ── Defaults ──────────────────────────────────────────────────────────────

WORMHOLE_DIR="${HOME}/dev/claude/wormhole"
DRY_RUN=false
VERBOSE=false
WATCH_INTERVAL=0  # 0 = run once
BRANCH_FILTER=""  # empty = push all, otherwise glob pattern (e.g. "agent/*")
FIX_REMOTES=true  # auto-convert HTTPS→SSH remotes
PROTECTED_BRANCHES="main master"  # never push these — wormhole copies are always stale
PID_FILE="/tmp/pushbot.pid"
LOG_FILE="/tmp/pushbot.log"

# ── Args ──────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wormhole)   WORMHOLE_DIR="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --verbose)    VERBOSE=true; shift ;;
        --once)       WATCH_INTERVAL=0; shift ;;
        --watch)      WATCH_INTERVAL="$2"; shift 2 ;;
        --filter)     BRANCH_FILTER="$2"; shift 2 ;;
        --no-fix-remotes) FIX_REMOTES=false; shift ;;
        --pid-file)   PID_FILE="$2"; shift 2 ;;
        --log)        LOG_FILE="$2"; shift 2 ;;
        -h|--help)    sed -n '2,/^$/s/^# //p' "$0"; exit 0 ;;
        *)            echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Logging ───────────────────────────────────────────────────────────────

log() {
    echo "[$(date -Iseconds)] [pushbot] $*"
}

vlog() {
    [[ "$VERBOSE" == "true" ]] && log "$@" || true
}

# ── Fix HTTPS→SSH remotes ─────────────────────────────────────────────

fix_remote() {
    local repo_dir="$1"
    local url
    url=$(git -C "$repo_dir" remote get-url origin 2>/dev/null) || return 0

    if [[ "$url" == https://github.com/* ]]; then
        local new_url
        new_url=$(echo "$url" | sed 's|https://github.com/|git@github.com:|')
        git -C "$repo_dir" remote set-url origin "$new_url"
        log "Fixed remote: $(basename "$repo_dir"): $url → $new_url"
    fi
}

# ── Notify agentchat on push ──────────────────────────────────────────────

NOTIFY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/push-notify.cjs"

notify_push() {
    local repo="$1" branch="$2" output="$3"
    # Fire-and-forget — don't block pushbot on notification failures
    if [[ -f "$NOTIFY_SCRIPT" ]] && command -v node &>/dev/null; then
        local summary
        summary=$(echo "$output" | grep -E '^\s+[a-f0-9]+\.\.[a-f0-9]+' | head -3)
        node "$NOTIFY_SCRIPT" "PUSHED ${repo}/${branch}: ${summary}" &>/dev/null &
    fi
}

# ── Push one repo ─────────────────────────────────────────────────────────

push_repo() {
    local repo_dir="$1"
    local repo_name
    repo_name=$(basename "$repo_dir")

    # Skip if not a git repo
    if [[ ! -d "${repo_dir}/.git" ]]; then
        vlog "Skipping ${repo_name} — not a git repo"
        return 0
    fi

    # Check if remote exists
    if ! git -C "$repo_dir" remote get-url origin &>/dev/null; then
        log "SKIP ${repo_name} — no 'origin' remote configured"
        return 0
    fi

    # Auto-fix HTTPS→SSH if enabled
    [[ "$FIX_REMOTES" == "true" ]] && fix_remote "$repo_dir"

    # Get current branches
    local branches
    branches=$(git -C "$repo_dir" branch --format='%(refname:short)' 2>/dev/null)

    if [[ -z "$branches" ]]; then
        vlog "SKIP ${repo_name} — no branches"
        return 0
    fi

    # Filter branches if pattern specified
    if [[ -n "$BRANCH_FILTER" ]]; then
        local filtered=""
        while IFS= read -r branch; do
            # shellcheck disable=SC2254
            case "$branch" in
                $BRANCH_FILTER) filtered+="${branch}"$'\n' ;;
            esac
        done <<< "$branches"
        branches="${filtered%$'\n'}"
        if [[ -z "$branches" ]]; then
            vlog "SKIP ${repo_name} — no branches matching filter '${BRANCH_FILTER}'"
            return 0
        fi
    fi

    # Filter out protected branches (main/master) — wormhole copies are always
    # behind the real remote on these, so pushing them always fails.
    local filtered_branches=""
    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue
        local is_protected=false
        for pb in $PROTECTED_BRANCHES; do
            if [[ "$branch" == "$pb" ]]; then
                is_protected=true
                log "SKIP ${repo_name}/${branch} — protected branch"
                break
            fi
        done
        [[ "$is_protected" == "false" ]] && filtered_branches+="${branch}"$'\n'
    done <<< "$branches"
    branches="${filtered_branches%$'\n'}"

    if [[ -z "$branches" ]]; then
        log "SKIP ${repo_name} — only protected branches"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[dry-run] Would push ${repo_name}: ${branches//$'\n'/, }"
        return 0
    fi

    # Push branches (idempotent — no-ops if up to date)
    local push_errors=0
    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue
        local output
        # SECURITY: Disable git hooks — wormhole repos are agent-written, untrusted.
        # Hooks in .git/hooks/ could execute arbitrary code on the host.
        if output=$(GIT_TERMINAL_PROMPT=0 timeout 30 git -c core.hooksPath=/dev/null -C "$repo_dir" push origin "$branch" 2>&1); then
            if echo "$output" | grep -q "Everything up-to-date"; then
                vlog "OK ${repo_name}/${branch} — already up to date"
            else
                log "PUSHED ${repo_name}/${branch}:"
                echo "$output" | sed 's/^/  /'
                # Notify agentchat #pull-requests
                notify_push "${repo_name}" "${branch}" "$output"
            fi
        else
            log "ERROR pushing ${repo_name}/${branch}:"
            echo "$output" | sed 's/^/  /'
            push_errors=$((push_errors + 1))
        fi
    done <<< "$branches"

    # Also push tags if any (hooks disabled for security)
    git -c core.hooksPath=/dev/null -C "$repo_dir" push origin --tags 2>/dev/null || true

    [[ "$push_errors" -gt 0 ]] && return 1

    return 0
}

# ── Push all repos in wormhole ────────────────────────────────────────────

push_all() {
    if [[ ! -d "$WORMHOLE_DIR" ]]; then
        log "ERROR: Wormhole directory not found: $WORMHOLE_DIR"
        return 1
    fi

    local count=0
    local errors=0
    local pushed=0

    log "Scanning ${WORMHOLE_DIR}..."

    # Iterate over agent directories
    for agent_dir in "${WORMHOLE_DIR}"/*/; do
        [[ ! -d "$agent_dir" ]] && continue
        local agent_name
        agent_name=$(basename "$agent_dir")
        vlog "Checking agent: ${agent_name}"

        # Check if the agent dir itself is a git repo
        if [[ -d "${agent_dir}/.git" ]]; then
            if push_repo "$agent_dir"; then
                pushed=$((pushed + 1))
            else
                errors=$((errors + 1))
            fi
            count=$((count + 1))
        fi

        # Also check subdirectories (agents may have multiple repos)
        for sub_dir in "${agent_dir}"*/; do
            [[ ! -d "$sub_dir" ]] && continue
            if [[ -d "${sub_dir}/.git" ]]; then
                if push_repo "$sub_dir"; then
                    pushed=$((pushed + 1))
                else
                    errors=$((errors + 1))
                fi
                count=$((count + 1))
            fi
        done
    done

    log "Done: ${count} repos found, ${pushed} pushed, ${errors} errors"

    # Accumulate stats for heartbeat
    TOTAL_REPOS=$count
    TOTAL_PUSHED=$((TOTAL_PUSHED + pushed))
    TOTAL_ERRORS=$((TOTAL_ERRORS + errors))
    SCAN_COUNT=$((SCAN_COUNT + 1))
}

# ── Main ──────────────────────────────────────────────────────────────────

main() {
    # Redirect stdout/stderr to log file if in daemon mode
    if [[ "$WATCH_INTERVAL" -gt 0 && -n "$LOG_FILE" ]]; then
        exec >> "$LOG_FILE" 2>&1
    fi

    # Heartbeat counters
    TOTAL_PUSHED=0
    TOTAL_ERRORS=0
    TOTAL_REPOS=0
    SCAN_COUNT=0
    HEARTBEAT_INTERVAL=10  # emit heartbeat every N scans

    log "Starting pushbot (PID $$)"
    log "  Wormhole:     $WORMHOLE_DIR"
    log "  Dry-run:      $DRY_RUN"
    log "  Fix-remotes:  $FIX_REMOTES"
    [[ -n "$BRANCH_FILTER" ]] && log "  Filter:       $BRANCH_FILTER"
    [[ "$WATCH_INTERVAL" -gt 0 ]] && log "  Watch:        every ${WATCH_INTERVAL}s"

    # Write PID file for daemon mode
    if [[ "$WATCH_INTERVAL" -gt 0 ]]; then
        echo $$ > "$PID_FILE"
        log "PID file: $PID_FILE"
    fi

    # SECURITY: Self-update mechanism REMOVED — wormhole is untrusted agent data.
    # Never exec code that agents can write to. Scripts run from main repo only.

    if [[ "$WATCH_INTERVAL" -eq 0 ]]; then
        push_all
    else
        while [[ "$RUNNING" == "true" ]]; do
            # Catch errors — daemon must not die on transient failures
            push_all || log "WARNING: push_all had errors, continuing..."

            # Periodic heartbeat with stats
            if [[ $((SCAN_COUNT % HEARTBEAT_INTERVAL)) -eq 0 && $SCAN_COUNT -gt 0 ]]; then
                local disk_usage
                disk_usage=$(df -h "$WORMHOLE_DIR" 2>/dev/null | tail -1 | awk '{print $3"/"$2" ("$5" used)"}')
                local wormhole_size
                wormhole_size=$(du -sh "$WORMHOLE_DIR" 2>/dev/null | cut -f1)
                local agents_active
                agents_active=$(ls -d "${WORMHOLE_DIR}"/*/ 2>/dev/null | wc -l | tr -d ' ')
                log "HEARTBEAT: scans=$SCAN_COUNT repos=$TOTAL_REPOS pushed=$TOTAL_PUSHED errors=$TOTAL_ERRORS agents=$agents_active wormhole=$wormhole_size disk=$disk_usage"
            fi

            # Interruptible sleep
            local i=0
            while [[ $i -lt $WATCH_INTERVAL && "$RUNNING" == "true" ]]; do
                sleep 1
                i=$((i + 1))
            done
        done
    fi

    rm -f "$PID_FILE"
    log "Pushbot stopped"
}

# ── Signal handling ───────────────────────────────────────────────────

RUNNING=true

trap 'log "Shutting down..."; RUNNING=false' SIGINT SIGTERM

main
