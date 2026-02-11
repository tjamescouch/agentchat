#!/usr/bin/env node

/**
 * claude-deadman-tui — TUI wrapper for Claude Code with dead man's switch
 *
 * Spawns `claude` via `script` (to get a PTY) and renders a status bar
 * showing auto-approve countdown, deny matches, and approval history.
 *
 * Usage:
 *   node claude-deadman-tui.mjs [--timeout 120] [--deny <pattern>] [--log <path>] [--dry-run] -- [claude args...]
 *
 * Controls:
 *   Ctrl+C    — kill claude and exit
 *   Ctrl+A    — approve immediately (during countdown)
 *   Ctrl+D    — deny immediately (during countdown)
 *   Any key   — cancel countdown, forward input to claude
 *
 * Spec: JC (agentchat)
 * Build: BobTheBuilder
 */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let timeout = 120;
let denyPatterns = [];
let logPath = resolve(process.env.HOME || '/tmp', '.claude-deadman.log');
let dryRun = false;
let claudeArgs = [];

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--timeout':
      timeout = parseInt(args[++i], 10);
      if (isNaN(timeout) || timeout < 1) { console.error('Invalid timeout'); process.exit(1); }
      break;
    case '--deny':
      denyPatterns.push(new RegExp(args[++i]));
      break;
    case '--log':
      logPath = resolve(args[++i]);
      break;
    case '--dry-run':
      dryRun = true;
      break;
    case '--':
      claudeArgs = args.slice(i + 1);
      i = args.length;
      break;
    default:
      claudeArgs.push(args[i]);
  }
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line);
  } catch { /* best effort */ }
}

// ── Prompt Detection ────────────────────────────────────────────────────────

const PROMPT_PATTERNS = [
  /\[Y\/n\]/,
  /Allow .+\?/i,
  /Do you want to (allow|proceed)/i,
  /\(y\/n\)/i,
];

function stripAnsi(text) {
  // Strip all ANSI escape sequences (colors, cursor movement, etc.)
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function isPrompt(text) {
  return PROMPT_PATTERNS.some(p => p.test(stripAnsi(text)));
}

function matchesDenyList(text) {
  return denyPatterns.some(p => p.test(stripAnsi(text)));
}

// ── Terminal Helpers ────────────────────────────────────────────────────────

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

function saveCursor()    { process.stdout.write('\x1b[s'); }
function restoreCursor() { process.stdout.write('\x1b[u'); }
function moveTo(row, col) { process.stdout.write(`\x1b[${row};${col}H`); }
function clearLine()     { process.stdout.write('\x1b[2K'); }

// Stats
let approveCount = 0;
let denyCount = 0;
let manualCount = 0;

function renderStatusBar(countdownSecs = null) {
  saveCursor();
  moveTo(rows, 1);
  clearLine();

  let left = '';
  if (countdownSecs !== null) {
    const bar = '█'.repeat(Math.ceil(countdownSecs / timeout * 20));
    const empty = '░'.repeat(20 - bar.length);
    left = `\x1b[36m⏱ ${countdownSecs}s\x1b[0m [${bar}${empty}] \x1b[33mCtrl+A\x1b[0m=approve \x1b[31mCtrl+D\x1b[0m=deny`;
  } else {
    left = `\x1b[32m● deadman\x1b[0m timeout=${timeout}s`;
  }

  const right = `✓${approveCount} ✗${denyCount} ✋${manualCount}`;
  const padding = Math.max(1, cols - stripAnsi(left).length - right.length);

  process.stdout.write(`\x1b[7m${left}${' '.repeat(padding)}${right}\x1b[0m`);
  restoreCursor();
}

// ── Spawn Claude via script (PTY) ──────────────────────────────────────────

// Use `script` to allocate a PTY so Claude gets a real terminal
// macOS: script -q /dev/null command args...
// Linux: script -qc "command args..." /dev/null
const isMac = process.platform === 'darwin';
const claudeCmd = ['claude', ...claudeArgs];
const scriptArgs = isMac
  ? ['-q', '/dev/null', ...claudeCmd]
  : ['-qc', claudeCmd.join(' '), '/dev/null'];
const child = spawn('script', scriptArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    FORCE_COLOR: '1',
    COLUMNS: String(cols),
    LINES: String(rows - 1), // Reserve bottom line for status bar
    TERM: process.env.TERM || 'xterm-256color',
  },
});

let pendingTimer = null;
let pendingPromptText = '';
let countdownInterval = null;
let countdownRemaining = 0;

// Forward stderr
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

// Watch stdout
let outputBuffer = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(chunk); // Pass through Claude's output

  outputBuffer += text;
  const window = outputBuffer.slice(-500);

  if (isPrompt(window) && !pendingTimer) {
    pendingPromptText = stripAnsi(window.trim().split('\n').pop() || window.trim());

    if (matchesDenyList(pendingPromptText)) {
      denyCount++;
      log(`DENY-MATCH: ${pendingPromptText}`);
      renderStatusBar();
      if (!dryRun) {
        child.stdin.write('n\n');
      }
      return;
    }

    // Start countdown
    countdownRemaining = timeout;
    renderStatusBar(countdownRemaining);

    countdownInterval = setInterval(() => {
      countdownRemaining--;
      renderStatusBar(countdownRemaining);
      if (countdownRemaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }, 1000);

    pendingTimer = setTimeout(() => {
      clearInterval(countdownInterval);
      countdownInterval = null;

      if (dryRun) {
        log(`DRY-RUN: ${pendingPromptText}`);
      } else {
        approveCount++;
        log(`AUTO-APPROVED: ${pendingPromptText}`);
        child.stdin.write('y\n');
      }
      pendingTimer = null;
      pendingPromptText = '';
      renderStatusBar();
    }, timeout * 1000);
  }

  // Keep buffer bounded
  if (outputBuffer.length > 2000) {
    outputBuffer = outputBuffer.slice(-1000);
  }
});

// ── Stdin handling ──────────────────────────────────────────────────────────

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  const byte = chunk[0];

  // Ctrl+C — exit
  if (byte === 0x03) {
    log('Ctrl+C — exiting');
    cleanup();
    child.kill('SIGINT');
    setTimeout(() => {
      child.kill('SIGKILL');
      process.exit(130);
    }, 2000);
    return;
  }

  // Ctrl+A — approve immediately
  if (byte === 0x01 && pendingTimer) {
    clearTimeout(pendingTimer);
    clearInterval(countdownInterval);
    pendingTimer = null;
    countdownInterval = null;
    approveCount++;
    log(`MANUAL-APPROVE: ${pendingPromptText}`);
    pendingPromptText = '';
    if (!dryRun) child.stdin.write('y\n');
    renderStatusBar();
    return;
  }

  // Ctrl+D — deny immediately
  if (byte === 0x04 && pendingTimer) {
    clearTimeout(pendingTimer);
    clearInterval(countdownInterval);
    pendingTimer = null;
    countdownInterval = null;
    denyCount++;
    log(`MANUAL-DENY: ${pendingPromptText}`);
    pendingPromptText = '';
    if (!dryRun) child.stdin.write('n\n');
    renderStatusBar();
    return;
  }

  // Any other key during countdown — cancel timer, forward input
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    clearInterval(countdownInterval);
    pendingTimer = null;
    countdownInterval = null;
    manualCount++;
    log(`MANUAL: ${pendingPromptText}`);
    pendingPromptText = '';
    renderStatusBar();
  }

  // Forward to claude
  child.stdin.write(chunk);
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanup() {
  if (pendingTimer) clearTimeout(pendingTimer);
  if (countdownInterval) clearInterval(countdownInterval);
  // Clear status bar
  moveTo(rows, 1);
  clearLine();
  // Restore terminal
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch {}
  }
}

child.on('exit', (code) => {
  cleanup();
  log(`Claude exited with code ${code}`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  cleanup();
  child.kill('SIGTERM');
});

process.on('SIGHUP', () => {
  cleanup();
  child.kill('SIGHUP');
});

// Handle terminal resize
process.stdout.on('resize', () => {
  const newCols = process.stdout.columns || 80;
  const newRows = process.stdout.rows || 24;
  // Notify child of new size if possible
  try { child.kill('SIGWINCH'); } catch {}
  renderStatusBar(countdownRemaining > 0 ? countdownRemaining : null);
});

// ── Start ───────────────────────────────────────────────────────────────────

renderStatusBar();
log(`Started TUI: claude ${claudeArgs.join(' ')} (timeout=${timeout}s, deny=${denyPatterns.length} patterns, dry-run=${dryRun})`);
