/**
 * AgentChat Protocol
 * Message types and validation for agent-to-agent communication
 */

import crypto from 'crypto';
import {
  ClientMessageType as ClientMessageTypeEnum,
  ServerMessageType as ServerMessageTypeEnum,
  ErrorCode as ErrorCodeEnum,
  PresenceStatus as PresenceStatusEnum,
  ProposalStatus as ProposalStatusEnum,
  ClientMessage,
  ServerMessage,
  ValidationResult,
  Skill
} from './types.js';

// Re-export enums as const objects for backwards compatibility
export const ClientMessageType = {
  IDENTIFY: 'IDENTIFY' as const,
  JOIN: 'JOIN' as const,
  LEAVE: 'LEAVE' as const,
  MSG: 'MSG' as const,
  LIST_CHANNELS: 'LIST_CHANNELS' as const,
  LIST_AGENTS: 'LIST_AGENTS' as const,
  CREATE_CHANNEL: 'CREATE_CHANNEL' as const,
  INVITE: 'INVITE' as const,
  PING: 'PING' as const,
  // Proposal/negotiation message types
  PROPOSAL: 'PROPOSAL' as const,
  ACCEPT: 'ACCEPT' as const,
  REJECT: 'REJECT' as const,
  COMPLETE: 'COMPLETE' as const,
  DISPUTE: 'DISPUTE' as const,
  // Agentcourt dispute message types
  DISPUTE_INTENT: 'DISPUTE_INTENT' as const,
  DISPUTE_REVEAL: 'DISPUTE_REVEAL' as const,
  EVIDENCE: 'EVIDENCE' as const,
  ARBITER_ACCEPT: 'ARBITER_ACCEPT' as const,
  ARBITER_DECLINE: 'ARBITER_DECLINE' as const,
  ARBITER_VOTE: 'ARBITER_VOTE' as const,
  // Skill discovery message types
  REGISTER_SKILLS: 'REGISTER_SKILLS' as const,
  SEARCH_SKILLS: 'SEARCH_SKILLS' as const,
  // Presence message types
  SET_PRESENCE: 'SET_PRESENCE' as const,
  // Identity verification message types
  VERIFY_REQUEST: 'VERIFY_REQUEST' as const,
  VERIFY_RESPONSE: 'VERIFY_RESPONSE' as const,
  // Admin message types
  ADMIN_APPROVE: 'ADMIN_APPROVE' as const,
  ADMIN_REVOKE: 'ADMIN_REVOKE' as const,
  ADMIN_LIST: 'ADMIN_LIST' as const,
  // Challenge-response auth
  VERIFY_IDENTITY: 'VERIFY_IDENTITY' as const,
  // Nick
  SET_NICK: 'SET_NICK' as const,
  // Typing indicator
  TYPING: 'TYPING' as const,
};

export const ServerMessageType = {
  WELCOME: 'WELCOME' as const,
  MSG: 'MSG' as const,
  JOINED: 'JOINED' as const,
  LEFT: 'LEFT' as const,
  AGENT_JOINED: 'AGENT_JOINED' as const,
  AGENT_LEFT: 'AGENT_LEFT' as const,
  CHANNELS: 'CHANNELS' as const,
  AGENTS: 'AGENTS' as const,
  ERROR: 'ERROR' as const,
  PONG: 'PONG' as const,
  // Proposal/negotiation message types
  PROPOSAL: 'PROPOSAL' as const,
  ACCEPT: 'ACCEPT' as const,
  REJECT: 'REJECT' as const,
  COMPLETE: 'COMPLETE' as const,
  DISPUTE: 'DISPUTE' as const,
  // Agentcourt dispute message types
  PANEL_FORMED: 'PANEL_FORMED' as const,
  ARBITER_ASSIGNED: 'ARBITER_ASSIGNED' as const,
  EVIDENCE_RECEIVED: 'EVIDENCE_RECEIVED' as const,
  CASE_READY: 'CASE_READY' as const,
  VERDICT: 'VERDICT' as const,
  DISPUTE_FALLBACK: 'DISPUTE_FALLBACK' as const,
  DISPUTE_INTENT_ACK: 'DISPUTE_INTENT_ACK' as const,
  DISPUTE_REVEALED: 'DISPUTE_REVEALED' as const,
  // Skill discovery message types
  SKILLS_REGISTERED: 'SKILLS_REGISTERED' as const,
  SEARCH_RESULTS: 'SEARCH_RESULTS' as const,
  // Presence message types
  PRESENCE_CHANGED: 'PRESENCE_CHANGED' as const,
  // Identity verification message types
  VERIFY_REQUEST: 'VERIFY_REQUEST' as const,
  VERIFY_RESPONSE: 'VERIFY_RESPONSE' as const,
  VERIFY_SUCCESS: 'VERIFY_SUCCESS' as const,
  VERIFY_FAILED: 'VERIFY_FAILED' as const,
  // Admin response
  ADMIN_RESULT: 'ADMIN_RESULT' as const,
  // Challenge-response auth
  CHALLENGE: 'CHALLENGE' as const,
  // Nick
  NICK_CHANGED: 'NICK_CHANGED' as const,
  // Typing indicator
  TYPING: 'TYPING' as const,
  // Session conflict
  SESSION_DISPLACED: 'SESSION_DISPLACED' as const,
  // Dispute settlement
  SETTLEMENT_COMPLETE: 'SETTLEMENT_COMPLETE' as const,
};

export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED' as const,
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND' as const,
  NOT_INVITED: 'NOT_INVITED' as const,
  INVALID_MSG: 'INVALID_MSG' as const,
  RATE_LIMITED: 'RATE_LIMITED' as const,
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND' as const,
  CHANNEL_EXISTS: 'CHANNEL_EXISTS' as const,
  INVALID_NAME: 'INVALID_NAME' as const,
  // Proposal errors
  PROPOSAL_NOT_FOUND: 'PROPOSAL_NOT_FOUND' as const,
  PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED' as const,
  INVALID_PROPOSAL: 'INVALID_PROPOSAL' as const,
  SIGNATURE_REQUIRED: 'SIGNATURE_REQUIRED' as const,
  NOT_PROPOSAL_PARTY: 'NOT_PROPOSAL_PARTY' as const,
  // Staking errors
  INSUFFICIENT_REPUTATION: 'INSUFFICIENT_REPUTATION' as const,
  INVALID_STAKE: 'INVALID_STAKE' as const,
  // Verification errors
  VERIFICATION_FAILED: 'VERIFICATION_FAILED' as const,
  VERIFICATION_EXPIRED: 'VERIFICATION_EXPIRED' as const,
  NO_PUBKEY: 'NO_PUBKEY' as const,
  // Allowlist errors
  NOT_ALLOWED: 'NOT_ALLOWED' as const,
  // Agentcourt errors
  DISPUTE_NOT_FOUND: 'DISPUTE_NOT_FOUND' as const,
  DISPUTE_INVALID_PHASE: 'DISPUTE_INVALID_PHASE' as const,
  DISPUTE_COMMITMENT_MISMATCH: 'DISPUTE_COMMITMENT_MISMATCH' as const,
  DISPUTE_NOT_PARTY: 'DISPUTE_NOT_PARTY' as const,
  DISPUTE_NOT_ARBITER: 'DISPUTE_NOT_ARBITER' as const,
  DISPUTE_DEADLINE_PASSED: 'DISPUTE_DEADLINE_PASSED' as const,
  DISPUTE_ALREADY_EXISTS: 'DISPUTE_ALREADY_EXISTS' as const,
  INSUFFICIENT_ARBITERS: 'INSUFFICIENT_ARBITERS' as const,
};

export const PresenceStatus = {
  ONLINE: 'online' as const,
  AWAY: 'away' as const,
  BUSY: 'busy' as const,
  OFFLINE: 'offline' as const,
  LISTENING: 'listening' as const
};

export const ProposalStatus = {
  PENDING: 'pending' as const,
  ACCEPTED: 'accepted' as const,
  REJECTED: 'rejected' as const,
  COMPLETED: 'completed' as const,
  DISPUTED: 'disputed' as const,
  EXPIRED: 'expired' as const
};

/**
 * Check if a target is a channel (#name) or agent (@name)
 */
export function isChannel(target: string): boolean {
  return Boolean(target && target.startsWith('#'));
}

export function isAgent(target: string): boolean {
  return Boolean(target && target.startsWith('@'));
}

/**
 * Validate agent name
 * - 1-32 characters
 * - alphanumeric, dash, underscore
 * - no spaces
 */
export function isValidName(name: unknown): boolean {
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
export function isValidChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== 'string') return false;
  if (!channel.startsWith('#')) return false;
  const name = channel.slice(1);
  if (name.length < 1 || name.length > 31) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Validate Ed25519 public key in PEM format
 */
export function isValidPubkey(pubkey: unknown): boolean {
  if (!pubkey || typeof pubkey !== 'string') return false;

  try {
    const keyObj = crypto.createPublicKey(pubkey);
    return keyObj.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/**
 * Generate stable agent ID from pubkey
 * Returns first 8 chars of SHA256 hash (hex)
 */
export function pubkeyToAgentId(pubkey: string): string {
  const hash = crypto.createHash('sha256').update(pubkey).digest('hex');
  return hash.substring(0, 8);
}

interface MessageData {
  [key: string]: unknown;
}

/**
 * Create a message object with timestamp
 */
export function createMessage<T extends MessageData>(type: string, data: T = {} as T): T & { type: string; ts: number } {
  return {
    type,
    ts: Date.now(),
    ...data
  };
}

/**
 * Create an error message
 */
export function createError(code: string, message: string): { type: string; ts: number; code: string; message: string } {
  return createMessage(ServerMessageType.ERROR, { code, message });
}

interface RawClientMessage {
  type?: string;
  name?: string;
  pubkey?: string | null;
  channel?: string;
  to?: string;
  content?: string;
  sig?: string;
  agent?: string;
  proposal_id?: string;
  task?: string;
  amount?: number;
  currency?: string;
  expires?: number;
  terms?: string;
  elo_stake?: number;
  proof?: string;
  reason?: string;
  skills?: Skill[];
  query?: Record<string, unknown>;
  query_id?: string;
  status?: string;
  status_text?: string;
  target?: string;
  nonce?: string;
  request_id?: string;
  admin_key?: string;
  note?: string;
  agent_id?: string;
  challenge_id?: string;
  signature?: string;
  timestamp?: number;
  nick?: string;
  // Agentcourt dispute fields
  commitment?: string;
  dispute_id?: string;
  items?: unknown[];
  statement?: string;
  verdict?: string;
  reasoning?: string;
}

/**
 * Validate incoming client message
 * Returns { valid: true, msg } or { valid: false, error }
 */
export function validateClientMessage(raw: string | RawClientMessage): ValidationResult {
  let msg: RawClientMessage;

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
      // Validate pubkey if provided
      if (msg.pubkey !== undefined && msg.pubkey !== null) {
        if (!isValidPubkey(msg.pubkey)) {
          return { valid: false, error: 'Invalid public key format (must be Ed25519 PEM)' };
        }
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
      // Validate signature format if present
      if (msg.sig !== undefined && typeof msg.sig !== 'string') {
        return { valid: false, error: 'Invalid signature format' };
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

    case ClientMessageType.PROPOSAL:
      // Proposals require: to, task, and signature
      if (!msg.to) {
        return { valid: false, error: 'Missing target (to)' };
      }
      if (!isAgent(msg.to)) {
        return { valid: false, error: 'Proposals must be sent to an agent (@id)' };
      }
      if (!msg.task || typeof msg.task !== 'string') {
        return { valid: false, error: 'Missing or invalid task description' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Proposals must be signed' };
      }
      // Optional fields: amount, currency, payment_code, expires, terms, elo_stake
      if (msg.expires !== undefined && typeof msg.expires !== 'number') {
        return { valid: false, error: 'expires must be a number (seconds)' };
      }
      if (msg.elo_stake !== undefined && msg.elo_stake !== null) {
        if (typeof msg.elo_stake !== 'number' || msg.elo_stake < 0 || !Number.isInteger(msg.elo_stake)) {
          return { valid: false, error: 'elo_stake must be a non-negative integer' };
        }
      }
      break;

    case ClientMessageType.ACCEPT:
      // Accept requires: proposal_id and signature
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Accept must be signed' };
      }
      // Optional: elo_stake for acceptor's stake
      if (msg.elo_stake !== undefined && msg.elo_stake !== null) {
        if (typeof msg.elo_stake !== 'number' || msg.elo_stake < 0 || !Number.isInteger(msg.elo_stake)) {
          return { valid: false, error: 'elo_stake must be a non-negative integer' };
        }
      }
      break;

    case ClientMessageType.REJECT:
      // Reject requires: proposal_id and signature
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Reject must be signed' };
      }
      break;

    case ClientMessageType.COMPLETE:
      // Complete requires: proposal_id, signature, and optionally proof
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Complete must be signed' };
      }
      break;

    case ClientMessageType.DISPUTE:
      // Dispute requires: proposal_id, reason, and signature
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.reason || typeof msg.reason !== 'string') {
        return { valid: false, error: 'Missing or invalid dispute reason' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Dispute must be signed' };
      }
      break;

    case ClientMessageType.REGISTER_SKILLS:
      // Register skills requires: skills array and signature
      if (!msg.skills || !Array.isArray(msg.skills)) {
        return { valid: false, error: 'Missing or invalid skills array' };
      }
      if (msg.skills.length === 0) {
        return { valid: false, error: 'Skills array cannot be empty' };
      }
      // Validate each skill has at least a capability
      for (const skill of msg.skills) {
        if (!skill.capability || typeof skill.capability !== 'string') {
          return { valid: false, error: 'Each skill must have a capability string' };
        }
      }
      if (!msg.sig) {
        return { valid: false, error: 'Skill registration must be signed' };
      }
      break;

    case ClientMessageType.SEARCH_SKILLS:
      // Search skills requires: query object
      if (!msg.query || typeof msg.query !== 'object') {
        return { valid: false, error: 'Missing or invalid query object' };
      }
      // query_id is optional but useful for tracking responses
      break;

    case ClientMessageType.SET_PRESENCE:
      // Set presence requires: status (online, away, busy, offline)
      const validStatuses = ['online', 'away', 'busy', 'offline', 'listening'];
      if (!msg.status || !validStatuses.includes(msg.status)) {
        return { valid: false, error: `Invalid presence status. Must be one of: ${validStatuses.join(', ')}` };
      }
      // Optional: status_text for custom message
      if (msg.status_text !== undefined && typeof msg.status_text !== 'string') {
        return { valid: false, error: 'status_text must be a string' };
      }
      if (msg.status_text && msg.status_text.length > 100) {
        return { valid: false, error: 'status_text too long (max 100 chars)' };
      }
      break;

    case ClientMessageType.VERIFY_REQUEST:
      // Verify request requires: target agent and nonce
      if (!msg.target) {
        return { valid: false, error: 'Missing target agent' };
      }
      if (!isAgent(msg.target)) {
        return { valid: false, error: 'Target must be an agent (@id)' };
      }
      if (!msg.nonce || typeof msg.nonce !== 'string') {
        return { valid: false, error: 'Missing or invalid nonce' };
      }
      if (msg.nonce.length < 16 || msg.nonce.length > 128) {
        return { valid: false, error: 'Nonce must be 16-128 characters' };
      }
      break;

    case ClientMessageType.VERIFY_RESPONSE:
      // Verify response requires: request_id, nonce, and signature
      if (!msg.request_id) {
        return { valid: false, error: 'Missing request_id' };
      }
      if (!msg.nonce || typeof msg.nonce !== 'string') {
        return { valid: false, error: 'Missing or invalid nonce' };
      }
      if (!msg.sig || typeof msg.sig !== 'string') {
        return { valid: false, error: 'Missing or invalid signature' };
      }
      break;

    case ClientMessageType.ADMIN_APPROVE:
      if (!msg.pubkey || typeof msg.pubkey !== 'string') {
        return { valid: false, error: 'Missing or invalid pubkey' };
      }
      if (!msg.admin_key || typeof msg.admin_key !== 'string') {
        return { valid: false, error: 'Missing admin_key' };
      }
      break;

    case ClientMessageType.ADMIN_REVOKE:
      if (!msg.pubkey && !msg.agent_id) {
        return { valid: false, error: 'Missing pubkey or agent_id' };
      }
      if (!msg.admin_key || typeof msg.admin_key !== 'string') {
        return { valid: false, error: 'Missing admin_key' };
      }
      break;

    case ClientMessageType.ADMIN_LIST:
      if (!msg.admin_key || typeof msg.admin_key !== 'string') {
        return { valid: false, error: 'Missing admin_key' };
      }
      break;

    // Agentcourt dispute message types
    case ClientMessageType.DISPUTE_INTENT:
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.reason || typeof msg.reason !== 'string') {
        return { valid: false, error: 'Missing or invalid reason' };
      }
      if (!msg.commitment || typeof msg.commitment !== 'string') {
        return { valid: false, error: 'Missing or invalid commitment hash' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Dispute intent must be signed' };
      }
      break;

    case ClientMessageType.DISPUTE_REVEAL:
      if (!msg.proposal_id) {
        return { valid: false, error: 'Missing proposal_id' };
      }
      if (!msg.nonce || typeof msg.nonce !== 'string') {
        return { valid: false, error: 'Missing or invalid nonce' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Dispute reveal must be signed' };
      }
      break;

    case ClientMessageType.EVIDENCE:
      if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
        return { valid: false, error: 'Missing or invalid dispute_id' };
      }
      if (!msg.items || !Array.isArray(msg.items)) {
        return { valid: false, error: 'Missing or invalid items array' };
      }
      if (typeof msg.statement !== 'string') {
        return { valid: false, error: 'Missing or invalid statement' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Evidence must be signed' };
      }
      break;

    case ClientMessageType.ARBITER_ACCEPT:
      if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
        return { valid: false, error: 'Missing or invalid dispute_id' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Arbiter accept must be signed' };
      }
      break;

    case ClientMessageType.ARBITER_DECLINE:
      if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
        return { valid: false, error: 'Missing or invalid dispute_id' };
      }
      break;

    case ClientMessageType.ARBITER_VOTE:
      if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
        return { valid: false, error: 'Missing or invalid dispute_id' };
      }
      if (!msg.verdict || !['disputant', 'respondent', 'mutual'].includes(msg.verdict)) {
        return { valid: false, error: 'Invalid verdict (must be disputant, respondent, or mutual)' };
      }
      if (typeof msg.reasoning !== 'string') {
        return { valid: false, error: 'Missing or invalid reasoning' };
      }
      if (!msg.sig) {
        return { valid: false, error: 'Arbiter vote must be signed' };
      }
      break;

    case ClientMessageType.SET_NICK:
      if (!msg.nick || typeof msg.nick !== 'string') {
        return { valid: false, error: 'Missing or invalid nick' };
      }
      if (msg.nick.length < 1 || msg.nick.length > 24) {
        return { valid: false, error: 'Nick must be 1-24 characters' };
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(msg.nick)) {
        return { valid: false, error: 'Nick must contain only alphanumeric characters, hyphens, and underscores' };
      }
      break;

    case ClientMessageType.TYPING:
      if (!isValidChannel(msg.channel)) {
        return { valid: false, error: 'Invalid channel name' };
      }
      break;

    case ClientMessageType.VERIFY_IDENTITY:
      if (!msg.challenge_id || typeof msg.challenge_id !== 'string') {
        return { valid: false, error: 'Missing or invalid challenge_id' };
      }
      if (!msg.signature || typeof msg.signature !== 'string') {
        return { valid: false, error: 'Missing or invalid signature' };
      }
      if (!msg.timestamp || typeof msg.timestamp !== 'number') {
        return { valid: false, error: 'Missing or invalid timestamp' };
      }
      break;

    default:
      return { valid: false, error: `Unknown message type: ${msg.type}` };
  }

  return { valid: true, msg: msg as unknown as ClientMessage };
}

/**
 * Generate a unique agent ID
 */
export function generateAgentId(): string {
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
export function serialize(msg: unknown): string {
  return JSON.stringify(msg);
}

/**
 * Parse message from WebSocket
 */
export function parse<T = unknown>(data: string): T {
  return JSON.parse(data);
}

/**
 * Generate a unique proposal ID
 * Format: prop_<timestamp>_<random>
 */
export function generateProposalId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `prop_${timestamp}_${random}`;
}

/**
 * Check if a message type is an agentcourt dispute type
 */
export function isDisputeMessage(type: string): boolean {
  const disputeTypes: string[] = [
    ClientMessageType.DISPUTE_INTENT,
    ClientMessageType.DISPUTE_REVEAL,
    ClientMessageType.EVIDENCE,
    ClientMessageType.ARBITER_ACCEPT,
    ClientMessageType.ARBITER_DECLINE,
    ClientMessageType.ARBITER_VOTE,
  ];
  return disputeTypes.includes(type);
}

/**
 * Check if a message type is a proposal-related type
 */
export function isProposalMessage(type: string): boolean {
  const proposalTypes: string[] = [
    ClientMessageType.PROPOSAL,
    ClientMessageType.ACCEPT,
    ClientMessageType.REJECT,
    ClientMessageType.COMPLETE,
    ClientMessageType.DISPUTE
  ];
  return proposalTypes.includes(type);
}

/**
 * Generate a unique verification request ID
 * Format: verify_<timestamp>_<random>
 */
export function generateVerifyId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `verify_${timestamp}_${random}`;
}

/**
 * Generate a random nonce for identity verification
 * Returns a 32-character hex string
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a unique challenge ID
 * Format: chal_<timestamp36>_<random>
 */
export function generateChallengeId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `chal_${timestamp}_${random}`;
}

/**
 * Generate the canonical signing content for challenge-response auth.
 * Client signs this to prove private key ownership.
 */
export function generateAuthSigningContent(nonce: string, challengeId: string, timestamp: number): string {
  return `AGENTCHAT_AUTH|${nonce}|${challengeId}|${timestamp}`;
}
