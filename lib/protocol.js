"use strict";
/**
 * AgentChat Protocol
 * Message types and validation for agent-to-agent communication
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalStatus = exports.PresenceStatus = exports.ErrorCode = exports.ServerMessageType = exports.ClientMessageType = void 0;
exports.isChannel = isChannel;
exports.isAgent = isAgent;
exports.isValidName = isValidName;
exports.isValidChannel = isValidChannel;
exports.isValidPubkey = isValidPubkey;
exports.pubkeyToAgentId = pubkeyToAgentId;
exports.createMessage = createMessage;
exports.createError = createError;
exports.validateClientMessage = validateClientMessage;
exports.generateAgentId = generateAgentId;
exports.serialize = serialize;
exports.parse = parse;
exports.generateProposalId = generateProposalId;
exports.isDisputeMessage = isDisputeMessage;
exports.isProposalMessage = isProposalMessage;
exports.generateVerifyId = generateVerifyId;
exports.generateNonce = generateNonce;
exports.generateChallengeId = generateChallengeId;
exports.generateAuthSigningContent = generateAuthSigningContent;
var crypto_1 = require("crypto");
// Re-export enums as const objects for backwards compatibility
exports.ClientMessageType = {
    IDENTIFY: 'IDENTIFY',
    JOIN: 'JOIN',
    LEAVE: 'LEAVE',
    MSG: 'MSG',
    LIST_CHANNELS: 'LIST_CHANNELS',
    LIST_AGENTS: 'LIST_AGENTS',
    CREATE_CHANNEL: 'CREATE_CHANNEL',
    INVITE: 'INVITE',
    PING: 'PING',
    // Proposal/negotiation message types
    PROPOSAL: 'PROPOSAL',
    ACCEPT: 'ACCEPT',
    REJECT: 'REJECT',
    COMPLETE: 'COMPLETE',
    DISPUTE: 'DISPUTE',
    // Agentcourt dispute message types
    DISPUTE_INTENT: 'DISPUTE_INTENT',
    DISPUTE_REVEAL: 'DISPUTE_REVEAL',
    EVIDENCE: 'EVIDENCE',
    ARBITER_ACCEPT: 'ARBITER_ACCEPT',
    ARBITER_DECLINE: 'ARBITER_DECLINE',
    ARBITER_VOTE: 'ARBITER_VOTE',
    // Skill discovery message types
    REGISTER_SKILLS: 'REGISTER_SKILLS',
    SEARCH_SKILLS: 'SEARCH_SKILLS',
    // Presence message types
    SET_PRESENCE: 'SET_PRESENCE',
    // Identity verification message types
    VERIFY_REQUEST: 'VERIFY_REQUEST',
    VERIFY_RESPONSE: 'VERIFY_RESPONSE',
    // Admin message types
    ADMIN_APPROVE: 'ADMIN_APPROVE',
    ADMIN_REVOKE: 'ADMIN_REVOKE',
    ADMIN_LIST: 'ADMIN_LIST',
    // Challenge-response auth
    VERIFY_IDENTITY: 'VERIFY_IDENTITY',
    // Nick
    SET_NICK: 'SET_NICK',
    // Typing indicator
    TYPING: 'TYPING',
};
exports.ServerMessageType = {
    WELCOME: 'WELCOME',
    MSG: 'MSG',
    JOINED: 'JOINED',
    LEFT: 'LEFT',
    AGENT_JOINED: 'AGENT_JOINED',
    AGENT_LEFT: 'AGENT_LEFT',
    CHANNELS: 'CHANNELS',
    AGENTS: 'AGENTS',
    ERROR: 'ERROR',
    PONG: 'PONG',
    // Proposal/negotiation message types
    PROPOSAL: 'PROPOSAL',
    ACCEPT: 'ACCEPT',
    REJECT: 'REJECT',
    COMPLETE: 'COMPLETE',
    DISPUTE: 'DISPUTE',
    // Agentcourt dispute message types
    PANEL_FORMED: 'PANEL_FORMED',
    ARBITER_ASSIGNED: 'ARBITER_ASSIGNED',
    EVIDENCE_RECEIVED: 'EVIDENCE_RECEIVED',
    CASE_READY: 'CASE_READY',
    VERDICT: 'VERDICT',
    DISPUTE_FALLBACK: 'DISPUTE_FALLBACK',
    DISPUTE_INTENT_ACK: 'DISPUTE_INTENT_ACK',
    DISPUTE_REVEALED: 'DISPUTE_REVEALED',
    // Skill discovery message types
    SKILLS_REGISTERED: 'SKILLS_REGISTERED',
    SEARCH_RESULTS: 'SEARCH_RESULTS',
    // Presence message types
    PRESENCE_CHANGED: 'PRESENCE_CHANGED',
    // Identity verification message types
    VERIFY_REQUEST: 'VERIFY_REQUEST',
    VERIFY_RESPONSE: 'VERIFY_RESPONSE',
    VERIFY_SUCCESS: 'VERIFY_SUCCESS',
    VERIFY_FAILED: 'VERIFY_FAILED',
    // Admin response
    ADMIN_RESULT: 'ADMIN_RESULT',
    // Challenge-response auth
    CHALLENGE: 'CHALLENGE',
    // Nick
    NICK_CHANGED: 'NICK_CHANGED',
    // Typing indicator
    TYPING: 'TYPING',
    // Session conflict
    SESSION_DISPLACED: 'SESSION_DISPLACED',
    // Dispute settlement
    SETTLEMENT_COMPLETE: 'SETTLEMENT_COMPLETE',
};
exports.ErrorCode = {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
    NOT_INVITED: 'NOT_INVITED',
    INVALID_MSG: 'INVALID_MSG',
    RATE_LIMITED: 'RATE_LIMITED',
    AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
    CHANNEL_EXISTS: 'CHANNEL_EXISTS',
    INVALID_NAME: 'INVALID_NAME',
    // Proposal errors
    PROPOSAL_NOT_FOUND: 'PROPOSAL_NOT_FOUND',
    PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED',
    INVALID_PROPOSAL: 'INVALID_PROPOSAL',
    SIGNATURE_REQUIRED: 'SIGNATURE_REQUIRED',
    NOT_PROPOSAL_PARTY: 'NOT_PROPOSAL_PARTY',
    // Staking errors
    INSUFFICIENT_REPUTATION: 'INSUFFICIENT_REPUTATION',
    INVALID_STAKE: 'INVALID_STAKE',
    // Verification errors
    VERIFICATION_FAILED: 'VERIFICATION_FAILED',
    VERIFICATION_EXPIRED: 'VERIFICATION_EXPIRED',
    NO_PUBKEY: 'NO_PUBKEY',
    // Allowlist errors
    NOT_ALLOWED: 'NOT_ALLOWED',
    // Agentcourt errors
    DISPUTE_NOT_FOUND: 'DISPUTE_NOT_FOUND',
    DISPUTE_INVALID_PHASE: 'DISPUTE_INVALID_PHASE',
    DISPUTE_COMMITMENT_MISMATCH: 'DISPUTE_COMMITMENT_MISMATCH',
    DISPUTE_NOT_PARTY: 'DISPUTE_NOT_PARTY',
    DISPUTE_NOT_ARBITER: 'DISPUTE_NOT_ARBITER',
    DISPUTE_DEADLINE_PASSED: 'DISPUTE_DEADLINE_PASSED',
    DISPUTE_ALREADY_EXISTS: 'DISPUTE_ALREADY_EXISTS',
    INSUFFICIENT_ARBITERS: 'INSUFFICIENT_ARBITERS',
};
exports.PresenceStatus = {
    ONLINE: 'online',
    AWAY: 'away',
    BUSY: 'busy',
    OFFLINE: 'offline',
    LISTENING: 'listening'
};
exports.ProposalStatus = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    COMPLETED: 'completed',
    DISPUTED: 'disputed',
    EXPIRED: 'expired'
};
/**
 * Check if a target is a channel (#name) or agent (@name)
 */
function isChannel(target) {
    return Boolean(target && target.startsWith('#'));
}
function isAgent(target) {
    return Boolean(target && target.startsWith('@'));
}
/**
 * Validate agent name
 * - 1-32 characters
 * - alphanumeric, dash, underscore
 * - no spaces
 */
function isValidName(name) {
    if (!name || typeof name !== 'string')
        return false;
    if (name.length < 1 || name.length > 32)
        return false;
    return /^[a-zA-Z0-9_-]+$/.test(name);
}
/**
 * Validate channel name
 * - starts with #
 * - 2-32 characters total
 * - alphanumeric, dash, underscore after #
 */
function isValidChannel(channel) {
    if (!channel || typeof channel !== 'string')
        return false;
    if (!channel.startsWith('#'))
        return false;
    var name = channel.slice(1);
    if (name.length < 1 || name.length > 31)
        return false;
    return /^[a-zA-Z0-9_-]+$/.test(name);
}
/**
 * Validate Ed25519 public key in PEM format
 */
function isValidPubkey(pubkey) {
    if (!pubkey || typeof pubkey !== 'string')
        return false;
    try {
        var keyObj = crypto_1.default.createPublicKey(pubkey);
        return keyObj.asymmetricKeyType === 'ed25519';
    }
    catch (_a) {
        return false;
    }
}
/**
 * Generate stable agent ID from pubkey
 * Returns first 8 chars of SHA256 hash (hex)
 */
function pubkeyToAgentId(pubkey) {
    var hash = crypto_1.default.createHash('sha256').update(pubkey).digest('hex');
    return hash.substring(0, 8);
}
/**
 * Create a message object with timestamp
 */
function createMessage(type, data) {
    if (data === void 0) { data = {}; }
    return __assign({ type: type, ts: Date.now() }, data);
}
/**
 * Create an error message
 */
function createError(code, message) {
    return createMessage(exports.ServerMessageType.ERROR, { code: code, message: message });
}
/**
 * Validate incoming client message
 * Returns { valid: true, msg } or { valid: false, error }
 */
function validateClientMessage(raw) {
    var msg;
    // Parse JSON
    try {
        msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    catch (e) {
        return { valid: false, error: 'Invalid JSON' };
    }
    // Must have type
    if (!msg.type) {
        return { valid: false, error: 'Missing message type' };
    }
    // Validate by type
    switch (msg.type) {
        case exports.ClientMessageType.IDENTIFY:
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
        case exports.ClientMessageType.JOIN:
        case exports.ClientMessageType.LEAVE:
        case exports.ClientMessageType.LIST_AGENTS:
            if (!isValidChannel(msg.channel)) {
                return { valid: false, error: 'Invalid channel name' };
            }
            break;
        case exports.ClientMessageType.MSG:
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
        case exports.ClientMessageType.CREATE_CHANNEL:
            if (!isValidChannel(msg.channel)) {
                return { valid: false, error: 'Invalid channel name' };
            }
            break;
        case exports.ClientMessageType.INVITE:
            if (!isValidChannel(msg.channel)) {
                return { valid: false, error: 'Invalid channel name' };
            }
            if (!msg.agent || !isAgent(msg.agent)) {
                return { valid: false, error: 'Invalid agent target' };
            }
            break;
        case exports.ClientMessageType.LIST_CHANNELS:
        case exports.ClientMessageType.PING:
            // No additional validation needed
            break;
        case exports.ClientMessageType.PROPOSAL:
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
        case exports.ClientMessageType.ACCEPT:
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
        case exports.ClientMessageType.REJECT:
            // Reject requires: proposal_id and signature
            if (!msg.proposal_id) {
                return { valid: false, error: 'Missing proposal_id' };
            }
            if (!msg.sig) {
                return { valid: false, error: 'Reject must be signed' };
            }
            break;
        case exports.ClientMessageType.COMPLETE:
            // Complete requires: proposal_id, signature, and optionally proof
            if (!msg.proposal_id) {
                return { valid: false, error: 'Missing proposal_id' };
            }
            if (!msg.sig) {
                return { valid: false, error: 'Complete must be signed' };
            }
            break;
        case exports.ClientMessageType.DISPUTE:
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
        case exports.ClientMessageType.REGISTER_SKILLS:
            // Register skills requires: skills array and signature
            if (!msg.skills || !Array.isArray(msg.skills)) {
                return { valid: false, error: 'Missing or invalid skills array' };
            }
            if (msg.skills.length === 0) {
                return { valid: false, error: 'Skills array cannot be empty' };
            }
            // Validate each skill has at least a capability
            for (var _i = 0, _a = msg.skills; _i < _a.length; _i++) {
                var skill = _a[_i];
                if (!skill.capability || typeof skill.capability !== 'string') {
                    return { valid: false, error: 'Each skill must have a capability string' };
                }
            }
            if (!msg.sig) {
                return { valid: false, error: 'Skill registration must be signed' };
            }
            break;
        case exports.ClientMessageType.SEARCH_SKILLS:
            // Search skills requires: query object
            if (!msg.query || typeof msg.query !== 'object') {
                return { valid: false, error: 'Missing or invalid query object' };
            }
            // query_id is optional but useful for tracking responses
            break;
        case exports.ClientMessageType.SET_PRESENCE:
            // Set presence requires: status (online, away, busy, offline)
            var validStatuses = ['online', 'away', 'busy', 'offline', 'listening'];
            if (!msg.status || !validStatuses.includes(msg.status)) {
                return { valid: false, error: "Invalid presence status. Must be one of: ".concat(validStatuses.join(', ')) };
            }
            // Optional: status_text for custom message
            if (msg.status_text !== undefined && typeof msg.status_text !== 'string') {
                return { valid: false, error: 'status_text must be a string' };
            }
            if (msg.status_text && msg.status_text.length > 100) {
                return { valid: false, error: 'status_text too long (max 100 chars)' };
            }
            break;
        case exports.ClientMessageType.VERIFY_REQUEST:
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
        case exports.ClientMessageType.VERIFY_RESPONSE:
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
        case exports.ClientMessageType.ADMIN_APPROVE:
            if (!msg.pubkey || typeof msg.pubkey !== 'string') {
                return { valid: false, error: 'Missing or invalid pubkey' };
            }
            if (!msg.admin_key || typeof msg.admin_key !== 'string') {
                return { valid: false, error: 'Missing admin_key' };
            }
            break;
        case exports.ClientMessageType.ADMIN_REVOKE:
            if (!msg.pubkey && !msg.agent_id) {
                return { valid: false, error: 'Missing pubkey or agent_id' };
            }
            if (!msg.admin_key || typeof msg.admin_key !== 'string') {
                return { valid: false, error: 'Missing admin_key' };
            }
            break;
        case exports.ClientMessageType.ADMIN_LIST:
            if (!msg.admin_key || typeof msg.admin_key !== 'string') {
                return { valid: false, error: 'Missing admin_key' };
            }
            break;
        // Agentcourt dispute message types
        case exports.ClientMessageType.DISPUTE_INTENT:
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
        case exports.ClientMessageType.DISPUTE_REVEAL:
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
        case exports.ClientMessageType.EVIDENCE:
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
        case exports.ClientMessageType.ARBITER_ACCEPT:
            if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
                return { valid: false, error: 'Missing or invalid dispute_id' };
            }
            if (!msg.sig) {
                return { valid: false, error: 'Arbiter accept must be signed' };
            }
            break;
        case exports.ClientMessageType.ARBITER_DECLINE:
            if (!msg.dispute_id || typeof msg.dispute_id !== 'string') {
                return { valid: false, error: 'Missing or invalid dispute_id' };
            }
            break;
        case exports.ClientMessageType.ARBITER_VOTE:
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
        case exports.ClientMessageType.SET_NICK:
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
        case exports.ClientMessageType.TYPING:
            if (!isValidChannel(msg.channel)) {
                return { valid: false, error: 'Invalid channel name' };
            }
            break;
        case exports.ClientMessageType.VERIFY_IDENTITY:
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
            return { valid: false, error: "Unknown message type: ".concat(msg.type) };
    }
    return { valid: true, msg: msg };
}
/**
 * Generate a unique agent ID
 */
function generateAgentId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = '';
    for (var i = 0; i < 8; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
/**
 * Serialize message for sending over WebSocket
 */
function serialize(msg) {
    return JSON.stringify(msg);
}
/**
 * Parse message from WebSocket
 */
function parse(data) {
    return JSON.parse(data);
}
/**
 * Generate a unique proposal ID
 * Format: prop_<timestamp>_<random>
 */
function generateProposalId() {
    var timestamp = Date.now().toString(36);
    var random = crypto_1.default.randomBytes(4).toString('hex');
    return "prop_".concat(timestamp, "_").concat(random);
}
/**
 * Check if a message type is an agentcourt dispute type
 */
function isDisputeMessage(type) {
    var disputeTypes = [
        exports.ClientMessageType.DISPUTE_INTENT,
        exports.ClientMessageType.DISPUTE_REVEAL,
        exports.ClientMessageType.EVIDENCE,
        exports.ClientMessageType.ARBITER_ACCEPT,
        exports.ClientMessageType.ARBITER_DECLINE,
        exports.ClientMessageType.ARBITER_VOTE,
    ];
    return disputeTypes.includes(type);
}
/**
 * Check if a message type is a proposal-related type
 */
function isProposalMessage(type) {
    var proposalTypes = [
        exports.ClientMessageType.PROPOSAL,
        exports.ClientMessageType.ACCEPT,
        exports.ClientMessageType.REJECT,
        exports.ClientMessageType.COMPLETE,
        exports.ClientMessageType.DISPUTE
    ];
    return proposalTypes.includes(type);
}
/**
 * Generate a unique verification request ID
 * Format: verify_<timestamp>_<random>
 */
function generateVerifyId() {
    var timestamp = Date.now().toString(36);
    var random = crypto_1.default.randomBytes(4).toString('hex');
    return "verify_".concat(timestamp, "_").concat(random);
}
/**
 * Generate a random nonce for identity verification
 * Returns a 32-character hex string
 */
function generateNonce() {
    return crypto_1.default.randomBytes(16).toString('hex');
}
/**
 * Generate a unique challenge ID
 * Format: chal_<timestamp36>_<random>
 */
function generateChallengeId() {
    var timestamp = Date.now().toString(36);
    var random = crypto_1.default.randomBytes(4).toString('hex');
    return "chal_".concat(timestamp, "_").concat(random);
}
/**
 * Generate the canonical signing content for challenge-response auth.
 * Client signs this to prove private key ownership.
 */
function generateAuthSigningContent(nonce, challengeId, timestamp) {
    return "AGENTCHAT_AUTH|".concat(nonce, "|").concat(challengeId, "|").concat(timestamp);
}
