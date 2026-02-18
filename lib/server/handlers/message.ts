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
  FileChunkMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  isChannel,
  isAgent,
} from '../../protocol.js';
import { parseCallbacks } from '../../callback-engine.js';

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

  // Lurk mode: ephemeral agents and new identities within 1-hour confirmation window cannot send
  if (server._isLurking(agent)) {
    const reason = agent.lurkUntil
      ? `New identity — sending unlocks at ${new Date(agent.lurkUntil).toISOString()}`
      : 'Persistent identity required to send messages';
    server._send(ws, createError(ErrorCode.LURK_MODE, reason));
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

  // Redact secrets from message content (agentseenoevil)
  const redactResult = server.redactor.redact(msg.content);
  if (redactResult.count > 0) {
    server._log('secrets_redacted', {
      agent: agent.id,
      matched: redactResult.matched,
      count: redactResult.count,
    });
  }

  // Parse and extract callback markers (@@cb:Ns@@payload)
  const cbResult = parseCallbacks(redactResult.text, agent.id);
  for (const cb of cbResult.callbacks) {
    const enqueued = server.callbackQueue.enqueue(cb);
    if (enqueued) {
      server._log('callback_scheduled', { id: cb.id, from: agent.id, delay_ms: cb.fireAt - Date.now(), target: cb.target });
    }
  }

  // Use cleaned content (callback markers stripped)
  const finalContent = cbResult.cleanContent;

  // If the message was entirely callback markers with no other content, don't route it
  if (!finalContent && cbResult.callbacks.length > 0) {
    return;
  }

  const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outMsg = createMessage(ServerMessageType.MSG, {
    from: `@${agent.id}`,
    from_name: agent.name,
    to: msg.to,
    content: finalContent || redactResult.text,
    msg_id: msgId,
    verified: !!agent.verified,
    ...(msg.sig && { sig: msg.sig }),
    ...(msg.in_reply_to && { in_reply_to: msg.in_reply_to }),
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

    // Release any floor claim by this agent (they're done responding)
    server.floorControl.release(agent.id, msg.to);

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

  // Check verified-only
  if (channel.verifiedOnly && !agent.verified) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, `Channel ${msg.channel} requires verified identity`));
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

    // AGENT_JOINED broadcast (above) already notifies existing members.
    // No additional engagement prompt — reduces token burn for MCP agents.
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
  const list: Array<{ name: string; agents: number; verifiedOnly?: boolean }> = [];
  for (const [name, channel] of server.channels) {
    if (!channel.inviteOnly) {
      list.push({
        name,
        agents: channel.agents.size,
        ...(channel.verifiedOnly && { verifiedOnly: true }),
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
export function handleCreateChannel(server: AgentChatServer, ws: ExtendedWebSocket, msg: CreateChannelMessage & { invite_only?: boolean; verified_only?: boolean }): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (server.channels.has(msg.channel)) {
    server._send(ws, createError(ErrorCode.CHANNEL_EXISTS, `Channel ${msg.channel} already exists`));
    return;
  }

  const channel = server._createChannel(msg.channel, msg.invite_only || false, msg.verified_only || false);

  // Creator is automatically invited and joined
  if (channel.inviteOnly) {
    channel.invited.add(agent.id);
  }

  server._log('create_channel', { agent: agent.id, channel: msg.channel, inviteOnly: channel.inviteOnly, verifiedOnly: channel.verifiedOnly });

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

/**
 * Handle FILE_CHUNK command - relay file transfer chunks between agents (DM only)
 */
export function handleFileChunk(server: AgentChatServer, ws: ExtendedWebSocket, msg: FileChunkMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // File chunk rate limit: 10 per second (separate from MSG rate limit)
  const now = Date.now();
  const lastChunkTime = server.lastFileChunkTime.get(ws) || 0;
  if (now - lastChunkTime < 100) {
    server._send(ws, createError(ErrorCode.RATE_LIMITED, 'File chunk rate limit (max 10/sec)'));
    return;
  }
  server.lastFileChunkTime.set(ws, now);

  const targetId = msg.to.slice(1);
  const targetWs = server.agentById.get(targetId);
  if (!targetWs) {
    server._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.to} not found`));
    return;
  }

  // Relay to target (no buffering, no redaction — file transfer data)
  const outMsg = createMessage(ServerMessageType.FILE_CHUNK, {
    from: `@${agent.id}`,
    to: msg.to,
    content: msg.content
  });
  server._send(targetWs, outMsg);
}
