/**
 * AgentChat Protocol
 * Message types and validation for agent-to-agent communication
 */

// Client -> Server message types
export const ClientMessageType = {
  IDENTIFY: 'IDENTIFY',
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  MSG: 'MSG',
  LIST_CHANNELS: 'LIST_CHANNELS',
  LIST_AGENTS: 'LIST_AGENTS',
  CREATE_CHANNEL: 'CREATE_CHANNEL',
  INVITE: 'INVITE',
  PING: 'PING'
};

// Server -> Client message types
export const ServerMessageType = {
  WELCOME: 'WELCOME',
  MSG: 'MSG',
  JOINED: 'JOINED',
  LEFT: 'LEFT',
  AGENT_JOINED: 'AGENT_JOINED',
  AGENT_LEFT: 'AGENT_LEFT',
  CHANNELS: 'CHANNELS',
  AGENTS: 'AGENTS',
  ERROR: 'ERROR',
  PONG: 'PONG'
};

// Error codes
export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  NOT_INVITED: 'NOT_INVITED',
  INVALID_MSG: 'INVALID_MSG',
  RATE_LIMITED: 'RATE_LIMITED',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  CHANNEL_EXISTS: 'CHANNEL_EXISTS',
  INVALID_NAME: 'INVALID_NAME'
};

/**
 * Check if a target is a channel (#name) or agent (@name)
 */
export function isChannel(target) {
  return target && target.startsWith('#');
}

export function isAgent(target) {
  return target && target.startsWith('@');
}

/**
 * Validate agent name
 * - 1-32 characters
 * - alphanumeric, dash, underscore
 * - no spaces
 */
export function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Validate channel name
 * - starts with #
 * - 2-32 characters total
 * - alphanumeric, dash, underscore after #
 */
export function isValidChannel(channel) {
  if (!channel || typeof channel !== 'string') return false;
  if (!channel.startsWith('#')) return false;
  const name = channel.slice(1);
  if (name.length < 1 || name.length > 31) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Create a message object with timestamp
 */
export function createMessage(type, data = {}) {
  return {
    type,
    ts: Date.now(),
    ...data
  };
}

/**
 * Create an error message
 */
export function createError(code, message) {
  return createMessage(ServerMessageType.ERROR, { code, message });
}

/**
 * Validate incoming client message
 * Returns { valid: true, msg } or { valid: false, error }
 */
export function validateClientMessage(raw) {
  let msg;
  
  // Parse JSON
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { valid: false, error: 'Invalid JSON' };
  }
  
  // Must have type
  if (!msg.type) {
    return { valid: false, error: 'Missing message type' };
  }
  
  // Validate by type
  switch (msg.type) {
    case ClientMessageType.IDENTIFY:
      if (!isValidName(msg.name)) {
        return { valid: false, error: 'Invalid agent name' };
      }
      break;
      
    case ClientMessageType.JOIN:
    case ClientMessageType.LEAVE:
    case ClientMessageType.LIST_AGENTS:
      if (!isValidChannel(msg.channel)) {
        return { valid: false, error: 'Invalid channel name' };
      }
      break;
      
    case ClientMessageType.MSG:
      if (!msg.to) {
        return { valid: false, error: 'Missing target' };
      }
      if (!isChannel(msg.to) && !isAgent(msg.to)) {
        return { valid: false, error: 'Invalid target (must start with # or @)' };
      }
      if (typeof msg.content !== 'string') {
        return { valid: false, error: 'Missing or invalid content' };
      }
      if (msg.content.length > 4096) {
        return { valid: false, error: 'Content too long (max 4096 chars)' };
      }
      break;
      
    case ClientMessageType.CREATE_CHANNEL:
      if (!isValidChannel(msg.channel)) {
        return { valid: false, error: 'Invalid channel name' };
      }
      break;
      
    case ClientMessageType.INVITE:
      if (!isValidChannel(msg.channel)) {
        return { valid: false, error: 'Invalid channel name' };
      }
      if (!msg.agent || !isAgent(msg.agent)) {
        return { valid: false, error: 'Invalid agent target' };
      }
      break;
      
    case ClientMessageType.LIST_CHANNELS:
    case ClientMessageType.PING:
      // No additional validation needed
      break;
      
    default:
      return { valid: false, error: `Unknown message type: ${msg.type}` };
  }
  
  return { valid: true, msg };
}

/**
 * Generate a unique agent ID
 */
export function generateAgentId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Serialize message for sending over WebSocket
 */
export function serialize(msg) {
  return JSON.stringify(msg);
}

/**
 * Parse message from WebSocket
 */
export function parse(data) {
  return JSON.parse(data);
}
