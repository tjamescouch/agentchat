/**
 * Shared MCP Server State
 * Centralized state management for the AgentChat MCP server
 */

import fs from 'fs';
import path from 'path';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';

// Connection state
export let client = null;
export let daemon = null;
export let serverUrl = null;
export let keepaliveInterval = null;

// Message tracking - timestamp of last message we returned to the caller
// Persisted to disk so it survives reconnections (P2-LISTEN-5 fix)
const LAST_SEEN_FILE = path.join(getDaemonPaths('default').dir, 'last_seen_ts');

function loadLastSeen() {
  try {
    const val = parseInt(fs.readFileSync(LAST_SEEN_FILE, 'utf-8').trim(), 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

function persistLastSeen(ts) {
  try {
    const dir = path.dirname(LAST_SEEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_SEEN_FILE, String(ts));
  } catch {
    // Best effort
  }
}

export let lastSeenTimestamp = loadLastSeen();

// Exponential backoff - tracks consecutive idle nudges
let consecutiveIdleCount = 0;

// Default server
export const DEFAULT_SERVER_URL = (() => {
  const explicit = process.env.AGENTCHAT_URL;
  if (explicit) {
    const parsed = new URL(explicit);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    if (!isLocal && process.env.AGENTCHAT_PUBLIC !== 'true') {
      console.error(`ERROR: AGENTCHAT_URL points to remote host "${parsed.hostname}" but AGENTCHAT_PUBLIC is not set.`);
      console.error('Set AGENTCHAT_PUBLIC=true to allow connections to non-localhost servers.');
      process.exit(1);
    }
    return explicit;
  }
  return process.env.AGENTCHAT_PUBLIC === 'true' ? 'wss://agentchat-server.fly.dev' : 'ws://localhost:6667';
})();

// Keepalive settings
export const KEEPALIVE_INTERVAL_MS = 30000;
export const PONG_STALE_MS = 90000; // 3 missed pings = dead
export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 1000;

// Connection health tracking (P1-LISTEN-1)
export let lastPongTime = Date.now();
export let connectionOptions = null; // { server, name, identity } for reconnect
export let joinedChannels = new Set();
let _reconnecting = false;

/**
 * Set the active client connection
 */
export function setClient(c) {
  client = c;
}

/**
 * Set the daemon instance
 */
export function setDaemon(d) {
  daemon = d;
}

/**
 * Set the server URL
 */
export function setServerUrl(url) {
  serverUrl = url;
}

/**
 * Set the keepalive interval
 */
export function setKeepaliveInterval(interval) {
  keepaliveInterval = interval;
}

/**
 * Update the last seen timestamp
 * Only updates if the new timestamp is greater than current
 * Persists to disk so it survives reconnections (P2-LISTEN-5)
 */
export function updateLastSeen(ts) {
  if (ts && ts > lastSeenTimestamp) {
    lastSeenTimestamp = ts;
    persistLastSeen(ts);
  }
}

/**
 * Reset the last seen timestamp on new connection.
 * No longer wipes to 0 — preserves disk-persisted value to avoid
 * duplicate processing on reconnect (P2-LISTEN-5 fix).
 */
export function resetLastSeen() {
  // Intentional no-op — lastSeenTimestamp persists across reconnections.
  // To force a full re-read, manually delete the last_seen_ts file.
}

/**
 * Get the current last seen timestamp
 */
export function getLastSeen() {
  return lastSeenTimestamp;
}

/**
 * Increment the idle counter (called on nudge/timeout with no messages)
 * Returns the new count.
 */
export function incrementIdleCount() {
  consecutiveIdleCount++;
  return consecutiveIdleCount;
}

/**
 * Reset the idle counter (called when a real message arrives)
 */
export function resetIdleCount() {
  consecutiveIdleCount = 0;
}

/**
 * Get the current idle count
 */
export function getIdleCount() {
  return consecutiveIdleCount;
}

// ============ Connection Health (P1-LISTEN-1) ============

/**
 * Record a pong received from server
 */
export function recordPong() {
  lastPongTime = Date.now();
}

/**
 * Check if connection appears healthy (received pong recently)
 */
export function isConnectionHealthy() {
  return (Date.now() - lastPongTime) < PONG_STALE_MS;
}

/**
 * Save connection options for auto-reconnect
 */
export function setConnectionOptions(opts) {
  connectionOptions = opts;
}

/**
 * Track a joined channel (for rejoin on reconnect)
 */
export function trackChannel(channel) {
  joinedChannels.add(channel);
}

/**
 * Get reconnecting flag
 */
export function isReconnecting() {
  return _reconnecting;
}

/**
 * Set reconnecting flag (prevents concurrent reconnects)
 */
export function setReconnecting(val) {
  _reconnecting = val;
}
