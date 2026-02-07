/**
 * Identity Handlers
 * Handles identify, verification request/response
 */

import crypto from 'crypto';
import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type {
  IdentifyMessage,
  VerifyRequestMessage,
  VerifyResponseMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  generateAgentId,
  generateVerifyId,
  pubkeyToAgentId,
} from '../../protocol.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

// Pending verification request
interface PendingVerification {
  from: string;
  fromWs: ExtendedWebSocket;
  target: string;
  targetPubkey: string;
  nonce: string;
  expires: number;
}

/**
 * Handle IDENTIFY command
 */
export function handleIdentify(server: AgentChatServer, ws: ExtendedWebSocket, msg: IdentifyMessage): void {
  // Check if already identified
  if (server.agents.has(ws)) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Already identified'));
    return;
  }

  // Allowlist check (before any state changes)
  if (server.allowlist && server.allowlist.enabled) {
    const check = server.allowlist.check(msg.pubkey || null);
    if (!check.allowed) {
      server._log('allowlist_rejected', {
        ip: ws._realIp,
        name: msg.name,
        hasPubkey: !!msg.pubkey,
        reason: check.reason
      });
      server._send(ws, createError(ErrorCode.NOT_ALLOWED, check.reason));
      return;
    }
  }

  let id: string;

  // Use pubkey-derived stable ID if pubkey provided
  if (msg.pubkey) {
    // Check if this pubkey has connected before
    const existingId = server.pubkeyToId.get(msg.pubkey);
    if (existingId) {
      // Returning agent - use their stable ID
      id = existingId;
    } else {
      // New agent with pubkey - generate stable ID from pubkey
      id = pubkeyToAgentId(msg.pubkey);
      server.pubkeyToId.set(msg.pubkey, id);
    }

    // Check if this ID is currently in use by another connection
    if (server.agentById.has(id)) {
      // Kick the old connection instead of rejecting the new one
      const oldWs = server.agentById.get(id)!;
      server._log('identity-takeover', { id, reason: 'New connection with same identity' });
      server._send(oldWs, createError(ErrorCode.INVALID_MSG, 'Disconnected: Another connection claimed this identity'));
      server._handleDisconnect(oldWs);
      (oldWs as WebSocket).close(1000, 'Identity claimed by new connection');
    }
  } else {
    // Ephemeral agent - generate random ID
    id = generateAgentId();
  }

  const agent = {
    id,
    name: msg.name,
    pubkey: msg.pubkey || null,
    channels: new Set<string>(),
    connectedAt: Date.now(),
    presence: 'online' as const,
    status_text: null as string | null
  };

  server.agents.set(ws, agent);
  server.agentById.set(id, ws);

  // Determine if this is a new or returning identity
  const isReturning = msg.pubkey && server.pubkeyToId.has(msg.pubkey);
  const isEphemeral = !msg.pubkey;

  server._log('identify', {
    id,
    name: msg.name,
    hasPubkey: !!msg.pubkey,
    returning: isReturning,
    ephemeral: isEphemeral,
    ip: ws._realIp,
    user_agent: ws._userAgent
  });

  server._send(ws, createMessage(ServerMessageType.WELCOME, {
    agent_id: `@${id}`,
    name: msg.name,
    server: server.serverName
  }));
}

/**
 * Handle VERIFY_REQUEST command
 */
export function handleVerifyRequest(server: AgentChatServer, ws: ExtendedWebSocket, msg: VerifyRequestMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // Find target agent
  const targetId = msg.target.slice(1);
  const targetWs = server.agentById.get(targetId);

  if (!targetWs) {
    server._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.target} not found`));
    return;
  }

  const targetAgent = server.agents.get(targetWs);

  // Target must have a pubkey for verification
  if (!targetAgent?.pubkey) {
    server._send(ws, createError(ErrorCode.NO_PUBKEY, `Agent ${msg.target} has no persistent identity`));
    return;
  }

  // Create verification request
  const requestId = generateVerifyId();
  const expires = Date.now() + server.verificationTimeoutMs;

  const pendingVerification: PendingVerification = {
    from: `@${agent.id}`,
    fromWs: ws,
    target: msg.target,
    targetPubkey: targetAgent.pubkey,
    nonce: msg.nonce,
    expires
  };

  server.pendingVerifications.set(requestId, pendingVerification);

  // Set timeout to clean up expired requests
  setTimeout(() => {
    const request = server.pendingVerifications.get(requestId) as PendingVerification | undefined;
    if (request) {
      server.pendingVerifications.delete(requestId);
      // Notify requester of timeout
      if ((request.fromWs as WebSocket).readyState === 1) {
        server._send(request.fromWs, createMessage(ServerMessageType.VERIFY_FAILED, {
          request_id: requestId,
          target: request.target,
          reason: 'Verification timed out'
        }));
      }
    }
  }, server.verificationTimeoutMs);

  server._log('verify_request', { id: requestId, from: agent.id, target: targetId });

  // Forward to target agent
  server._send(targetWs, createMessage(ServerMessageType.VERIFY_REQUEST, {
    request_id: requestId,
    from: `@${agent.id}`,
    nonce: msg.nonce
  }));

  // Acknowledge to requester
  server._send(ws, createMessage(ServerMessageType.VERIFY_REQUEST, {
    request_id: requestId,
    target: msg.target,
    status: 'pending'
  }));
}

/**
 * Handle VERIFY_RESPONSE command
 */
export function handleVerifyResponse(server: AgentChatServer, ws: ExtendedWebSocket, msg: VerifyResponseMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // Must have identity to respond to verification
  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Responding to verification requires persistent identity'));
    return;
  }

  // Find the pending verification
  const request = server.pendingVerifications.get(msg.request_id) as PendingVerification | undefined;
  if (!request) {
    server._send(ws, createError(ErrorCode.VERIFICATION_EXPIRED, 'Verification request not found or expired'));
    return;
  }

  // Verify the responder is the target
  if (request.target !== `@${agent.id}`) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'You are not the target of this verification'));
    return;
  }

  // Verify the nonce matches
  if (msg.nonce !== request.nonce) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Nonce mismatch'));
    return;
  }

  // Verify the signature
  let verified = false;
  try {
    const keyObj = crypto.createPublicKey(request.targetPubkey);
    verified = crypto.verify(
      null,
      Buffer.from(msg.nonce),
      keyObj,
      Buffer.from(msg.sig, 'base64')
    );
  } catch (err) {
    server._log('verify_error', { request_id: msg.request_id, error: (err as Error).message });
  }

  // Clean up the pending request
  server.pendingVerifications.delete(msg.request_id);

  server._log('verify_response', {
    request_id: msg.request_id,
    from: agent.id,
    verified
  });

  // Notify the original requester
  if ((request.fromWs as WebSocket).readyState === 1) {
    if (verified) {
      server._send(request.fromWs, createMessage(ServerMessageType.VERIFY_SUCCESS, {
        request_id: msg.request_id,
        agent: request.target,
        pubkey: request.targetPubkey
      }));
    } else {
      server._send(request.fromWs, createMessage(ServerMessageType.VERIFY_FAILED, {
        request_id: msg.request_id,
        target: request.target,
        reason: 'Signature verification failed'
      }));
    }
  }

  // Notify the responder
  server._send(ws, createMessage(verified ? ServerMessageType.VERIFY_SUCCESS : ServerMessageType.VERIFY_FAILED, {
    request_id: msg.request_id,
    verified
  }));
}
