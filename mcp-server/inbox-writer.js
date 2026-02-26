/**
 * Inbox Writer — shared utility for appending messages to the daemon inbox.
 *
 * Both the daemon process and the MCP direct-connection handler write to the
 * same inbox.jsonl so that listen always has a single source of truth.
 *
 * Uses a per-instance async mutex to prevent the truncate-while-appending race
 * condition (P2-LISTEN-6). Truncation uses temp file + rename for POSIX atomicity.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';

const MAX_INBOX_LINES = 1000;

// Throttle truncation: at most once per 5 seconds per instance
const lastTruncateTime = new Map();
const TRUNCATE_THROTTLE_MS = 5000;

// ── Per-instance async mutex ────────────────────────────────────────────
// Simple promise-chain lock. No external deps needed.
const locks = new Map();

function withLock(instance, fn) {
  const prev = locks.get(instance) || Promise.resolve();
  const next = prev.then(fn, fn); // always run fn, even if prev rejected
  locks.set(instance, next.catch(() => {})); // swallow to keep chain clean
  return next;
}

/**
 * Ensure the daemon instance directory exists (lazy creation).
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Truncate the inbox to MAX_INBOX_LINES, throttled.
 * MUST be called inside withLock to avoid race with appendFile.
 * Uses temp file + rename for atomic replacement.
 */
async function truncateIfNeeded(inboxPath, instance) {
  const now = Date.now();
  const last = lastTruncateTime.get(instance) || 0;
  if (now - last < TRUNCATE_THROTTLE_MS) return;
  lastTruncateTime.set(instance, now);

  try {
    const content = await fsp.readFile(inboxPath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length > MAX_INBOX_LINES) {
      const trimmed = lines.slice(-MAX_INBOX_LINES);
      const tmpPath = inboxPath + '.tmp.' + process.pid;
      await fsp.writeFile(tmpPath, trimmed.join('\n') + '\n');
      await fsp.rename(tmpPath, inboxPath);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Non-critical — log but don't throw
      console.error(`inbox-writer: truncation failed: ${err.message}`);
    }
  }
}

/**
 * Append a message object to inbox.jsonl and touch the newdata semaphore.
 *
 * @param {object} msg  Message object (will be JSON-serialized as one line)
 * @param {string} [instance='default']  Daemon instance name
 */
export async function appendToInbox(msg, instance = 'default') {
  const paths = getDaemonPaths(instance);
  ensureDir(paths.dir);

  const line = JSON.stringify(msg) + '\n';

  await withLock(instance, async () => {
    await fsp.appendFile(paths.inbox, line);

    // Throttled truncation — inside lock so no concurrent append can interleave
    await truncateIfNeeded(paths.inbox, instance);
  });

  // Touch semaphore so listen's fs.watch fires (outside lock — non-critical)
  await fsp.writeFile(paths.newdata, Date.now().toString());
}
