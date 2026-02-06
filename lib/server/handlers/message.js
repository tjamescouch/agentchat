/**
 * Message Handlers
 * Handles message routing, join, leave, and channel operations
 */

import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  isChannel,
  isAgent,
} from '../../protocol.js';

/**
 * Handle MSG command - route messages to channels or agents
 */
export function handleMsg(server, ws, msg) {
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
export function handleJoin(server, ws, msg) {
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

  // Add to channel
  channel.agents.add(ws);
  agent.channels.add(msg.channel);

  server._log('join', { agent: agent.id, channel: msg.channel });

  // Notify others
  server._broadcast(msg.channel, createMessage(ServerMessageType.AGENT_JOINED, {
    channel: msg.channel,
    agent: `@${agent.id}`
  }), ws);

  // Send confirmation with agent list
  const agentList = [];
  for (const memberWs of channel.agents) {
    const member = server.agents.get(memberWs);
    if (member) agentList.push(`@${member.id}`);
  }

  server._send(ws, createMessage(ServerMessageType.JOINED, {
    channel: msg.channel,
    agents: agentList
  }));

  // Replay recent messages to the joining agent
  server._replayMessages(ws, msg.channel);

  // Send welcome prompt to the new joiner
  server._send(ws, createMessage(ServerMessageType.MSG, {
    from: '@server',
    to: msg.channel,
    content: `Welcome to ${msg.channel}, @${agent.id}! Say hello to introduce yourself and start collaborating with other agents.`
  }));

  // Prompt existing agents to engage with the new joiner (if there are others)
  const otherAgents = [];
  for (const memberWs of channel.agents) {
    if (memberWs !== ws) {
      const member = server.agents.get(memberWs);
      if (member) otherAgents.push({ ws: memberWs, id: member.id });
    }
  }

  if (otherAgents.length > 0) {
    const welcomePrompt = createMessage(ServerMessageType.MSG, {
      from: '@server',
      to: msg.channel,
      content: `Hey ${otherAgents.map(a => `@${a.id}`).join(', ')} - new agent @${agent.id} just joined! Say hi and share what you're working on.`
    });

    for (const other of otherAgents) {
      server._send(other.ws, welcomePrompt);
    }
  }

  // Update channel activity
  server.channelLastActivity.set(msg.channel, Date.now());
}

/**
 * Handle LEAVE command - remove agent from channel
 */
export function handleLeave(server, ws, msg) {
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
    agent: `@${agent.id}`
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
export function handleListChannels(server, ws) {
  const agent = server.agents.get(ws);
  const list = [];
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
export function handleListAgents(server, ws, msg) {
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

  const list = [];
  for (const memberWs of channel.agents) {
    const member = server.agents.get(memberWs);
    if (member) {
      list.push({
        id: `@${member.id}`,
        name: member.name,
        presence: member.presence || 'online',
        status_text: member.statusText || null
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
export function handleCreateChannel(server, ws, msg) {
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
export function handleInvite(server, ws, msg) {
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
      to: msg.agent,
      content: `You have been invited to ${msg.channel}`
    }));
  }
}
