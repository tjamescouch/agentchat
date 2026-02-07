/**
 * Admin Handlers
 * Handles allowlist administration commands
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type {
  AdminApproveMessage,
  AdminRevokeMessage,
  AdminListMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

/**
 * Handle ADMIN_APPROVE command - add a pubkey to the allowlist
 */
export function handleAdminApprove(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminApproveMessage): void {
  if (!server.allowlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Allowlist not configured'));
    return;
  }

  if (!msg.pubkey) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Missing pubkey'));
    return;
  }

  const result = server.allowlist.approve(msg.pubkey, msg.admin_key, msg.note || '');

  if (!result.success) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, result.error!));
    return;
  }

  server._log('admin_approve', { agentId: result.agentId });
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'approve',
    success: true,
    agentId: `@${result.agentId}`,
  }));
}

/**
 * Handle ADMIN_REVOKE command - remove a pubkey from the allowlist
 */
export function handleAdminRevoke(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminRevokeMessage): void {
  if (!server.allowlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Allowlist not configured'));
    return;
  }

  const identifier = msg.pubkey || msg.agent_id;
  if (!identifier) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Missing pubkey or agent_id'));
    return;
  }

  const result = server.allowlist.revoke(identifier, msg.admin_key);

  if (!result.success) {
    const code = result.error === 'invalid admin key' ? ErrorCode.AUTH_REQUIRED : ErrorCode.AGENT_NOT_FOUND;
    server._send(ws, createError(code, result.error!));
    return;
  }

  server._log('admin_revoke', { identifier });
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'revoke',
    success: true,
  }));
}

/**
 * Handle ADMIN_LIST command - list all approved entries
 */
export function handleAdminList(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminListMessage): void {
  if (!server.allowlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Allowlist not configured'));
    return;
  }

  // Validate admin key
  if (!server.allowlist._validateAdminKey(msg.admin_key)) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Invalid admin key'));
    return;
  }

  const entries = server.allowlist.list();
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'list',
    entries,
    enabled: server.allowlist.enabled,
    strict: server.allowlist.strict,
  }));
}
