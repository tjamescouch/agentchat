/**
 * Presence Handlers
 * Handles presence status updates
 */

import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';

/**
 * Handle SET_PRESENCE command
 */
export function handleSetPresence(server, ws, msg) {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const oldPresence = agent.presence;
  agent.presence = msg.status;
  agent.statusText = msg.status_text || null;

  server._log('presence_changed', {
    agent: agent.id,
    from: oldPresence,
    to: msg.status,
    statusText: agent.statusText
  });

  // Broadcast presence change to all channels the agent is in
  const presenceMsg = createMessage(ServerMessageType.PRESENCE_CHANGED, {
    agent_id: `@${agent.id}`,
    presence: agent.presence,
    status_text: agent.statusText
  });

  for (const channelName of agent.channels) {
    server._broadcast(channelName, presenceMsg);
  }
}
