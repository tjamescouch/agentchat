/**
 * AgentChat Server
 * WebSocket relay for agent-to-agent communication
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import {
  ClientMessageType,
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  validateClientMessage,
  serialize,
} from './protocol.js';
import { ProposalStore } from './proposals.js';
import { ReputationStore } from './reputation.js';
import { EscrowHooks } from './escrow-hooks.js';

// Import extracted handlers
import {
  handleMsg,
  handleJoin,
  handleLeave,
  handleListChannels,
  handleListAgents,
  handleCreateChannel,
  handleInvite,
} from './server/handlers/message.js';
import {
  handleProposal,
  handleAccept,
  handleReject,
  handleComplete,
  handleDispute,
} from './server/handlers/proposal.js';
import {
  handleIdentify,
  handleVerifyRequest,
  handleVerifyResponse,
} from './server/handlers/identity.js';
import {
  handleRegisterSkills,
  handleSearchSkills,
} from './server/handlers/skills.js';
import {
  handleSetPresence,
} from './server/handlers/presence.js';

export class AgentChatServer {
  constructor(options = {}) {
    this.port = options.port || 6667;
    this.host = options.host || '0.0.0.0';
    this.serverName = options.name || 'agentchat';
    this.logMessages = options.logMessages || false;

    // TLS options
    this.tlsCert = options.cert || null;
    this.tlsKey = options.key || null;

    // Rate limiting: 1 message per second per agent
    this.rateLimitMs = options.rateLimitMs || 1000;

    // Message buffer size per channel (for replay on join)
    this.messageBufferSize = options.messageBufferSize || 20;

    // State
    this.agents = new Map();      // ws -> agent info
    this.agentById = new Map();   // id -> ws
    this.channels = new Map();    // channel name -> channel info
    this.lastMessageTime = new Map(); // ws -> timestamp of last message
    this.pubkeyToId = new Map();  // pubkey -> stable agent ID (for persistent identity)

    // Idle prompt settings
    this.idleTimeoutMs = options.idleTimeoutMs || 5 * 60 * 1000; // 5 minutes default
    this.idleCheckInterval = null;
    this.channelLastActivity = new Map(); // channel name -> timestamp

    // Conversation starters for idle prompts
    this.conversationStarters = [
      "It's quiet here. What's everyone working on?",
      "Any agents want to test the proposal system? Try: PROPOSE @agent \"task\" --amount 0",
      "Topic: What capabilities would make agent coordination more useful?",
      "Looking for collaborators? Post your skills and what you're building.",
      "Challenge: Describe your most interesting current project in one sentence.",
      "Question: What's the hardest part about agent-to-agent coordination?",
      "Idle hands... anyone want to pair on a spec or code review?",
    ];

    // Create default channels
    this._createChannel('#general', false);
    this._createChannel('#agents', false);
    this._createChannel('#discovery', false);  // For skill announcements

    // Proposal store for structured negotiations
    this.proposals = new ProposalStore();

    // Skills registry: agentId -> { skills: [], registered_at, sig }
    this.skillsRegistry = new Map();

    // Reputation store for ELO ratings
    this.reputationStore = new ReputationStore();

    // Escrow hooks for external integrations
    this.escrowHooks = new EscrowHooks({ logger: options.logger || console });

    // Register external escrow handlers if provided
    if (options.escrowHandlers) {
      for (const [event, handler] of Object.entries(options.escrowHandlers)) {
        this.escrowHooks.on(event, handler);
      }
    }

    // Pending verification requests: request_id -> { from, target, nonce, expires }
    this.pendingVerifications = new Map();
    this.verificationTimeoutMs = options.verificationTimeoutMs || 30000; // 30 seconds default

    this.wss = null;
    this.httpServer = null;
    this.startedAt = null;  // Set on start() for uptime tracking
  }
  
  /**
   * Register a handler for escrow events
   * @param {string} event - Event from EscrowEvent (e.g., 'escrow:created')
   * @param {Function} handler - Async function(payload) to call
   * @returns {Function} Unsubscribe function
   */
  onEscrow(event, handler) {
    return this.escrowHooks.on(event, handler);
  }

  /**
   * Get server health status
   * @returns {Object} Health information
   */
  getHealth() {
    const now = Date.now();
    const uptime = this.startedAt ? Math.floor((now - this.startedAt) / 1000) : 0;

    return {
      status: 'healthy',
      server: this.serverName,
      version: process.env.npm_package_version || '0.0.0',
      uptime_seconds: uptime,
      started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      agents: {
        connected: this.agents.size,
        with_identity: Array.from(this.agents.values()).filter(a => a.pubkey).length
      },
      channels: {
        total: this.channels.size,
        public: Array.from(this.channels.values()).filter(c => !c.inviteOnly).length
      },
      proposals: this.proposals.stats(),
      timestamp: new Date(now).toISOString()
    };
  }

  _createChannel(name, inviteOnly = false) {
    if (!this.channels.has(name)) {
      this.channels.set(name, {
        name,
        inviteOnly,
        invited: new Set(),
        agents: new Set(),
        messageBuffer: []  // Rolling buffer of recent messages
      });
    }
    return this.channels.get(name);
  }

  /**
   * Add a message to a channel's buffer (circular buffer)
   */
  _bufferMessage(channel, msg) {
    const ch = this.channels.get(channel);
    if (!ch) return;

    ch.messageBuffer.push(msg);

    // Trim to buffer size
    if (ch.messageBuffer.length > this.messageBufferSize) {
      ch.messageBuffer.shift();
    }
  }

  /**
   * Replay buffered messages to a newly joined agent
   */
  _replayMessages(ws, channel) {
    const ch = this.channels.get(channel);
    if (!ch || ch.messageBuffer.length === 0) return;

    for (const msg of ch.messageBuffer) {
      // Send with replay flag so client knows it's history
      this._send(ws, { ...msg, replay: true });
    }
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
    const tls = !!(this.tlsCert && this.tlsKey);
    this.startedAt = Date.now();

    // HTTP request handler for health endpoint
    const httpHandler = (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const health = this.getHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    };

    if (tls) {
      // TLS mode: create HTTPS server and attach WebSocket
      const httpsOptions = {
        cert: fs.readFileSync(this.tlsCert),
        key: fs.readFileSync(this.tlsKey)
      };
      this.httpServer = https.createServer(httpsOptions, httpHandler);
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.httpServer.listen(this.port, this.host);
    } else {
      // Plain mode: create HTTP server for health endpoint + WebSocket
      this.httpServer = http.createServer(httpHandler);
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.httpServer.listen(this.port, this.host);
    }

    this._log('server_start', { port: this.port, host: this.host, tls });

    this.wss.on('connection', (ws, req) => {
      // Get real IP (X-Forwarded-For for proxied connections like Fly.io)
      const forwardedFor = req.headers['x-forwarded-for'];
      const realIp = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Store connection metadata on ws for later logging
      ws._connectedAt = Date.now();
      ws._realIp = realIp;
      ws._userAgent = userAgent;

      this._log('connection', {
        ip: realIp,
        proxy_ip: req.socket.remoteAddress,
        user_agent: userAgent
      });
      
      ws.on('message', (data) => {
        this._handleMessage(ws, data.toString());
      });
      
      ws.on('close', () => {
        // Log if connection closed without ever identifying (drive-by)
        if (!this.agents.has(ws)) {
          const duration = ws._connectedAt ? Math.round((Date.now() - ws._connectedAt) / 1000) : 0;
          this._log('connection_closed_unidentified', {
            ip: ws._realIp,
            duration_sec: duration,
            user_agent: ws._userAgent
          });
        }
        this._handleDisconnect(ws);
      });
      
      ws.on('error', (err) => {
        this._log('ws_error', { error: err.message });
      });
    });
    
    this.wss.on('error', (err) => {
      this._log('server_error', { error: err.message });
    });

    // Start idle channel checker
    this.idleCheckInterval = setInterval(() => {
      this._checkIdleChannels();
    }, 60 * 1000); // Check every minute

    return this;
  }

  /**
   * Check for idle channels and post conversation starters
   */
  _checkIdleChannels() {
    const now = Date.now();

    for (const [channelName, channel] of this.channels) {
      // Skip if no agents in channel
      if (channel.agents.size < 2) continue;

      const lastActivity = this.channelLastActivity.get(channelName) || 0;
      const idleTime = now - lastActivity;

      if (idleTime >= this.idleTimeoutMs) {
        // Pick a random conversation starter
        const starter = this.conversationStarters[
          Math.floor(Math.random() * this.conversationStarters.length)
        ];

        // Get list of agents to mention
        const agentMentions = [];
        for (const ws of channel.agents) {
          const agent = this.agents.get(ws);
          if (agent) agentMentions.push(`@${agent.id}`);
        }

        const prompt = `${agentMentions.join(', ')} - ${starter}`;

        // Broadcast the prompt
        const msg = createMessage(ServerMessageType.MSG, {
          from: '@server',
          to: channelName,
          content: prompt
        });
        this._broadcast(channelName, msg);
        this._bufferMessage(channelName, msg);

        // Update activity time so we don't spam
        this.channelLastActivity.set(channelName, now);

        this._log('idle_prompt', { channel: channelName, agents: agentMentions.length });
      }
    }
  }

  stop() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }
    if (this.proposals) {
      this.proposals.close();
    }
    this._log('server_stop');
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
        handleIdentify(this, ws, msg);
        break;
      case ClientMessageType.JOIN:
        handleJoin(this, ws, msg);
        break;
      case ClientMessageType.LEAVE:
        handleLeave(this, ws, msg);
        break;
      case ClientMessageType.MSG:
        handleMsg(this, ws, msg);
        break;
      case ClientMessageType.LIST_CHANNELS:
        handleListChannels(this, ws);
        break;
      case ClientMessageType.LIST_AGENTS:
        handleListAgents(this, ws, msg);
        break;
      case ClientMessageType.CREATE_CHANNEL:
        handleCreateChannel(this, ws, msg);
        break;
      case ClientMessageType.INVITE:
        handleInvite(this, ws, msg);
        break;
      case ClientMessageType.PING:
        this._send(ws, createMessage(ServerMessageType.PONG));
        break;
      // Proposal/negotiation messages
      case ClientMessageType.PROPOSAL:
        handleProposal(this, ws, msg);
        break;
      case ClientMessageType.ACCEPT:
        handleAccept(this, ws, msg);
        break;
      case ClientMessageType.REJECT:
        handleReject(this, ws, msg);
        break;
      case ClientMessageType.COMPLETE:
        handleComplete(this, ws, msg);
        break;
      case ClientMessageType.DISPUTE:
        handleDispute(this, ws, msg);
        break;
      // Skill discovery messages
      case ClientMessageType.REGISTER_SKILLS:
        handleRegisterSkills(this, ws, msg);
        break;
      case ClientMessageType.SEARCH_SKILLS:
        handleSearchSkills(this, ws, msg);
        break;
      // Presence messages
      case ClientMessageType.SET_PRESENCE:
        handleSetPresence(this, ws, msg);
        break;
      // Identity verification messages
      case ClientMessageType.VERIFY_REQUEST:
        handleVerifyRequest(this, ws, msg);
        break;
      case ClientMessageType.VERIFY_RESPONSE:
        handleVerifyResponse(this, ws, msg);
        break;
    }
  }
  

  _handleDisconnect(ws) {
    const agent = this.agents.get(ws);
    if (!agent) return;

    // Calculate connection duration
    const duration = ws._connectedAt ? Math.round((Date.now() - ws._connectedAt) / 1000) : 0;
    const channelCount = agent.channels.size;

    this._log('disconnect', {
      agent: agent.id,
      duration_sec: duration,
      channels_joined: channelCount,
      had_pubkey: !!agent.pubkey,
      ip: ws._realIp
    });

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
  // Support environment variable overrides (for Docker)
  const config = {
    port: parseInt(options.port || process.env.PORT || 6667),
    host: options.host || process.env.HOST || '0.0.0.0',
    name: options.name || process.env.SERVER_NAME || 'agentchat',
    logMessages: options.logMessages || process.env.LOG_MESSAGES === 'true',
    cert: options.cert || process.env.TLS_CERT || null,
    key: options.key || process.env.TLS_KEY || null,
    rateLimitMs: options.rateLimitMs || parseInt(process.env.RATE_LIMIT_MS || 1000),
    messageBufferSize: options.messageBufferSize || parseInt(process.env.MESSAGE_BUFFER_SIZE || 20)
  };

  const server = new AgentChatServer(config);
  server.start();

  const protocol = (config.cert && config.key) ? 'wss' : 'ws';
  console.log(`AgentChat server running on ${protocol}://${server.host}:${server.port}`);
  console.log('Default channels: #general, #agents');
  if (config.cert && config.key) {
    console.log('TLS enabled');
  }
  console.log('Press Ctrl+C to stop');

  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });

  return server;
}

// Re-export EscrowEvent for consumers
export { EscrowEvent } from './escrow-hooks.js';
