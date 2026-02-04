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

// Default server
export const DEFAULT_SERVER_URL = 'wss://agentchat-server.fly.dev';

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
