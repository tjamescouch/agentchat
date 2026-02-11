#!/usr/bin/env node

/**
 * claude-deadman — Dead man's switch wrapper for Claude Code
 *
 * Runs `claude` in interactive mode, watches for permission prompts,
 * and auto-approves after a configurable timeout if no human intervenes.
 *
 * Usage:
 *   node claude-deadman.mjs [--timeout 120] [--deny <pattern>] [--log <path>] [--dry-run] -- [claude args...]
 *
 * Spec: Sophia (agentchat #general)
 * Build: BobTheBuilder
 */

import { spawn } from 'node:child_process';
import { createWriteStream, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

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
      i = args.length; // break out
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

// Claude Code permission prompts contain patterns like:
//   "Allow <tool>?" or "[Y/n]" or "Do you want to allow"
const PROMPT_PATTERNS = [
  /\[Y\/n\]/,
  /Allow .+\?/i,
  /Do you want to (allow|proceed)/i,
  /\(y\/n\)/i,
];

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function isPrompt(text) {
  return PROMPT_PATTERNS.some(p => p.test(stripAnsi(text)));
}

function matchesDenyList(text) {
  return denyPatterns.some(p => p.test(stripAnsi(text)));
}

// ── Main ────────────────────────────────────────────────────────────────────

const child = spawn('claude', claudeArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' },
});

let pendingTimer = null;
let pendingPromptText = '';
let countdownInterval = null;
let countdownRemaining = 0;

// Forward stderr directly
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

// Watch stdout for prompts
let outputBuffer = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(chunk); // always pass through

  outputBuffer += text;

  // Check recent output for prompt patterns
  // Use last ~500 chars to catch multi-chunk prompts
  const window = outputBuffer.slice(-500);

  if (isPrompt(window) && !pendingTimer) {
    pendingPromptText = window.trim().split('\n').pop() || window.trim();

    if (matchesDenyList(pendingPromptText)) {
      process.stderr.write(`\n\x1b[33m[deadman] ⛔ Matches deny pattern — waiting for manual input\x1b[0m\n`);
      log(`DENY-MATCH: ${pendingPromptText}`);
      return;
    }

    countdownRemaining = timeout;
    process.stderr.write(`\n\x1b[36m[deadman] auto-approve in ${countdownRemaining}s — press any key to decide\x1b[0m`);

    countdownInterval = setInterval(() => {
      countdownRemaining--;
      if (countdownRemaining > 0 && countdownRemaining % 10 === 0) {
        process.stderr.write(`\r\x1b[36m[deadman] auto-approve in ${countdownRemaining}s — press any key to decide\x1b[0m`);
      }
    }, 1000);

    pendingTimer = setTimeout(() => {
      clearInterval(countdownInterval);
      countdownInterval = null;

      if (dryRun) {
        process.stderr.write(`\r\x1b[33m[deadman] DRY-RUN: would auto-approve: ${pendingPromptText}\x1b[0m\n`);
        log(`DRY-RUN: ${pendingPromptText}`);
      } else {
        process.stderr.write(`\r\x1b[32m[deadman] auto-approved ✓\x1b[0m\n`);
        log(`AUTO-APPROVED: ${pendingPromptText}`);
        child.stdin.write('y\n');
      }
      pendingTimer = null;
      pendingPromptText = '';
    }, timeout * 1000);
  }

  // Keep buffer from growing unbounded
  if (outputBuffer.length > 2000) {
    outputBuffer = outputBuffer.slice(-1000);
  }
});

// Forward stdin, but intercept during countdown
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  if (pendingTimer) {
    // Human intervened — cancel the auto-approve
    clearTimeout(pendingTimer);
    clearInterval(countdownInterval);
    pendingTimer = null;
    countdownInterval = null;

    process.stderr.write(`\r\x1b[33m[deadman] timer cancelled — your input forwarded\x1b[0m\n`);
    log(`MANUAL: ${pendingPromptText}`);
    pendingPromptText = '';
  }
  // Always forward input to claude
  child.stdin.write(chunk);
});

// Cleanup
child.on('exit', (code) => {
  if (pendingTimer) clearTimeout(pendingTimer);
  if (countdownInterval) clearInterval(countdownInterval);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

log(`Started: claude ${claudeArgs.join(' ')} (timeout=${timeout}s, deny=${denyPatterns.length} patterns, dry-run=${dryRun})`);
