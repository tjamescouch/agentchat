/**
 * AgentChat Client
 * Connect to agentchat servers from Node.js or CLI
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  ClientMessageType,
  ServerMessageType,
  createMessage,
  serialize,
  parse
} from './protocol.js';

export class AgentChatClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.server = options.server;
    this.name = options.name || `agent-${Date.now()}`;
    this.pubkey = options.pubkey || null;
    
    this.ws = null;
    this.agentId = null;
    this.connected = false;
    this.channels = new Set();
    
    this._pendingRequests = new Map();
    this._requestId = 0;
  }
  
  /**
   * Connect to the server and identify
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.server);
      
      this.ws.on('open', () => {
        // Send identify
        this._send({
          type: ClientMessageType.IDENTIFY,
          name: this.name,
          pubkey: this.pubkey
        });
      });
      
      this.ws.on('message', (data) => {
        this._handleMessage(data.toString());
      });
      
      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnect');
      });
      
      this.ws.on('error', (err) => {
        this.emit('error', err);
        if (!this.connected) {
          reject(err);
        }
      });
      
      // Wait for WELCOME
      this.once('welcome', (info) => {
        this.connected = true;
        this.agentId = info.agent_id;
        resolve(info);
      });
      
      // Handle connection error
      this.once('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }
  
  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  /**
   * Join a channel
   */
  async join(channel) {
    this._send({
      type: ClientMessageType.JOIN,
      channel
    });
    
    return new Promise((resolve, reject) => {
      const onJoined = (msg) => {
        if (msg.channel === channel) {
          this.removeListener('error', onError);
          this.channels.add(channel);
          resolve(msg);
        }
      };
      
      const onError = (msg) => {
        this.removeListener('joined', onJoined);
        reject(new Error(msg.message));
      };
      
      this.once('joined', onJoined);
      this.once('error', onError);
    });
  }
  
  /**
   * Leave a channel
   */
  async leave(channel) {
    this._send({
      type: ClientMessageType.LEAVE,
      channel
    });
    this.channels.delete(channel);
  }
  
  /**
   * Send a message to a channel or agent
   */
  async send(to, content) {
    this._send({
      type: ClientMessageType.MSG,
      to,
      content
    });
  }
  
  /**
   * Send a direct message (alias for send with @target)
   */
  async dm(agent, content) {
    const target = agent.startsWith('@') ? agent : `@${agent}`;
    return this.send(target, content);
  }
  
  /**
   * List available channels
   */
  async listChannels() {
    this._send({
      type: ClientMessageType.LIST_CHANNELS
    });
    
    return new Promise((resolve) => {
      this.once('channels', (msg) => {
        resolve(msg.list);
      });
    });
  }
  
  /**
   * List agents in a channel
   */
  async listAgents(channel) {
    this._send({
      type: ClientMessageType.LIST_AGENTS,
      channel
    });
    
    return new Promise((resolve) => {
      this.once('agents', (msg) => {
        resolve(msg.list);
      });
    });
  }
  
  /**
   * Create a new channel
   */
  async createChannel(channel, inviteOnly = false) {
    this._send({
      type: ClientMessageType.CREATE_CHANNEL,
      channel,
      invite_only: inviteOnly
    });
    
    return new Promise((resolve, reject) => {
      const onJoined = (msg) => {
        if (msg.channel === channel) {
          this.removeListener('error', onError);
          this.channels.add(channel);
          resolve(msg);
        }
      };
      
      const onError = (msg) => {
        this.removeListener('joined', onJoined);
        reject(new Error(msg.message));
      };
      
      this.once('joined', onJoined);
      this.once('error', onError);
    });
  }
  
  /**
   * Invite an agent to a channel
   */
  async invite(channel, agent) {
    const target = agent.startsWith('@') ? agent : `@${agent}`;
    this._send({
      type: ClientMessageType.INVITE,
      channel,
      agent: target
    });
  }
  
  /**
   * Send ping to server
   */
  ping() {
    this._send({ type: ClientMessageType.PING });
  }
  
  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serialize(msg));
    }
  }
  
  _handleMessage(data) {
    let msg;
    try {
      msg = parse(data);
    } catch (e) {
      this.emit('error', { message: 'Invalid JSON from server' });
      return;
    }
    
    // Emit raw message
    this.emit('raw', msg);
    
    // Handle by type
    switch (msg.type) {
      case ServerMessageType.WELCOME:
        this.emit('welcome', msg);
        break;
        
      case ServerMessageType.MSG:
        this.emit('message', msg);
        break;
        
      case ServerMessageType.JOINED:
        this.emit('joined', msg);
        break;
        
      case ServerMessageType.LEFT:
        this.emit('left', msg);
        break;
        
      case ServerMessageType.AGENT_JOINED:
        this.emit('agent_joined', msg);
        break;
        
      case ServerMessageType.AGENT_LEFT:
        this.emit('agent_left', msg);
        break;
        
      case ServerMessageType.CHANNELS:
        this.emit('channels', msg);
        break;
        
      case ServerMessageType.AGENTS:
        this.emit('agents', msg);
        break;
        
      case ServerMessageType.ERROR:
        this.emit('error', msg);
        break;
        
      case ServerMessageType.PONG:
        this.emit('pong', msg);
        break;
    }
  }
}

/**
 * Quick send - connect, send message, disconnect
 */
export async function quickSend(server, name, to, content) {
  const client = new AgentChatClient({ server, name });
  await client.connect();
  
  // Join channel if needed
  if (to.startsWith('#')) {
    await client.join(to);
  }
  
  await client.send(to, content);
  
  // Small delay to ensure message is sent
  await new Promise(r => setTimeout(r, 100));
  
  client.disconnect();
}

/**
 * Listen mode - connect, join channels, stream messages
 */
export async function listen(server, name, channels, callback) {
  const client = new AgentChatClient({ server, name });
  await client.connect();
  
  for (const channel of channels) {
    await client.join(channel);
  }
  
  client.on('message', callback);
  client.on('agent_joined', callback);
  client.on('agent_left', callback);
  
  return client;
}
