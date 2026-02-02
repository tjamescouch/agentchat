/**
 * AgentChat Server
 * WebSocket relay for agent-to-agent communication
 */

import { WebSocketServer } from 'ws';
import {
  ClientMessageType,
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  validateClientMessage,
  generateAgentId,
  serialize,
  isChannel,
  isAgent,
  isValidChannel
} from './protocol.js';

export class AgentChatServer {
  constructor(options = {}) {
    this.port = options.port || 6667;
    this.host = options.host || '0.0.0.0';
    this.serverName = options.name || 'agentchat';
    this.logMessages = options.logMessages || false;

    // Rate limiting: 1 message per second per agent
    this.rateLimitMs = options.rateLimitMs || 1000;

    // State
    this.agents = new Map();      // ws -> agent info
    this.agentById = new Map();   // id -> ws
    this.channels = new Map();    // channel name -> channel info
    this.lastMessageTime = new Map(); // ws -> timestamp of last message
    
    // Create default channels
    this._createChannel('#general', false);
    this._createChannel('#agents', false);
    
    this.wss = null;
  }
  
  _createChannel(name, inviteOnly = false) {
    if (!this.channels.has(name)) {
      this.channels.set(name, {
        name,
        inviteOnly,
        invited: new Set(),
        agents: new Set()
      });
    }
    return this.channels.get(name);
  }
  
  _log(event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...data
    };
    console.error(JSON.stringify(entry));
  }
  
  _send(ws, msg) {
    if (ws.readyState === 1) { // OPEN
      ws.send(serialize(msg));
    }
  }
  
  _broadcast(channel, msg, excludeWs = null) {
    const ch = this.channels.get(channel);
    if (!ch) return;
    
    for (const ws of ch.agents) {
      if (ws !== excludeWs) {
        this._send(ws, msg);
      }
    }
  }
  
  _getAgentId(ws) {
    const agent = this.agents.get(ws);
    return agent ? `@${agent.id}` : null;
  }
  
  start() {
    this.wss = new WebSocketServer({ 
      port: this.port, 
      host: this.host 
    });
    
    this._log('server_start', { port: this.port, host: this.host });
    
    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      this._log('connection', { ip });
      
      ws.on('message', (data) => {
        this._handleMessage(ws, data.toString());
      });
      
      ws.on('close', () => {
        this._handleDisconnect(ws);
      });
      
      ws.on('error', (err) => {
        this._log('ws_error', { error: err.message });
      });
    });
    
    this.wss.on('error', (err) => {
      this._log('server_error', { error: err.message });
    });
    
    return this;
  }
  
  stop() {
    if (this.wss) {
      this.wss.close();
      this._log('server_stop');
    }
  }
  
  _handleMessage(ws, data) {
    const { valid, msg, error } = validateClientMessage(data);
    
    if (!valid) {
      this._send(ws, createError(ErrorCode.INVALID_MSG, error));
      return;
    }
    
    if (this.logMessages) {
      this._log('message', { type: msg.type, from: this._getAgentId(ws) });
    }
    
    switch (msg.type) {
      case ClientMessageType.IDENTIFY:
        this._handleIdentify(ws, msg);
        break;
      case ClientMessageType.JOIN:
        this._handleJoin(ws, msg);
        break;
      case ClientMessageType.LEAVE:
        this._handleLeave(ws, msg);
        break;
      case ClientMessageType.MSG:
        this._handleMsg(ws, msg);
        break;
      case ClientMessageType.LIST_CHANNELS:
        this._handleListChannels(ws);
        break;
      case ClientMessageType.LIST_AGENTS:
        this._handleListAgents(ws, msg);
        break;
      case ClientMessageType.CREATE_CHANNEL:
        this._handleCreateChannel(ws, msg);
        break;
      case ClientMessageType.INVITE:
        this._handleInvite(ws, msg);
        break;
      case ClientMessageType.PING:
        this._send(ws, createMessage(ServerMessageType.PONG));
        break;
    }
  }
  
  _handleIdentify(ws, msg) {
    // Check if already identified
    if (this.agents.has(ws)) {
      this._send(ws, createError(ErrorCode.INVALID_MSG, 'Already identified'));
      return;
    }
    
    const id = generateAgentId();
    const agent = {
      id,
      name: msg.name,
      pubkey: msg.pubkey || null,
      channels: new Set(),
      connectedAt: Date.now()
    };
    
    this.agents.set(ws, agent);
    this.agentById.set(id, ws);
    
    this._log('identify', { id, name: msg.name });
    
    this._send(ws, createMessage(ServerMessageType.WELCOME, {
      agent_id: `@${id}`,
      server: this.serverName
    }));
  }
  
  _handleJoin(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }
    
    const channel = this.channels.get(msg.channel);
    if (!channel) {
      this._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
      return;
    }
    
    // Check invite-only
    if (channel.inviteOnly && !channel.invited.has(agent.id)) {
      this._send(ws, createError(ErrorCode.NOT_INVITED, `Channel ${msg.channel} is invite-only`));
      return;
    }
    
    // Add to channel
    channel.agents.add(ws);
    agent.channels.add(msg.channel);
    
    this._log('join', { agent: agent.id, channel: msg.channel });
    
    // Notify others
    this._broadcast(msg.channel, createMessage(ServerMessageType.AGENT_JOINED, {
      channel: msg.channel,
      agent: `@${agent.id}`
    }), ws);
    
    // Send confirmation with agent list
    const agentList = [];
    for (const memberWs of channel.agents) {
      const member = this.agents.get(memberWs);
      if (member) agentList.push(`@${member.id}`);
    }
    
    this._send(ws, createMessage(ServerMessageType.JOINED, {
      channel: msg.channel,
      agents: agentList
    }));
  }
  
  _handleLeave(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }
    
    const channel = this.channels.get(msg.channel);
    if (!channel) return;
    
    channel.agents.delete(ws);
    agent.channels.delete(msg.channel);
    
    this._log('leave', { agent: agent.id, channel: msg.channel });
    
    // Notify others
    this._broadcast(msg.channel, createMessage(ServerMessageType.AGENT_LEFT, {
      channel: msg.channel,
      agent: `@${agent.id}`
    }));
    
    this._send(ws, createMessage(ServerMessageType.LEFT, {
      channel: msg.channel
    }));
  }
  
  _handleMsg(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    // Rate limiting: 1 message per second per agent
    const now = Date.now();
    const lastTime = this.lastMessageTime.get(ws) || 0;
    if (now - lastTime < this.rateLimitMs) {
      this._send(ws, createError(ErrorCode.RATE_LIMITED, 'Rate limit exceeded (max 1 message per second)'));
      return;
    }
    this.lastMessageTime.set(ws, now);

    const outMsg = createMessage(ServerMessageType.MSG, {
      from: `@${agent.id}`,
      to: msg.to,
      content: msg.content
    });
    
    if (isChannel(msg.to)) {
      // Channel message
      const channel = this.channels.get(msg.to);
      if (!channel) {
        this._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.to} not found`));
        return;
      }
      
      if (!agent.channels.has(msg.to)) {
        this._send(ws, createError(ErrorCode.NOT_INVITED, `Not a member of ${msg.to}`));
        return;
      }
      
      // Broadcast to channel including sender
      this._broadcast(msg.to, outMsg);
      
    } else if (isAgent(msg.to)) {
      // Direct message
      const targetId = msg.to.slice(1); // remove @
      const targetWs = this.agentById.get(targetId);
      
      if (!targetWs) {
        this._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.to} not found`));
        return;
      }
      
      // Send to target
      this._send(targetWs, outMsg);
      // Echo back to sender
      this._send(ws, outMsg);
    }
  }
  
  _handleListChannels(ws) {
    const list = [];
    for (const [name, channel] of this.channels) {
      if (!channel.inviteOnly) {
        list.push({
          name,
          agents: channel.agents.size
        });
      }
    }
    
    this._send(ws, createMessage(ServerMessageType.CHANNELS, { list }));
  }
  
  _handleListAgents(ws, msg) {
    const channel = this.channels.get(msg.channel);
    if (!channel) {
      this._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
      return;
    }
    
    const list = [];
    for (const memberWs of channel.agents) {
      const member = this.agents.get(memberWs);
      if (member) list.push(`@${member.id}`);
    }
    
    this._send(ws, createMessage(ServerMessageType.AGENTS, {
      channel: msg.channel,
      list
    }));
  }
  
  _handleCreateChannel(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }
    
    if (this.channels.has(msg.channel)) {
      this._send(ws, createError(ErrorCode.CHANNEL_EXISTS, `Channel ${msg.channel} already exists`));
      return;
    }
    
    const channel = this._createChannel(msg.channel, msg.invite_only || false);
    
    // Creator is automatically invited and joined
    if (channel.inviteOnly) {
      channel.invited.add(agent.id);
    }
    
    this._log('create_channel', { agent: agent.id, channel: msg.channel, inviteOnly: channel.inviteOnly });
    
    // Auto-join creator
    channel.agents.add(ws);
    agent.channels.add(msg.channel);
    
    this._send(ws, createMessage(ServerMessageType.JOINED, {
      channel: msg.channel,
      agents: [`@${agent.id}`]
    }));
  }
  
  _handleInvite(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }
    
    const channel = this.channels.get(msg.channel);
    if (!channel) {
      this._send(ws, createError(ErrorCode.CHANNEL_NOT_FOUND, `Channel ${msg.channel} not found`));
      return;
    }
    
    // Must be a member to invite
    if (!agent.channels.has(msg.channel)) {
      this._send(ws, createError(ErrorCode.NOT_INVITED, `Not a member of ${msg.channel}`));
      return;
    }
    
    const targetId = msg.agent.slice(1); // remove @
    channel.invited.add(targetId);
    
    this._log('invite', { agent: agent.id, target: targetId, channel: msg.channel });
    
    // Notify target if connected
    const targetWs = this.agentById.get(targetId);
    if (targetWs) {
      this._send(targetWs, createMessage(ServerMessageType.MSG, {
        from: `@${agent.id}`,
        to: msg.agent,
        content: `You have been invited to ${msg.channel}`
      }));
    }
  }
  
  _handleDisconnect(ws) {
    const agent = this.agents.get(ws);
    if (!agent) return;

    this._log('disconnect', { agent: agent.id });

    // Leave all channels
    for (const channelName of agent.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        channel.agents.delete(ws);
        this._broadcast(channelName, createMessage(ServerMessageType.AGENT_LEFT, {
          channel: channelName,
          agent: `@${agent.id}`
        }));
      }
    }

    // Remove from state
    this.agentById.delete(agent.id);
    this.agents.delete(ws);
    this.lastMessageTime.delete(ws);
  }
}

// Allow running directly
export function startServer(options = {}) {
  const server = new AgentChatServer(options);
  server.start();
  
  console.log(`AgentChat server running on ws://${server.host}:${server.port}`);
  console.log('Default channels: #general, #agents');
  console.log('Press Ctrl+C to stop');
  
  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });
  
  return server;
}
