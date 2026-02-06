#!/bin/bash
# God Backup - creates a timestamped backup of all God state
# Usage: ./god-backup.sh [backup-dir]

BACKUP_BASE="${1:-$HOME/.agentchat/backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_BASE/god-$TIMESTAMP"

GOD_STATE="$HOME/.agentchat/agents/God"
PLUGIN_DIR="$HOME/dev/claude/agentchat-memory"
SUPERVISOR_DIR="$HOME/dev/claude/agentchat/lib/supervisor"

echo "=== God Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Backup to: $BACKUP_DIR"
echo

mkdir -p "$BACKUP_DIR"

# 1. Backup God state files
echo "[1/4] Backing up God state..."
if [ -d "$GOD_STATE" ]; then
    cp -r "$GOD_STATE" "$BACKUP_DIR/agents-God"
    echo "  ✓ State files copied"
else
    echo "  ✗ No state directory found!"
fi

# 2. Backup memory plugin source
echo "[2/4] Backing up memory plugin..."
if [ -d "$PLUGIN_DIR" ]; then
    mkdir -p "$BACKUP_DIR/agentchat-memory"
    cp -r "$PLUGIN_DIR/src" "$BACKUP_DIR/agentchat-memory/"
    cp "$PLUGIN_DIR/package.json" "$BACKUP_DIR/agentchat-memory/"
    cp "$PLUGIN_DIR/tsconfig.json" "$BACKUP_DIR/agentchat-memory/"
    echo "  ✓ Plugin source copied"
else
    echo "  ✗ Plugin directory not found!"
fi

# 3. Backup supervisor scripts
echo "[3/4] Backing up supervisor scripts..."
if [ -d "$SUPERVISOR_DIR" ]; then
    mkdir -p "$BACKUP_DIR/supervisor"
    cp "$SUPERVISOR_DIR"/*.sh "$BACKUP_DIR/supervisor/"
    echo "  ✓ Scripts copied"
else
    echo "  ✗ Supervisor directory not found!"
fi

# 4. Backup Claude settings
echo "[4/4] Backing up Claude settings..."
if [ -f "$HOME/.claude/settings.json" ]; then
    cp "$HOME/.claude/settings.json" "$BACKUP_DIR/"
    echo "  ✓ Settings copied"
else
    echo "  ✗ Settings not found!"
fi

# Create manifest
cat > "$BACKUP_DIR/MANIFEST.md" << EOF
# God Backup Manifest

**Created:** $(date)
**Backup ID:** $TIMESTAMP

## Contents

- \`agents-God/\` - God's state files (memory, commandments, context)
- \`agentchat-memory/\` - Memory plugin source
- \`supervisor/\` - Watchdog and control scripts
- \`settings.json\` - Claude Code MCP configuration

## Restore Instructions

1. Stop any running God processes:
   \`\`\`
   ~/bin/agentctl kill God
   pkill -f god-watchdog
   \`\`\`

2. Restore state files:
   \`\`\`
   cp -r agents-God/* ~/.agentchat/agents/God/
   \`\`\`

3. Restore plugin (if needed):
   \`\`\`
   cp -r agentchat-memory/* ~/dev/claude/agentchat-memory/
   cd ~/dev/claude/agentchat-memory && npm install && npm run build
   \`\`\`

4. Restore scripts (if needed):
   \`\`\`
   cp supervisor/*.sh ~/dev/claude/agentchat/lib/supervisor/
   chmod +x ~/dev/claude/agentchat/lib/supervisor/*.sh
   \`\`\`

5. Restore settings (if needed):
   \`\`\`
   cp settings.json ~/.claude/
   \`\`\`

6. Restart watchdog:
   \`\`\`
   ~/bin/god-watchdog &
   \`\`\`
EOF

# Create tarball
echo
echo "Creating archive..."
cd "$BACKUP_BASE"
tar -czf "god-$TIMESTAMP.tar.gz" "god-$TIMESTAMP"
echo "  ✓ Archive: $BACKUP_BASE/god-$TIMESTAMP.tar.gz"

# Calculate size
SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
TARSIZE=$(du -sh "$BACKUP_BASE/god-$TIMESTAMP.tar.gz" | cut -f1)

echo
echo "=== Backup Complete ==="
echo "Directory: $BACKUP_DIR ($SIZE)"
echo "Archive: god-$TIMESTAMP.tar.gz ($TARSIZE)"
echo
echo "To restore: tar -xzf god-$TIMESTAMP.tar.gz && cat god-$TIMESTAMP/MANIFEST.md"
