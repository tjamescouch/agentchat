/**
 * Ban/Kick Handlers
 * Handles moderation commands: kick, ban, unban
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type { ExtendedWebSocket } from '../../server.js';
import type {
  AdminKickMessage,
  AdminBanMessage,
  AdminUnbanMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';
import { sendNtfyNotification } from '../../ntfy.js';


/**
 * Handle ADMIN_KICK command - immediately disconnect an agent
 */
export function handleAdminKick(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminKickMessage): void {
  if (!server.banlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Moderation not configured (no admin key)'));
    return;
  }

  if (!server.banlist._validateAdminKey(msg.admin_key)) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Invalid admin key'));
    return;
  }

  // Strip @ prefix if present
  const targetId = msg.agent_id.startsWith('@') ? msg.agent_id.slice(1) : msg.agent_id;
  const targetWs = server.agentById.get(targetId);

  if (!targetWs) {
    server._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent @${targetId} not found or not online`));
    return;
  }

  // Get agent state for nick
  const agent = server.agents.get(targetWs);
  const agentName = agent?.name || `anon_${targetId}`;

  // Send KICKED to target before disconnecting
  server._send(targetWs, createMessage(ServerMessageType.KICKED, {
    reason: msg.reason || 'Kicked by admin',
  }));

  server._log('admin_kick', { targetId, reason: msg.reason });

  // Send NTFY notification with agent nick
  sendNtfyNotification(server.ntfySecret, 'kick', targetId, agentName, msg.reason);

  // Disconnect the target
  server._handleDisconnect(targetWs);
  (targetWs as WebSocket).close(1000, 'Kicked by admin');

  // Confirm to admin
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'kick',
    success: true,
    agentId: `@${targetId}`,
  }));
}

/**
 * Handle ADMIN_BAN command - persist ban and kick if online
 */
export function handleAdminBan(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminBanMessage): void {
  if (!server.banlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Moderation not configured (no admin key)'));
    return;
  }

  // Strip @ prefix if present
  const targetId = msg.agent_id.startsWith('@') ? msg.agent_id.slice(1) : msg.agent_id;

  const result = server.banlist.ban(targetId, msg.admin_key, msg.reason || '');

  if (!result.success) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, result.error!));
    return;
  }

  server._log('admin_ban', { targetId, reason: msg.reason });

  // If the agent is currently online, kick them
  const targetWs = server.agentById.get(targetId);
  if (targetWs) {
    const agent = server.agents.get(targetWs);
    const agentName = agent?.name || `anon_${targetId}`;

    server._send(targetWs, createMessage(ServerMessageType.BANNED, {
      reason: msg.reason || 'Banned by admin',
    }));

    // Send NTFY notification with agent nick
    sendNtfyNotification(server.ntfySecret, 'ban', targetId, agentName, msg.reason);

    server._handleDisconnect(targetWs);
    (targetWs as WebSocket).close(1000, 'Banned by admin');
  } else {
    // Agent not online, but still send NTFY notification
    sendNtfyNotification(server.ntfySecret, 'ban', targetId, `anon_${targetId}`, msg.reason);
  }

  // Confirm to admin
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'ban',
    success: true,
    agentId: `@${targetId}`,
  }));
}

/**
 * Handle ADMIN_UNBAN command - remove ban
 */
export function handleAdminUnban(server: AgentChatServer, ws: ExtendedWebSocket, msg: AdminUnbanMessage): void {
  if (!server.banlist) {
    server._send(ws, createError(ErrorCode.INVALID_MSG, 'Moderation not configured (no admin key)'));
    return;
  }

  // Strip @ prefix if present
  const targetId = msg.agent_id.startsWith('@') ? msg.agent_id.slice(1) : msg.agent_id;

  const result = server.banlist.unban(targetId, msg.admin_key);

  if (!result.success) {
    const code = result.error === 'invalid admin key' ? ErrorCode.AUTH_REQUIRED : ErrorCode.AGENT_NOT_FOUND;
    server._send(ws, createError(code, result.error!));
    return;
  }

  server._log('admin_unban', { targetId });

  // Confirm to admin
  server._send(ws, createMessage(ServerMessageType.ADMIN_RESULT, {
    action: 'unban',
    success: true,
    agentId: `@${targetId}`,
  }));
}
