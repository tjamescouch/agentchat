#!/usr/bin/env bash
set -euo pipefail

# Install boot/wake.md into the runner as ~/.claude/WAKE.md.
# Safe: overwrites the destination.

src_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
claude_dir="$HOME/.claude"
dest="$claude_dir/WAKE.md"

mkdir -p "$claude_dir"
cp "$src_dir/wake.md" "$dest"

printf "Installed %s -> %s\n" "$src_dir/wake.md" "$dest"
