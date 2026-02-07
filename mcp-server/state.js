/**
 * Shared MCP Server State
 * Centralized state management for the AgentChat MCP server
 */

// Connection state
export let client = null;
export let daemon = null;
export let serverUrl = null;
export let keepaliveInterval = null;

// Message tracking - timestamp of last message we returned to the caller
export let lastSeenTimestamp = 0;

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
 */
export function updateLastSeen(ts) {
  if (ts && ts > lastSeenTimestamp) {
    lastSeenTimestamp = ts;
  }
}

/**
 * Reset the last seen timestamp (e.g., on new connection)
 */
export function resetLastSeen() {
  lastSeenTimestamp = 0;
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
