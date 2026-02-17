#!/opt/homebrew/bin/bash
# run-pipeline.sh — Mac-side launcher for pipeline.sh
#
# Forwards Lima VM's podman socket locally, then runs the pipeline daemon.
# This enables pipeline.sh to call `podman ps` and `podman exec` against
# containers running inside the Lima VM.
#
# Usage:
#   ./run-pipeline.sh [pipeline.sh args...]
#   ./run-pipeline.sh --dry-run --verbose --once
#
# The pipeline runs until interrupted (Ctrl-C) or killed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE="${SCRIPT_DIR}/pipeline.sh"

LIMA_VM="${LIMA_VM:-thesystem}"
LIMA_PODMAN_SOCK="/run/user/501/podman/podman.sock"
LOCAL_PODMAN_SOCK="${LOCAL_PODMAN_SOCK:-/tmp/lima-podman.sock}"

# ── SSH config for Lima ───────────────────────────────────────────────────────

get_lima_port() {
    limactl list 2>/dev/null | awk -v vm="$LIMA_VM" '$1==vm {split($3,a,":"); print a[2]}'
}

start_tunnel() {
    local port="$1"
    rm -f "$LOCAL_PODMAN_SOCK"
    ssh -N -f \
        -i ~/.lima/_config/user \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o LogLevel=ERROR \
        -o ExitOnForwardFailure=yes \
        -L "${LOCAL_PODMAN_SOCK}:${LIMA_PODMAN_SOCK}" \
        -p "$port" jamescouch@127.0.0.1
}

ensure_tunnel() {
    # Check if socket exists and is connectable
    if [[ -S "$LOCAL_PODMAN_SOCK" ]]; then
        CONTAINER_HOST="unix://${LOCAL_PODMAN_SOCK}" podman info &>/dev/null && return 0
    fi
    echo "[run-pipeline] Starting podman socket tunnel (Lima VM: ${LIMA_VM})..." >&2
    local port; port=$(get_lima_port)
    if [[ -z "$port" ]]; then
        echo "[run-pipeline] ERROR: Lima VM '${LIMA_VM}' not found or not running" >&2
        return 1
    fi
    start_tunnel "$port"
    sleep 1
    CONTAINER_HOST="unix://${LOCAL_PODMAN_SOCK}" podman info &>/dev/null || {
        echo "[run-pipeline] ERROR: podman socket tunnel failed to connect" >&2
        return 1
    }
    echo "[run-pipeline] Tunnel ready at ${LOCAL_PODMAN_SOCK}" >&2
}

# ── Main ─────────────────────────────────────────────────────────────────────

ensure_tunnel

export CONTAINER_HOST="unix://${LOCAL_PODMAN_SOCK}"

exec /opt/homebrew/bin/bash "$PIPELINE" "$@"
