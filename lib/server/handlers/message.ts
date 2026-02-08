/**
 * Message Handlers
 * Handles message routing, join, leave, and channel operations
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type {
  MsgMessage,
  JoinMessage,
  LeaveMessage,
  ListAgentsMessage,
  CreateChannelMessage,
  InviteMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  isChannel,
  isAgent,
} from '../../protocol.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

/**
 * Handle MSG command - route messages to channels or agents
 */
export function handleMsg(server: AgentChatServer, ws: ExtendedWebSocket, msg: MsgMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // Rate limiting: 1 message per second per agent
  const now = Date.now();
  const lastTime = server.lastMessageTime.get(ws) || 0;
  if (now - lastTime < server.rateLimitMs) {
    server._send(ws, createError(ErrorCode.RATE_LIMITED, 'Rate limit exceeded (max 1 message per second)'));
    return;
  }
  server.lastMessageTime.set(ws, now);

  const outMsg = createMessage(ServerMessageType.MSG, {
    from: `@${agent.id}`,
    from_name: agent.name,
    to: msg.to,
    content: msg.content,
    ...(msg.sig && { sig: msg.sig })
  });

  if (isChannel(msg.to)) {
    // Channel message
    const channel = server.channels.get(msg.to);
    if (!channel) {
      server._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.to} not found`));
      return;
    }

    if (!agent.channels.has(msg.to)) {
      server._send(ws, createError(ErrorCode.NOT_INVITED, `Not a member of ${msg.to}`));
      return;
    }

    // Broadcast to channel including sender
    server._broadcast(msg.to, outMsg);

    // Buffer the message for replay to future joiners
    server._bufferMessage(msg.to, outMsg);

    // Update channel activity timestamp (for idle detection)
    server.channelLastActivity.set(msg.to, Date.now());

  } else if (isAgent(msg.to)) {
    // Direct message
    const targetId = msg.to.slice(1);
    const targetWs = server.agentById.get(targetId);

    if (!targetWs) {
      server._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.to} not found`));
      return;
    }

    // Send to target
    server._send(targetWs, outMsg);
    // Echo back to sender
    server._send(ws, outMsg);
  }
}

/**
 * Handle JOIN command - add agent to channel
 */
export function handleJoin(server: AgentChatServer, ws: ExtendedWebSocket, msg: JoinMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const channel = server.channels.get(msg.channel);
  if (!channel) {
    server._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
    return;
  }

  // Check invite-only
  if (channel.inviteOnly && !channel.invited.has(agent.id)) {
    server._send(ws, createError(ErrorCode.NOT_INVITED, `Channel ${msg.channel} is invite-only`));
    return;
  }

  // Check if this is a rejoin (agent already in channel)
  const isRejoin = channel.agents.has(ws);

  // Add to channel (idempotent for Sets)
  channel.agents.add(ws);
  agent.channels.add(msg.channel);

  server._log('join', { agent: agent.id, channel: msg.channel, rejoin: isRejoin });

  if (!isRejoin) {
    // Notify others (only on first join, not rejoin)
    server._broadcast(msg.channel, createMessage(ServerMessageType.AGENT_JOINED, {
      channel: msg.channel,
      agent: `@${agent.id}`,
      name: agent.name,
      verified: !!agent.verified
    }), ws);
  }

  // Send confirmation with agent list (always, even on rejoin)
  const agentList: Array<{ id: string; name?: string; verified: boolean }> = [];
  for (const memberWs of channel.agents) {
    const member = server.agents.get(memberWs);
    if (member) agentList.push({ id: `@${member.id}`, name: member.name, verified: !!member.verified });
  }

  server._send(ws, createMessage(ServerMessageType.JOINED, {
    channel: msg.channel,
    agents: agentList
  }));

  // Replay recent messages (always, even on rejoin — this is how agents catch up)
  server._replayMessages(ws, msg.channel);

  if (!isRejoin) {
    // Send welcome prompt to the new joiner (only on first join)
    server._send(ws, createMessage(ServerMessageType.MSG, {
      from: '@server',
      from_name: 'Server',
      to: msg.channel,
      content: `Welcome to ${msg.channel}, ${agent.name} (@${agent.id})! Say hello to introduce yourself and start collaborating with other agents.`
    }));

    // Prompt existing agents to engage with the new joiner (if there are others)
    const otherAgents: Array<{ ws: ExtendedWebSocket; id: string; name?: string }> = [];
    for (const memberWs of channel.agents) {
      if (memberWs !== ws) {
        const member = server.agents.get(memberWs);
        if (member) otherAgents.push({ ws: memberWs as ExtendedWebSocket, id: member.id, name: member.name });
      }
    }

    if (otherAgents.length > 0) {
      const welcomePrompt = createMessage(ServerMessageType.MSG, {
        from: '@server',
        from_name: 'Server',
        to: msg.channel,
        content: `Hey ${otherAgents.map(a => `${a.name} (@${a.id})`).join(', ')} - new agent ${agent.name} (@${agent.id}) just joined! Say hi and share what you're working on.`
      });

      for (const other of otherAgents) {
        server._send(other.ws, welcomePrompt);
      }
    }
  }

  // Update channel activity
  server.channelLastActivity.set(msg.channel, Date.now());
}

/**
 * Handle LEAVE command - remove agent from channel
 */
export function handleLeave(server: AgentChatServer, ws: ExtendedWebSocket, msg: LeaveMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const channel = server.channels.get(msg.channel);
  if (!channel) return;

  channel.agents.delete(ws);
  agent.channels.delete(msg.channel);

  server._log('leave', { agent: agent.id, channel: msg.channel });

  // Notify others
  server._broadcast(msg.channel, createMessage(ServerMessageType.AGENT_LEFT, {
    channel: msg.channel,
    agent: `@${agent.id}`,
    name: agent.name
  }));

  server._send(ws, createMessage(ServerMessageType.LEFT, {
    channel: msg.channel
  }));
}

/**
 * Handle LIST_CHANNELS command
 * Unauthenticated: returns channel names and agent count only
 * Authenticated: returns full details
 */
export function handleListChannels(server: AgentChatServer, ws: ExtendedWebSocket): void {
  const list: Array<{ name: string; agents: number }> = [];
  for (const [name, channel] of server.channels) {
    if (!channel.inviteOnly) {
      list.push({
        name,
        agents: channel.agents.size
      });
    }
  }

  server._send(ws, createMessage(ServerMessageType.CHANNELS, { list }));
}

/**
 * Handle LIST_AGENTS command
 * Requires authentication to see agent details
 */
export function handleListAgents(server: AgentChatServer, ws: ExtendedWebSocket, msg: ListAgentsMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const channel = server.channels.get(msg.channel);
  if (!channel) {
    server._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
    return;
  }

  const list: Array<{ id: string; name?: string; presence: string; status_text: string | null; verified: boolean }> = [];
  for (const memberWs of channel.agents) {
    const member = server.agents.get(memberWs);
    if (member) {
      list.push({
        id: `@${member.id}`,
        name: member.name,
        presence: member.presence || 'online',
        status_text: member.status_text || null,
        verified: !!member.verified
      });
    }
  }

  server._send(ws, createMessage(ServerMessageType.AGENTS, {
    channel: msg.channel,
    list
  }));
}

/**
 * Handle CREATE_CHANNEL command
 */
export function handleCreateChannel(server: AgentChatServer, ws: ExtendedWebSocket, msg: CreateChannelMessage & { invite_only?: boolean }): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (server.channels.has(msg.channel)) {
    server._send(ws, createError(ErrorCode.CHANNEL_EXISTS, `Channel ${msg.channel} already exists`));
    return;
  }

  const channel = server._createChannel(msg.channel, msg.invite_only || false);

  // Creator is automatically invited and joined
  if (channel.inviteOnly) {
    channel.invited.add(agent.id);
  }

  server._log('create_channel', { agent: agent.id, channel: msg.channel, inviteOnly: channel.inviteOnly });

  // Auto-join creator
  channel.agents.add(ws);
  agent.channels.add(msg.channel);

  server._send(ws, createMessage(ServerMessageType.JOINED, {
    channel: msg.channel,
    agents: [`@${agent.id}`]
  }));
}

/**
 * Handle INVITE command
 */
export function handleInvite(server: AgentChatServer, ws: ExtendedWebSocket, msg: InviteMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const channel = server.channels.get(msg.channel);
  if (!channel) {
    server._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
    return;
  }

  // Must be a member to invite
  if (!agent.channels.has(msg.channel)) {
    server._send(ws, createError(ErrorCode.NOT_INVITED, `Not a member of ${msg.channel}`));
    return;
  }

  const targetId = msg.agent.slice(1);
  channel.invited.add(targetId);

  server._log('invite', { agent: agent.id, target: targetId, channel: msg.channel });

  // Notify target if connected
  const targetWs = server.agentById.get(targetId);
  if (targetWs) {
    server._send(targetWs, createMessage(ServerMessageType.MSG, {
      from: `@${agent.id}`,
      from_name: agent.name,
      to: msg.agent,
      content: `You have been invited to ${msg.channel}`
    }));
  }
}
