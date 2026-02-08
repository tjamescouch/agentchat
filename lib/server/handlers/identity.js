"use strict";
/**
 * Identity Handlers
 * Handles identify, verification request/response
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
exports.handleIdentify = handleIdentify;
exports.handleVerifyIdentity = handleVerifyIdentity;
exports.handleVerifyRequest = handleVerifyRequest;
exports.handleVerifyResponse = handleVerifyResponse;
var crypto_1 = require("crypto");
var protocol_js_1 = require("../../protocol.js");
var identity_js_1 = require("../../identity.js");
/**
 * Handle IDENTIFY command
 *
 * For ephemeral agents (no pubkey): immediately create agent state and send WELCOME.
 * For pubkey agents: send CHALLENGE, wait for VERIFY_IDENTITY before creating state.
 */
function handleIdentify(server, ws, msg) {
    // Check if already identified
    if (server.agents.has(ws)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Already identified'));
        return;
    }
    // Check if this ws already has a pending challenge
    for (var _i = 0, _a = server.pendingChallenges; _i < _a.length; _i++) {
        var _b = _a[_i], challenge = _b[1];
        if (challenge.ws === ws) {
            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Challenge already pending'));
            return;
        }
    }
    // Allowlist check (before any state changes)
    if (server.allowlist && server.allowlist.enabled) {
        var check = server.allowlist.check(msg.pubkey || null);
        if (!check.allowed) {
            server._log('allowlist_rejected', {
                ip: ws._realIp,
                name: msg.name,
                hasPubkey: !!msg.pubkey,
                reason: check.reason
            });
            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NOT_ALLOWED, check.reason));
            return;
        }
    }
    if (msg.pubkey) {
        // Pubkey agent: send challenge, do NOT create agent state yet
        var challengeId_1 = (0, protocol_js_1.generateChallengeId)();
        var nonce = (0, protocol_js_1.generateNonce)();
        var expiresAt = Date.now() + server.challengeTimeoutMs;
        server.pendingChallenges.set(challengeId_1, {
            ws: ws,
            name: msg.name,
            pubkey: msg.pubkey,
            nonce: nonce,
            challengeId: challengeId_1,
            expires: expiresAt
        });
        // Set timeout to clean up expired challenges
        setTimeout(function () {
            var challenge = server.pendingChallenges.get(challengeId_1);
            if (challenge) {
                server.pendingChallenges.delete(challengeId_1);
                if (challenge.ws.readyState === 1) {
                    server._send(challenge.ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_EXPIRED, 'Challenge expired'));
                    challenge.ws.close(1000, 'Challenge expired');
                }
            }
        }, server.challengeTimeoutMs);
        server._log('challenge_sent', {
            challengeId: challengeId_1,
            name: msg.name,
            ip: ws._realIp
        });
        server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.CHALLENGE, {
            challenge_id: challengeId_1,
            nonce: nonce,
            expires_at: expiresAt
        }));
    }
    else {
        // Ephemeral agent: create state immediately
        var id = (0, protocol_js_1.generateAgentId)();
        var agent = {
            id: id,
            name: msg.name,
            pubkey: null,
            channels: new Set(),
            connectedAt: Date.now(),
            presence: 'online',
            status_text: null,
            verified: false
        };
        server.agents.set(ws, agent);
        server.agentById.set(id, ws);
        server._log('identify', {
            id: id,
            name: msg.name,
            hasPubkey: false,
            ephemeral: true,
            ip: ws._realIp,
            user_agent: ws._userAgent
        });
        server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.WELCOME, __assign({ agent_id: "@".concat(id), name: msg.name, server: server.serverName }, (server.motd ? { motd: server.motd } : {}))));
    }
}
/**
 * Handle VERIFY_IDENTITY command
 *
 * Verifies the challenge-response signature. On success, creates agent state
 * and sends WELCOME. On failure, sends error.
 */
function handleVerifyIdentity(server, ws, msg) {
    // Check if already identified
    if (server.agents.has(ws)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Already identified'));
        return;
    }
    // Look up the pending challenge
    var challenge = server.pendingChallenges.get(msg.challenge_id);
    if (!challenge) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_EXPIRED, 'Challenge not found or expired'));
        return;
    }
    // Verify this is the same websocket that initiated the challenge
    if (challenge.ws !== ws) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Challenge belongs to a different connection'));
        return;
    }
    // Check expiration
    if (Date.now() > challenge.expires) {
        server.pendingChallenges.delete(msg.challenge_id);
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_EXPIRED, 'Challenge expired'));
        return;
    }
    // Verify the signature
    var expectedContent = (0, protocol_js_1.generateAuthSigningContent)(challenge.nonce, msg.challenge_id, msg.timestamp);
    var verified = identity_js_1.Identity.verify(expectedContent, msg.signature, challenge.pubkey);
    if (!verified) {
        server.pendingChallenges.delete(msg.challenge_id);
        server._log('challenge_failed', {
            challengeId: msg.challenge_id,
            name: challenge.name,
            ip: ws._realIp
        });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    // Challenge passed — clean up pending challenge
    server.pendingChallenges.delete(msg.challenge_id);
    // Derive stable agent ID from pubkey
    var existingId = server.pubkeyToId.get(challenge.pubkey);
    var id;
    if (existingId) {
        id = existingId;
    }
    else {
        id = (0, protocol_js_1.pubkeyToAgentId)(challenge.pubkey);
        server.pubkeyToId.set(challenge.pubkey, id);
    }
    // Check if this ID is currently in use by another connection
    if (server.agentById.has(id)) {
        var oldWs = server.agentById.get(id);
        server._log('identity-takeover', { id: id, reason: 'Verified connection replacing existing' });
        server._send(oldWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.SESSION_DISPLACED, {
            reason: 'Another connection verified this identity',
            new_ip: ws._realIp || 'unknown',
        }));
        server._handleDisconnect(oldWs);
        oldWs.close(1000, 'Identity claimed by verified connection');
    }
    // Create agent state with verified = true
    var agent = {
        id: id,
        name: challenge.name,
        pubkey: challenge.pubkey,
        channels: new Set(),
        connectedAt: Date.now(),
        presence: 'online',
        status_text: null,
        verified: true
    };
    server.agents.set(ws, agent);
    server.agentById.set(id, ws);
    var isReturning = !!existingId;
    server._log('identify', {
        id: id,
        name: challenge.name,
        hasPubkey: true,
        verified: true,
        returning: isReturning,
        ip: ws._realIp,
        user_agent: ws._userAgent
    });
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.WELCOME, __assign({ agent_id: "@".concat(id), name: challenge.name, server: server.serverName, verified: true }, (server.motd ? { motd: server.motd } : {}))));
}
/**
 * Handle VERIFY_REQUEST command
 */
function handleVerifyRequest(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    // Find target agent
    var targetId = msg.target.slice(1);
    var targetWs = server.agentById.get(targetId);
    if (!targetWs) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AGENT_NOT_FOUND, "Agent ".concat(msg.target, " not found")));
        return;
    }
    var targetAgent = server.agents.get(targetWs);
    // Target must have a pubkey for verification
    if (!(targetAgent === null || targetAgent === void 0 ? void 0 : targetAgent.pubkey)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NO_PUBKEY, "Agent ".concat(msg.target, " has no persistent identity")));
        return;
    }
    // Create verification request
    var requestId = (0, protocol_js_1.generateVerifyId)();
    var expires = Date.now() + server.verificationTimeoutMs;
    var pendingVerification = {
        from: "@".concat(agent.id),
        fromWs: ws,
        target: msg.target,
        targetPubkey: targetAgent.pubkey,
        nonce: msg.nonce,
        expires: expires
    };
    server.pendingVerifications.set(requestId, pendingVerification);
    // Set timeout to clean up expired requests
    setTimeout(function () {
        var request = server.pendingVerifications.get(requestId);
        if (request) {
            server.pendingVerifications.delete(requestId);
            // Notify requester of timeout
            if (request.fromWs.readyState === 1) {
                server._send(request.fromWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERIFY_FAILED, {
                    request_id: requestId,
                    target: request.target,
                    reason: 'Verification timed out'
                }));
            }
        }
    }, server.verificationTimeoutMs);
    server._log('verify_request', { id: requestId, from: agent.id, target: targetId });
    // Forward to target agent
    server._send(targetWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERIFY_REQUEST, {
        request_id: requestId,
        from: "@".concat(agent.id),
        nonce: msg.nonce
    }));
    // Acknowledge to requester
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERIFY_REQUEST, {
        request_id: requestId,
        target: msg.target,
        status: 'pending'
    }));
}
/**
 * Handle VERIFY_RESPONSE command
 */
function handleVerifyResponse(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    // Must have identity to respond to verification
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Responding to verification requires persistent identity'));
        return;
    }
    // Find the pending verification
    var request = server.pendingVerifications.get(msg.request_id);
    if (!request) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_EXPIRED, 'Verification request not found or expired'));
        return;
    }
    // Verify the responder is the target
    if (request.target !== "@".concat(agent.id)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'You are not the target of this verification'));
        return;
    }
    // Verify the nonce matches
    if (msg.nonce !== request.nonce) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Nonce mismatch'));
        return;
    }
    // Verify the signature
    var verified = false;
    try {
        var keyObj = crypto_1.default.createPublicKey(request.targetPubkey);
        verified = crypto_1.default.verify(null, Buffer.from(msg.nonce), keyObj, Buffer.from(msg.sig, 'base64'));
    }
    catch (err) {
        server._log('verify_error', { request_id: msg.request_id, error: err.message });
    }
    // Clean up the pending request
    server.pendingVerifications.delete(msg.request_id);
    server._log('verify_response', {
        request_id: msg.request_id,
        from: agent.id,
        verified: verified
    });
    // Notify the original requester
    if (request.fromWs.readyState === 1) {
        if (verified) {
            server._send(request.fromWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERIFY_SUCCESS, {
                request_id: msg.request_id,
                agent: request.target,
                pubkey: request.targetPubkey
            }));
        }
        else {
            server._send(request.fromWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERIFY_FAILED, {
                request_id: msg.request_id,
                target: request.target,
                reason: 'Signature verification failed'
            }));
        }
    }
    // Notify the responder
    server._send(ws, (0, protocol_js_1.createMessage)(verified ? protocol_js_1.ServerMessageType.VERIFY_SUCCESS : protocol_js_1.ServerMessageType.VERIFY_FAILED, {
        request_id: msg.request_id,
        verified: verified
    }));
}
