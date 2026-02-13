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
SYNC_INTERVAL=60
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

# ── Sync one container ───────────────────────────────────────────────────

sync_container() {
    local container_id="$1"
    local agent_name="$2"
    local dest="${WORMHOLE_DIR}/${agent_name}"

    log "Syncing $agent_name ($container_id) → $dest"

    # Create destination
    mkdir -p "$dest"

    # Build exclude args
    local exclude_args
    exclude_args=$(build_exclude_args "$container_id")

    if [[ "$DRY_RUN" == "true" ]]; then
        log_always "[dry-run] Would sync $container_id:${CONTAINER_SOURCE}/ → $dest/"
        log_always "[dry-run] Excludes: $exclude_args"
        return 0
    fi

    # Method 1: rsync via podman exec (preferred — incremental, respects excludes)
    # Requires rsync installed in the container
    if podman exec "$container_id" which rsync &>/dev/null; then
        log "Using rsync for $agent_name"

        # Create a temporary exclude file for rsync
        local exclude_file
        exclude_file=$(mktemp)
        for pattern in "${DEFAULT_EXCLUDES[@]}"; do
            echo "$pattern" >> "$exclude_file"
        done

        # Add .syncignore entries
        local syncignore
        syncignore=$(podman exec "$container_id" cat "${CONTAINER_SOURCE}/.syncignore" 2>/dev/null || true)
        if [[ -n "$syncignore" ]]; then
            while IFS= read -r line; do
                [[ -z "$line" || "$line" == \#* ]] && continue
                echo "$line" >> "$exclude_file"
            done <<< "$syncignore"
        fi

        # Use podman exec to tar from container, pipe to local extraction
        # Write to temp dir first for crash safety (same pattern as podman cp path)
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

            # Atomic swap
            if [[ -d "$dest" ]]; then
                rm -rf "${dest}.old"
                mv "$dest" "${dest}.old"
            fi
            mv "$tar_tmp" "$dest"
            rm -rf "${dest}.old"
        else
            log_always "ERROR: tar pipe failed for $agent_name ($container_id)"
            rm -rf "$tar_tmp"
        fi

        rm -f "$exclude_file"
        log "tar sync complete for $agent_name"
        return 0
    fi

    # Method 2: podman cp (fallback — full copy each time, but always works)
    log "Using podman cp for $agent_name (rsync not available)"

    # podman cp with trailing /. copies contents including dotfiles
    # We copy to a temp dir first, then move, to avoid partial copies
    local tmp_dest="${dest}.tmp.$$"
    rm -rf "$tmp_dest"
    mkdir -p "$tmp_dest"

    if podman cp "${container_id}:${CONTAINER_SOURCE}/." "$tmp_dest/" 2>/dev/null; then
        # Remove excluded paths from the copy
        for pattern in "${DEFAULT_EXCLUDES[@]}"; do
            # Simple glob removal (works for directory patterns like node_modules/)
            local clean_pattern="${pattern%/}"
            find "$tmp_dest" -name "$clean_pattern" -prune -exec rm -rf {} + 2>/dev/null || true
        done

        # Check for .syncignore and remove those too
        if [[ -f "${tmp_dest}/.syncignore" ]]; then
            while IFS= read -r line; do
                [[ -z "$line" || "$line" == \#* ]] && continue
                local clean="${line%/}"
                find "$tmp_dest" -name "$clean" -prune -exec rm -rf {} + 2>/dev/null || true
            done < "${tmp_dest}/.syncignore"
        fi

        # Atomic swap
        if [[ -d "$dest" ]]; then
            rm -rf "${dest}.old"
            mv "$dest" "${dest}.old"
        fi
        mv "$tmp_dest" "$dest"
        rm -rf "${dest}.old"

        log "podman cp complete for $agent_name"
    else
        log_always "ERROR: podman cp failed for $agent_name ($container_id)"
        rm -rf "$tmp_dest"
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

sync_all() {
    local count=0
    local errors=0

    while IFS=' ' read -r container_id agent_raw; do
        [[ -z "$container_id" ]] && continue
        local agent_name
        agent_name=$(get_agent_name "$agent_raw")
        [[ -z "$agent_name" ]] && continue

        if sync_container "$container_id" "$agent_name"; then
            # SECURITY: sanitize after every sync
            sanitize_wormhole "${WORMHOLE_DIR}/${agent_name}" "$agent_name"
            count=$((count + 1))
        else
            errors=$((errors + 1))
        fi
    done < <(discover_containers)

    log "Sync complete: $count containers synced, $errors errors"
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
