#!/bin/bash
# pushbot — idempotently push all branches from wormhole agent repos to remote
#
# Iterates over every agent directory in the wormhole, finds git repos,
# and pushes all branches to origin. Uses semaphore-based change detection:
# after each successful push, records last_pushed_at; on next scan, only
# pushes repos with git objects newer than that timestamp. This makes the
# watch loop cheap (stat comparisons) and responsive (5s default poll).
#
# Usage:
#   ./pushbot.sh [options]
#     --wormhole <path>   Wormhole directory (default: ~/dev/claude/wormhole)
#     --dry-run           Show what would be pushed without doing it
#     --verbose           Show detailed output
#     --once              Run once and exit (default: run once)
#     --watch <secs>      Run in a loop every N seconds (default: 5 in watch mode)
#
# Examples:
#   ./pushbot.sh                              # push everything once
#   ./pushbot.sh --dry-run                    # see what would be pushed
#   ./pushbot.sh --watch                      # watch with 5s poll (semaphore-gated)
#   ./pushbot.sh --watch 10                   # watch with 10s poll
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
SKIP_PROTECTED=true  # skip main/master branches (never push these from wormhole)
DELETE_OLD_DAYS=0    # 0 = disabled, >0 = delete remote branches with no commits in N days
PID_FILE="/tmp/pushbot.pid"
LOG_FILE="/tmp/pushbot.log"
FAIL_DIR="/tmp/pushbot-failed"  # semaphore dir: tracks failed push commit hashes
AUTH_FAIL_FILE="/tmp/pushbot-auth-fail"  # circuit breaker: consecutive auth failures
MAX_AUTH_FAILS=3               # trip breaker after this many consecutive auth failures
AUTH_BACKOFF=1800              # seconds to sleep when breaker trips (30 min)

# ── Args ──────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wormhole)   WORMHOLE_DIR="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --verbose)    VERBOSE=true; shift ;;
        --once)       WATCH_INTERVAL=0; shift ;;
        --watch)
            if [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]]; then
                WATCH_INTERVAL="$2"; shift 2
            else
                WATCH_INTERVAL=5; shift  # default 5s — cheap with semaphores
            fi
            ;;
        --filter)     BRANCH_FILTER="$2"; shift 2 ;;
        --no-skip-protected) SKIP_PROTECTED=false; shift ;;
        --delete-old) DELETE_OLD_DAYS="$2"; shift 2 ;;
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

# ── Semaphore: change detection via mtime ────────────────────────────

SEMAPHORE_FILE=".pushbot_last_push"

# Check if a repo has changes newer than the last push.
# Compares mtime of git refs/objects against the semaphore marker.
# Returns 0 (true) if changes detected, 1 (false) if up to date.
repo_has_changes() {
    local repo_dir="$1"
    local marker="${repo_dir}/.git/${SEMAPHORE_FILE}"

    # No marker = never pushed = always push
    if [[ ! -f "$marker" ]]; then
        return 0
    fi

    # Check if any git refs are newer than the marker.
    # refs/heads/ contains branch tip files — their mtime updates on commit.
    # This is O(branches), not O(files), so it's cheap.
    local marker_ts
    marker_ts=$(stat -c '%Y' "$marker" 2>/dev/null || stat -f '%m' "$marker" 2>/dev/null) || return 0

    local newer=false
    for ref_file in "${repo_dir}/.git/refs/heads/"*; do
        [[ ! -f "$ref_file" ]] && continue
        local ref_ts
        ref_ts=$(stat -c '%Y' "$ref_file" 2>/dev/null || stat -f '%m' "$ref_file" 2>/dev/null) || continue
        if [[ "$ref_ts" -gt "$marker_ts" ]]; then
            newer=true
            break
        fi
    done

    # Also check packed-refs (branches may be packed)
    if [[ "$newer" == "false" && -f "${repo_dir}/.git/packed-refs" ]]; then
        local packed_ts
        packed_ts=$(stat -c '%Y' "${repo_dir}/.git/packed-refs" 2>/dev/null || stat -f '%m' "${repo_dir}/.git/packed-refs" 2>/dev/null) || packed_ts=0
        if [[ "$packed_ts" -gt "$marker_ts" ]]; then
            newer=true
        fi
    fi

    if [[ "$newer" == "true" ]]; then
        return 0  # has changes
    else
        return 1  # up to date
    fi
}

# Touch the semaphore marker after a successful push.
mark_pushed() {
    local repo_dir="$1"
    touch "${repo_dir}/.git/${SEMAPHORE_FILE}"
}

# ── Protected branch list ─────────────────────────────────────────────

PROTECTED_BRANCHES="main master"

is_protected_branch() {
    local branch="$1"
    for p in $PROTECTED_BRANCHES; do
        [[ "$branch" == "$p" ]] && return 0
    done
    return 1
}

# ── Notify agentchat on push ──────────────────────────────────────────────

NOTIFY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/push-notify.cjs"

notify_push() {
    local repo="$1" branch="$2" output="$3"
    # Fire-and-forget — don't block pushbot on notification failures
    if [[ -f "$NOTIFY_SCRIPT" ]] && command -v node &>/dev/null; then
        local summary
        summary=$(echo "$output" | grep -E '^\s+[a-f0-9]+\.\.[a-f0-9]+' | head -3)
        node "$NOTIFY_SCRIPT" "✅ PUSHED ${repo}/${branch}: ${summary}" &>/dev/null &
    fi
}

notify_error() {
    local repo="$1" branch="$2" output="$3"
    if [[ -f "$NOTIFY_SCRIPT" ]] && command -v node &>/dev/null; then
        local reason
        reason=$(echo "$output" | grep -E '(rejected|error|fatal)' | head -1 | sed 's/^ *//')
        node "$NOTIFY_SCRIPT" "❌ PUSH FAILED ${repo}/${branch}: ${reason}" &>/dev/null &
    fi
}

# ── Git push helper (HTTPS→SSH rewrite, hooks disabled) ──────────────────

git_push() {
    local repo_dir="$1" branch="$2"
    GIT_TERMINAL_PROMPT=0 timeout 30 \
        git -c core.hooksPath=/dev/null \
            -c 'url.git@github.com:.insteadOf=https://github.com/' \
            -C "$repo_dir" push origin "$branch" 2>&1
}

# ── Failed-push semaphore ─────────────────────────────────────────────────
# File-based: /tmp/pushbot-failed/<repo>__<branch> contains the commit hash
# that last failed. On retry, skip if local HEAD matches (nothing changed).
# On success, remove the semaphore. On new failure, write/update it.

fail_key() {
    # Sanitize repo:branch into a filename
    echo "${1}__${2}" | tr '/' '_'
}

get_failed_hash() {
    local f="${FAIL_DIR}/$(fail_key "$1" "$2")"
    [[ -f "$f" ]] && cat "$f" || echo ""
}

set_failed_hash() {
    mkdir -p "$FAIL_DIR"
    echo "$3" > "${FAIL_DIR}/$(fail_key "$1" "$2")"
}

clear_failed() {
    rm -f "${FAIL_DIR}/$(fail_key "$1" "$2")"
}

# ── Auth failure circuit breaker ─────────────────────────────────────────
# Detects SSH/auth failures (credential exhaustion, key issues) and stops
# hammering GitHub. Trips after MAX_AUTH_FAILS consecutive auth errors.

is_auth_error() {
    local output="$1"
    echo "$output" | grep -qiE 'permission denied|authentication|publickey|could not read from remote|403|401|rate limit|secondary rate'
}

get_auth_fails() {
    [[ -f "$AUTH_FAIL_FILE" ]] && cat "$AUTH_FAIL_FILE" || echo 0
}

record_auth_fail() {
    local count
    count=$(get_auth_fails)
    echo $((count + 1)) > "$AUTH_FAIL_FILE"
}

clear_auth_fails() {
    rm -f "$AUTH_FAIL_FILE"
}

check_circuit_breaker() {
    local fails
    fails=$(get_auth_fails)
    if [[ "$fails" -ge "$MAX_AUTH_FAILS" ]]; then
        log "CIRCUIT BREAKER: ${fails} consecutive auth failures — sleeping ${AUTH_BACKOFF}s"
        log "  (delete ${AUTH_FAIL_FILE} to reset manually)"
        # Reset counter so we retry after backoff
        echo 0 > "$AUTH_FAIL_FILE"
        return 1
    fi
    return 0
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
        vlog "SKIP ${repo_name} — no 'origin' remote"
        return 0
    fi

    # Semaphore check: skip if no changes since last push
    if ! repo_has_changes "$repo_dir"; then
        vlog "SKIP ${repo_name} — no changes since last push"
        return 0
    fi


    local push_errors=0
    local found=0
    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue

        if is_protected_branch "$branch"; then
            continue
        fi

        # Within-cycle dedup: skip if this repo+branch already handled by another agent
        local dedup_key="${repo_name}:${branch}"
        if [[ " ${CYCLE_SEEN} " == *" ${dedup_key} "* ]]; then
            vlog "SKIP ${repo_name}/${branch} — already handled this cycle"
            continue
        fi

        # Get local HEAD for this branch
        local head_hash
        head_hash=$(git -C "$repo_dir" rev-parse "$branch" 2>/dev/null) || continue

        # Cross-cycle: skip if same commit already failed (retry on new commits)
        local prev_fail
        prev_fail=$(get_failed_hash "$repo_name" "$branch")
        if [[ -n "$prev_fail" && "$prev_fail" == "$head_hash" ]]; then
            vlog "SKIP ${repo_name}/${branch} — unchanged since last failure (${head_hash:0:7})"
            CYCLE_SEEN+=" ${dedup_key}"
            continue
        fi

        found=$((found + 1))

        if [[ "$DRY_RUN" == "true" ]]; then
            log "[dry-run] Would push ${repo_name}/${branch} (${head_hash:0:7})"
            continue
        fi

        local output
        if output=$(git_push "$repo_dir" "$branch"); then
            if echo "$output" | grep -q "Everything up-to-date"; then
                vlog "OK ${repo_name}/${branch} — up to date"
            else
                log "PUSHED ${repo_name}/${branch}:"
                echo "$output" | sed 's/^/  /'
                notify_push "${repo_name}" "${branch}" "$output"
            fi
            # Clear any previous failure
            clear_failed "$repo_name" "$branch"
            # Success clears auth failure counter
            clear_auth_fails
        else
            log "ERROR ${repo_name}/${branch}: $(echo "$output" | head -1)"
            notify_error "${repo_name}" "${branch}" "$output"
            # Record failure with this commit hash — won't retry until commit changes
            set_failed_hash "$repo_name" "$branch" "$head_hash"
            push_errors=$((push_errors + 1))
            # Track auth failures for circuit breaker
            if is_auth_error "$output"; then
                record_auth_fail
                log "AUTH FAIL #$(get_auth_fails) — credential/SSH issue detected"
            fi
        fi
        # Mark as seen this cycle (dedup across agent dirs with same repo)
        CYCLE_SEEN+=" ${dedup_key}"
    done < <(git -C "$repo_dir" branch --format='%(refname:short)' 2>/dev/null)

    [[ "$found" -eq 0 ]] && vlog "SKIP ${repo_name} — no non-protected branches"

    [[ "$push_errors" -gt 0 ]] && return 1

    # Mark successful push — update semaphore
    mark_pushed "$repo_dir"


    return 0
}

# ── Delete stale remote branches ──────────────────────────────────────────

delete_old_branches() {
    local repo_dir="$1"
    local repo_name
    repo_name=$(basename "$repo_dir")

    [[ "$DELETE_OLD_DAYS" -le 0 ]] && return 0
    [[ ! -d "${repo_dir}/.git" ]] && return 0

    local cutoff_epoch
    cutoff_epoch=$(date -v-${DELETE_OLD_DAYS}d +%s 2>/dev/null || date -d "${DELETE_OLD_DAYS} days ago" +%s 2>/dev/null) || return 0

    # Skip if circuit breaker already tripped
    [[ $(get_auth_fails) -ge $MAX_AUTH_FAILS ]] && return 0

    # Fetch remote branch info
    local fetch_output
    fetch_output=$(GIT_TERMINAL_PROMPT=0 timeout 30 git -c core.hooksPath=/dev/null \
        -c 'url.git@github.com:.insteadOf=https://github.com/' \
        -C "$repo_dir" fetch origin --prune 2>&1)
    if [[ $? -ne 0 ]]; then
        if is_auth_error "$fetch_output"; then
            record_auth_fail
            log "AUTH FAIL on fetch ${repo_name}: $(echo "$fetch_output" | head -1)"
        fi
        return 0
    fi

    while IFS= read -r ref; do
        [[ -z "$ref" ]] && continue
        local branch="${ref#origin/}"

        is_protected_branch "$branch" && continue

        # Get last commit date on remote branch
        local last_commit_epoch
        last_commit_epoch=$(git -C "$repo_dir" log -1 --format='%ct' "refs/remotes/origin/${branch}" 2>/dev/null) || continue
        [[ -z "$last_commit_epoch" ]] && continue

        if [[ "$last_commit_epoch" -lt "$cutoff_epoch" ]]; then
            local age_days=$(( ($(date +%s) - last_commit_epoch) / 86400 ))
            if [[ "$DRY_RUN" == "true" ]]; then
                log "[dry-run] Would delete stale branch ${repo_name}/${branch} (${age_days}d old)"
            else
                local output
                if output=$(GIT_TERMINAL_PROMPT=0 timeout 30 git -c core.hooksPath=/dev/null \
                    -c 'url.git@github.com:.insteadOf=https://github.com/' \
                    -C "$repo_dir" push origin --delete "$branch" 2>&1); then
                    log "DELETED stale branch ${repo_name}/${branch} (${age_days}d old)"
                    notify_push "${repo_name}" "${branch}" "🗑️ Deleted stale branch (${age_days}d old, threshold: ${DELETE_OLD_DAYS}d)"
                    clear_auth_fails
                else
                    log "ERROR deleting ${repo_name}/${branch}: $(echo "$output" | head -1)"
                    if is_auth_error "$output"; then
                        record_auth_fail
                        return 0  # stop deleting — auth is broken
                    fi
                fi
            fi
        fi
    done < <(git -C "$repo_dir" branch -r --format='%(refname:short)' 2>/dev/null | grep '^origin/' | grep -v 'origin/HEAD')
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
    CYCLE_SEEN=""    # dedup: tracks repo:branch combos already attempted this cycle
    CLEANED_SET=""   # dedup: tracks repos already cleaned this cycle

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
            if [[ "$DELETE_OLD_DAYS" -gt 0 ]] && [[ " ${CLEANED_SET} " != *" $(basename "$agent_dir") "* ]]; then
                delete_old_branches "$agent_dir"
                CLEANED_SET+=" $(basename "$agent_dir")"
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
                if [[ "$DELETE_OLD_DAYS" -gt 0 ]] && [[ " ${CLEANED_SET} " != *" $(basename "$sub_dir") "* ]]; then
                    delete_old_branches "$sub_dir"
                    CLEANED_SET+=" $(basename "$sub_dir")"
                fi
                count=$((count + 1))
            fi
        done
    done

    local skipped=$((count - pushed - errors))
    log "Done: ${count} repos scanned, ${pushed} pushed, ${skipped} unchanged, ${errors} errors"

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
    log "  Skip-protected: $SKIP_PROTECTED"
    [[ "$DELETE_OLD_DAYS" -gt 0 ]] && log "  Delete-old:   ${DELETE_OLD_DAYS}d"
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
            # Circuit breaker: skip cycle if too many consecutive auth failures
            if ! check_circuit_breaker; then
                # Sleep the backoff period (interruptible)
                local b=0
                while [[ $b -lt $AUTH_BACKOFF && "$RUNNING" == "true" ]]; do
                    sleep 1
                    b=$((b + 1))
                done
                continue
            fi

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
