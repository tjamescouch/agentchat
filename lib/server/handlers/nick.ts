/**
 * Nick Handler
 * Handles SET_NICK command — allows agents to change their display name
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type { ExtendedWebSocket } from '../../server.js';
import type { SetNickMessage } from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';


// Reserved nicks that cannot be claimed
const RESERVED_NICKS = new Set([
  'server', 'admin', 'system', 'root', 'moderator', 'mod',
  'bot', 'agentchat', 'operator', 'shadow', 'god', 'jc',
]);

// Rate limit: one nick change per 30 seconds
const NICK_RATE_LIMIT_MS = 30000;

/**
 * Handle SET_NICK command
 */
export function handleSetNick(server: AgentChatServer, ws: ExtendedWebSocket, msg: SetNickMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const nick = msg.nick.trim();

  // Check reserved nicks
  if (RESERVED_NICKS.has(nick.toLowerCase())) {
    server._send(ws, createError(ErrorCode.INVALID_NAME, `Nick "${nick}" is reserved`));
    return;
  }

  // Rate limit
  const now = Date.now();
  if (ws._lastNickChange && (now - ws._lastNickChange) < NICK_RATE_LIMIT_MS) {
    const waitSec = Math.ceil((NICK_RATE_LIMIT_MS - (now - ws._lastNickChange)) / 1000);
    server._send(ws, createError(ErrorCode.RATE_LIMITED, `Nick change rate limited. Try again in ${waitSec}s`));
    return;
  }

  const oldNick = agent.name || `anon_${agent.id}`;

  // Update name
  agent.name = nick;
  ws._lastNickChange = now;

  server._log('nick_change', { agent: agent.id, old: oldNick, new: nick });

  // Broadcast NICK_CHANGED to all channels the agent is in
  const notification = createMessage(ServerMessageType.NICK_CHANGED, {
    agent_id: `@${agent.id}`,
    old_nick: oldNick,
    new_nick: nick,
  });

  for (const channelName of agent.channels) {
    server._broadcast(channelName, notification);
  }

  // Confirm to the sender
  server._send(ws, notification);
}
