/**
 * Admin Handlers
 * Handles allowlist administration commands
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type { ExtendedWebSocket } from '../../server.js';
import type {
  AdminApproveMessage,
  AdminRevokeMessage,
  AdminListMessage,
  AdminMotdMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';


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

export function handleAdminMotd(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminMotdMessage): void {
  const adminKey = process.env.AGENTCHAT_ADMIN_KEY;
  if (!adminKey || msg.admin_key !== adminKey) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Invalid admin key'));
    return;
  }

  server.motd = msg.motd || null;
  server._log('admin_motd', { motd: server.motd, kick: msg.kick });

  const motdMsg = createMessage(ServerMessageType.MOTD_UPDATE, { motd: server.motd });
  if (server.wss) {
    server.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        server._send(client as ExtendedWebSocket, motdMsg);
      }
    });
  }

  if (msg.kick) {
    setTimeout(() => {
      if (!server.wss) return;
      server.wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === client.OPEN) {
          client.close(1001, 'Server maintenance');
        }
      });
    }, 500);
  }

  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'motd',
    success: true,
    motd: server.motd,
    kicked: msg.kick || false,
  }));
}
