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

// Message buffer - captures messages between listen() calls
const MAX_BUFFER_SIZE = 200;
let messageBuffer = [];

// Default server
export const DEFAULT_SERVER_URL = process.env.AGENTCHAT_URL
  || (process.env.AGENTCHAT_PUBLIC === 'true' ? 'wss://agentchat-server.fly.dev' : 'ws://localhost:6667');

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
 * Push a message into the buffer (called by persistent handler on client)
 */
export function bufferMessage(msg) {
  messageBuffer.push(msg);
  if (messageBuffer.length > MAX_BUFFER_SIZE) {
    messageBuffer = messageBuffer.slice(-MAX_BUFFER_SIZE);
  }
}

/**
 * Drain all buffered messages and clear the buffer
 */
export function drainMessageBuffer() {
  const messages = messageBuffer;
  messageBuffer = [];
  return messages;
}

/**
 * Clear the message buffer (e.g., on reconnect)
 */
export function clearMessageBuffer() {
  messageBuffer = [];
}
