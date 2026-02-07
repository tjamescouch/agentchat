/**
 * Presence Handlers
 * Handles presence status updates
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type { SetPresenceMessage } from '../../types.js';
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
 * Handle SET_PRESENCE command
 */
export function handleSetPresence(server: AgentChatServer, ws: ExtendedWebSocket, msg: SetPresenceMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const oldPresence = agent.presence;
  agent.presence = msg.status;
  agent.status_text = msg.status_text || null;

  server._log('presence_changed', {
    agent: agent.id,
    from: oldPresence,
    to: msg.status,
    statusText: agent.status_text
  });

  // Broadcast presence change to all channels the agent is in
  const presenceMsg = createMessage(ServerMessageType.PRESENCE_CHANGED, {
    agent_id: `@${agent.id}`,
    name: agent.name,
    presence: agent.presence,
    status_text: agent.status_text
  });

  for (const channelName of agent.channels) {
    server._broadcast(channelName, presenceMsg);
  }
}
