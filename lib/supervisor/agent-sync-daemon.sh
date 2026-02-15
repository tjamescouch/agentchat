#!/bin/bash
# Agent Sync Daemon — mirrors agent container workspaces to wormhole on the host
#
# Runs on the HOST (metal), not inside containers. Periodically copies each
# running agent container's project directory to wormhole/<agent-name>/,
# including .git/ and dotfiles. Supports .syncignore for excluding paths
# like node_modules/ and dist/.
#
# Usage: ./agent-sync-daemon.sh [options]
#   --wormhole <path>    Wormhole output directory (default: ~/dev/claude/wormhole)
#   --interval <secs>    Sync interval in seconds (default: 60)
#   --source <path>      Source path inside containers (default: /home/agent)
#   --once               Run once and exit (no loop)
#   --dry-run            Show what would be synced without copying
#   --verbose            Verbose output
#
# The daemon discovers running agent containers by looking for containers
# with the label "agentchat.agent" or whose name matches "agent-*" or
# "agentchat-*". Each container's workspace is mirrored to:
#   <wormhole>/<agent-name>/
#
# .syncignore:
#   If the container's source directory contains a .syncignore file, paths
#   listed in it (gitignore-style) are excluded from the copy. A default
#   set of exclusions is always applied (node_modules, .cache, etc).

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────

WORMHOLE_DIR="${HOME}/dev/claude/wormhole"
SYNC_INTERVAL=10  # fast default: HEAD-check gated, cheap when idle
CONTAINER_SOURCE="/home/agent"
RUN_ONCE=false
DRY_RUN=false
VERBOSE=false
LOG_FILE=""

# ── Default exclusions (always applied) ───────────────────────────────────

DEFAULT_EXCLUDES=(
    "node_modules/"
    ".cache/"
    ".npm/"
    ".local/"
    "__pycache__/"
    "*.pyc"
    ".DS_Store"
    "Thumbs.db"
)

# ── Arg parsing ───────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wormhole)   WORMHOLE_DIR="$2"; shift 2 ;;
        --interval)   SYNC_INTERVAL="$2"; shift 2 ;;
        --source)     CONTAINER_SOURCE="$2"; shift 2 ;;
        --once)       RUN_ONCE=true; shift ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --verbose)    VERBOSE=true; shift ;;
        --log)        LOG_FILE="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,/^$/s/^# //p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ── Logging ───────────────────────────────────────────────────────────────

log() {
    local msg="[$(date -Iseconds)] [sync] $*"
    if [[ -n "$LOG_FILE" ]]; then
        echo "$msg" >> "$LOG_FILE"
    fi
    if [[ "$VERBOSE" == "true" ]]; then
        echo "$msg" >&2
    fi
}

log_always() {
    local msg="[$(date -Iseconds)] [sync] $*"
    if [[ -n "$LOG_FILE" ]]; then
        echo "$msg" >> "$LOG_FILE"
    fi
    echo "$msg" >&2
}

# ── Container discovery ──────────────────────────────────────────────────

discover_containers() {
    # Find running containers that look like agent containers.
    # Strategy: find by name matching agent-* / agentchat-*
    # Output: <container_id> <agent_name> (one per line)
    # Note: podman label queries return "true" not label values, so we use names only.

    podman ps --format '{{.ID}} {{.Names}}' 2>/dev/null | grep -E '(agent-|agentchat-)' || true
}

# ── Extract agent name from container info ────────────────────────────────

get_agent_name() {
    local name="$1"
    # Strip common prefixes to get a clean agent name
    name="${name#agent-}"
    name="${name#agentchat-}"
    # Lowercase and sanitize
    echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g'
}

# ── Build exclusion list ─────────────────────────────────────────────────

build_exclude_args() {
    local container_id="$1"
    local excludes=()

    # Always apply default excludes
    for pattern in "${DEFAULT_EXCLUDES[@]}"; do
        excludes+=("--exclude" "$pattern")
    done

    # Check for .syncignore in the container
    local syncignore
    syncignore=$(podman exec "$container_id" cat "${CONTAINER_SOURCE}/.syncignore" 2>/dev/null || true)

    if [[ -n "$syncignore" ]]; then
        log "Found .syncignore in $container_id"
        while IFS= read -r line; do
            # Skip comments and blank lines
            [[ -z "$line" || "$line" == \#* ]] && continue
            excludes+=("--exclude" "$line")
        done <<< "$syncignore"
    fi

    echo "${excludes[@]}"
}

# ── HEAD cache for fast change detection ────────────────────────────────
# Stores last-seen HEAD for each repo inside each container.
# Format: HEADS_CACHE["agent/repo"] = "commit_hash"
declare -A HEADS_CACHE

get_container_heads() {
    # Get HEAD hashes for all git repos in a container with a single exec call.
    # Output: "repo_dir commit_hash" per line
    local container_id="$1"
    podman exec "$container_id" bash -c '
        for d in '"${CONTAINER_SOURCE}"'/*/; do
            [ -d "$d/.git" ] && echo "$(basename "$d") $(git -C "$d" rev-parse HEAD 2>/dev/null)"
        done
        # Also check if source dir itself is a repo
        [ -d '"${CONTAINER_SOURCE}"'/.git ] && echo ". $(git -C '"${CONTAINER_SOURCE}"' rev-parse HEAD 2>/dev/null)"
    ' 2>/dev/null || true
}

# ── Sync one container ───────────────────────────────────────────────────

sync_container() {
    local container_id="$1"
    local agent_name="$2"
    local dest="${WORMHOLE_DIR}/${agent_name}"

    # ── Fast path: check if any repo HEADs changed ──────────────────────
    local any_changed=false
    local changed_repos=""
    while IFS=' ' read -r repo_name head_hash; do
        [[ -z "$repo_name" || -z "$head_hash" ]] && continue
        local cache_key="${agent_name}/${repo_name}"
        local prev_hash="${HEADS_CACHE[$cache_key]:-}"
        if [[ "$prev_hash" != "$head_hash" ]]; then
            any_changed=true
            changed_repos+=" ${repo_name}"
            HEADS_CACHE["$cache_key"]="$head_hash"
        fi
    done < <(get_container_heads "$container_id")

    if [[ "$any_changed" == "false" ]]; then
        vlog "SKIP $agent_name — no HEAD changes"
        return 0
    fi

    log "Changes in $agent_name:${changed_repos} — syncing"

    # Create destination
    mkdir -p "$dest"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_always "[dry-run] Would sync $container_id:${CONTAINER_SOURCE}/ → $dest/"
        return 0
    fi

    # Sync only changed repos (tar just the .git + source for each)
    for repo_name in $changed_repos; do
        local src_path
        if [[ "$repo_name" == "." ]]; then
            src_path="${CONTAINER_SOURCE}"
        else
            src_path="${CONTAINER_SOURCE}/${repo_name}"
        fi
        local repo_dest="${dest}/${repo_name}"
        [[ "$repo_name" == "." ]] && repo_dest="$dest"

        mkdir -p "$repo_dest"

        # Tar the repo from container, extract locally
        if podman exec "$container_id" tar cf - \
            --exclude='node_modules' \
            --exclude='.cache' \
            --exclude='.npm' \
            --exclude='.local' \
            --exclude='__pycache__' \
            -C "$(dirname "$src_path")" \
            "$(basename "$src_path")" \
            2>/dev/null | tar xf - -C "$(dirname "$repo_dest")" --strip-components=0 2>/dev/null; then
            vlog "Synced ${agent_name}/${repo_name}"
        else
            log "ERROR: tar sync failed for ${agent_name}/${repo_name}"
        fi
    done
}

# ── Full sync (used on first run to catch repos from previous sessions) ──

full_sync_container() {
    local container_id="$1"
    local agent_name="$2"
    local dest="${WORMHOLE_DIR}/${agent_name}"

    log "Full sync $agent_name ($container_id) → $dest"
    mkdir -p "$dest"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_always "[dry-run] Would full-sync $container_id:${CONTAINER_SOURCE}/ → $dest/"
        return 0
    fi

    local tar_tmp="${dest}.tmp.$$"
    rm -rf "$tar_tmp"
    mkdir -p "$tar_tmp"

    if podman exec "$container_id" tar cf - \
        --exclude='node_modules' \
        --exclude='.cache' \
        --exclude='.npm' \
        --exclude='.local' \
        --exclude='__pycache__' \
        -C "$(dirname "$CONTAINER_SOURCE")" \
        "$(basename "$CONTAINER_SOURCE")" \
        | tar xf - -C "$tar_tmp" --strip-components=1 2>/dev/null; then
        if [[ -d "$dest" ]]; then
            cp -a "$tar_tmp/." "$dest/" 2>/dev/null || true
            rm -rf "$tar_tmp"
        else
            mv "$tar_tmp" "$dest"
        fi
        log "Full sync complete for $agent_name"

        # Populate HEAD cache after full sync
        while IFS=' ' read -r repo_name head_hash; do
            [[ -z "$repo_name" || -z "$head_hash" ]] && continue
            HEADS_CACHE["${agent_name}/${repo_name}"]="$head_hash"
        done < <(get_container_heads "$container_id")
    else
        log_always "ERROR: full sync failed for $agent_name ($container_id)"
        rm -rf "$tar_tmp"
        return 1
    fi
}

# ── SECURITY: Sanitize wormhole after sync ───────────────────────────────
#
# The wormhole contains UNTRUSTED agent-written code from sandboxed containers.
# Agents could craft malicious git hooks, executable scripts, or symlinks that
# execute on the host when tools like pushbot run git operations.
# This function strips dangerous artifacts after every sync.

sanitize_wormhole() {
    local dest="$1"
    local agent_name="$2"

    # Remove all git hooks — these execute on the HOST during git operations
    find "$dest" -path '*/.git/hooks/*' -type f -delete 2>/dev/null || true
    find "$dest" -path '*/.git/hooks' -type d -exec rmdir {} + 2>/dev/null || true

    # Remove symlinks — could point outside wormhole to host files
    find "$dest" -type l -delete 2>/dev/null || true

    # Strip execute bit from all files — wormhole is data, not executables
    # (pushbot and review.sh run from main repo, never from wormhole)
    find "$dest" -type f -perm +111 -exec chmod -x {} + 2>/dev/null || true

    log "Sanitized $agent_name (hooks stripped, symlinks removed, exec bits cleared)"
}

# ── Main sync loop ───────────────────────────────────────────────────────

FIRST_RUN=true

sync_all() {
    local count=0
    local errors=0
    local synced=0

    while IFS=' ' read -r container_id agent_raw; do
        [[ -z "$container_id" ]] && continue
        local agent_name
        agent_name=$(get_agent_name "$agent_raw")
        [[ -z "$agent_name" ]] && continue

        local ok=false
        if [[ "$FIRST_RUN" == "true" ]]; then
            # First run: full sync to catch everything
            full_sync_container "$container_id" "$agent_name" && ok=true
        else
            # Subsequent runs: fast incremental (HEAD-check gated)
            sync_container "$container_id" "$agent_name" && ok=true
        fi

        if $ok; then
            # SECURITY: sanitize after every sync
            sanitize_wormhole "${WORMHOLE_DIR}/${agent_name}" "$agent_name"
            count=$((count + 1))
        else
            errors=$((errors + 1))
        fi
    done < <(discover_containers)

    FIRST_RUN=false
    [[ "$VERBOSE" == "true" || $synced -gt 0 || $errors -gt 0 ]] && \
        log "Sync cycle: $count containers checked, $errors errors"
}

# ── Signal handling ──────────────────────────────────────────────────────

RUNNING=true

cleanup() {
    log_always "Sync daemon shutting down"
    RUNNING=false
}

trap cleanup SIGINT SIGTERM

# ── Entry point ──────────────────────────────────────────────────────────

main() {
    log_always "Agent sync daemon starting"
    log_always "  Wormhole: $WORMHOLE_DIR"
    log_always "  Interval: ${SYNC_INTERVAL}s"
    log_always "  Source:   $CONTAINER_SOURCE"
    log_always "  Dry-run:  $DRY_RUN"

    mkdir -p "$WORMHOLE_DIR"

    if [[ "$RUN_ONCE" == "true" ]]; then
        sync_all
        exit 0
    fi

    while [[ "$RUNNING" == "true" ]]; do
        sync_all

        # Interruptible sleep
        local i=0
        while [[ $i -lt $SYNC_INTERVAL && "$RUNNING" == "true" ]]; do
            sleep 1
            i=$((i + 1))
        done
    done

    log_always "Sync daemon stopped"
}

main
