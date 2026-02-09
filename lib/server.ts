/**
 * AgentChat Server
 * WebSocket relay for agent-to-agent communication
 */

import { WebSocketServer, WebSocket } from 'ws';
import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import fs from 'fs';
import {
  ClientMessageType,
  ServerMessageType,
  ErrorCode,
  Skill,
  ClientMessage,
  ServerMessage,
  PresenceStatus,
  AnyMessage,
} from './types.js';
import { EscrowEventType } from './escrow-hooks.js';
import {
  createMessage,
  createError,
  validateClientMessage,
  serialize,
} from './protocol.js';
import { ProposalStore } from './proposals.js';
import { DisputeStore } from './disputes.js';
import { ReputationStore } from './reputation.js';
import { EscrowHooks } from './escrow-hooks.js';
import { Allowlist } from './allowlist.js';
import { Banlist } from './banlist.js';
import { Redactor } from './redactor.js';

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
  handleDisputeIntent,
  handleDisputeReveal,
  handleEvidence,
  handleArbiterAccept,
  handleArbiterDecline,
  handleArbiterVote,
} from './server/handlers/disputes.js';
import {
  handleIdentify,
  handleVerifyIdentity,
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
import {
  handleSetNick,
} from './server/handlers/nick.js';
import {
  handleAdminApprove,
  handleAdminRevoke,
  handleAdminList,
} from './server/handlers/admin.js';
import {
  handleAdminKick,
  handleAdminBan,
  handleAdminUnban,
} from './server/handlers/ban.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
  _msgTimestamps?: number[];
  _isAlive?: boolean;
}

// Agent info stored per connection
export interface AgentState {
  id: string;
  name?: string;
  nick?: string | null;
  channels: Set<string>;
  pubkey?: string | null;
  presence?: PresenceStatus | string;
  status_text?: string | null;
  connectedAt?: number;
  verified?: boolean;
}

// Pending challenge for challenge-response auth
export interface PendingChallenge {
  ws: ExtendedWebSocket;
  name: string;
  pubkey: string;
  nonce: string;
  challengeId: string;
  expires: number;
}

// Channel state
export interface ChannelState {
  name: string;
  inviteOnly: boolean;
  invited: Set<string>;
  agents: Set<ExtendedWebSocket>;
  messageBuffer: AnyMessage[];
}

// Skill registration entry
export interface SkillRegistration {
  skills: Skill[];
  registered_at: number;
  sig: string;
}

// Pending verification request
export interface PendingVerification {
  from: string;
  target: string;
  nonce: string;
  expires: number;
}

// Server options
export interface AgentChatServerOptions {
  port?: number;
  host?: string;
  name?: string;
  logMessages?: boolean;
  cert?: string | null;
  key?: string | null;
  rateLimitMs?: number;
  messageBufferSize?: number;
  idleTimeoutMs?: number;
  verificationTimeoutMs?: number;
  challengeTimeoutMs?: number;
  logger?: Console;
  escrowHandlers?: Record<string, (payload: unknown) => Promise<void>>;
  allowlistEnabled?: boolean;
  allowlistStrict?: boolean;
  allowlistAdminKey?: string | null;
  allowlistFilePath?: string;
  motd?: string;
  motdFile?: string;
  maxConnectionsPerIp?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

// Health status response
export interface HealthStatus {
  status: string;
  server: string;
  version: string;
  uptime_seconds: number;
  started_at: string | null;
  agents: {
    connected: number;
    with_identity: number;
  };
  channels: {
    total: number;
    public: number;
  };
  proposals: ReturnType<ProposalStore['stats']>;
  timestamp: string;
}

export class AgentChatServer {
  port: number;
  host: string;
  serverName: string;
  logMessages: boolean;

  // TLS options
  tlsCert: string | null;
  tlsKey: string | null;

  // Rate limiting
  rateLimitMs: number;

  // Message buffer size per channel
  messageBufferSize: number;

  // State
  agents: Map<ExtendedWebSocket, AgentState>;
  agentById: Map<string, ExtendedWebSocket>;
  channels: Map<string, ChannelState>;
  lastMessageTime: Map<ExtendedWebSocket, number>;
  pubkeyToId: Map<string, string>;

  // Idle prompt settings
  idleTimeoutMs: number;
  idleCheckInterval: NodeJS.Timeout | null;
  channelLastActivity: Map<string, number>;

  // Conversation starters
  conversationStarters: string[];

  // Proposal store
  proposals: ProposalStore;

  // Dispute store (Agentcourt)
  disputes: DisputeStore;

  // Skills registry
  skillsRegistry: Map<string, SkillRegistration>;

  // Reputation store
  reputationStore: ReputationStore;

  // Escrow hooks
  escrowHooks: EscrowHooks;

  // Pending verifications (inter-agent)
  pendingVerifications: Map<string, PendingVerification>;
  verificationTimeoutMs: number;

  // Pending challenges (challenge-response auth)
  pendingChallenges: Map<string, PendingChallenge>;
  challengeTimeoutMs: number;

  // Secret redactor (agentseenoevil)
  redactor: Redactor;

  // Allowlist
  allowlist: Allowlist | null;

  // Banlist
  banlist: Banlist | null;

  // MOTD (message of the day)
  motd: string | null;

  // Per-IP connection limiting
  maxConnectionsPerIp: number;
  connectionsByIp: Map<string, number>;

  // WebSocket heartbeat (server-initiated ping/pong)
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  heartbeatTimer: NodeJS.Timeout | null;

  wss: WebSocketServer | null;
  httpServer: http.Server | https.Server | null;
  startedAt: number | null;

  constructor(options: AgentChatServerOptions = {}) {
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
    this.agents = new Map();
    this.agentById = new Map();
    this.channels = new Map();
    this.lastMessageTime = new Map();
    this.pubkeyToId = new Map();

    // Idle prompt settings
    this.idleTimeoutMs = options.idleTimeoutMs || 5 * 60 * 1000; // 5 minutes default
    this.idleCheckInterval = null;
    this.channelLastActivity = new Map();

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
    this._createChannel('#engineering', false);
    this._createChannel('#pull-requests', false);
    this._createChannel('#help', false);
    this._createChannel('#love', false);
    this._createChannel('#agents', false);
    this._createChannel('#discovery', false);

    // Proposal store for structured negotiations
    this.proposals = new ProposalStore();
    this.disputes = new DisputeStore();

    // Skills registry
    this.skillsRegistry = new Map();

    // Reputation store for ELO ratings
    this.reputationStore = new ReputationStore();

    // Escrow hooks for external integrations
    this.escrowHooks = new EscrowHooks({ logger: options.logger || console });

    // Register external escrow handlers if provided
    if (options.escrowHandlers) {
      for (const [event, handler] of Object.entries(options.escrowHandlers)) {
        this.escrowHooks.on(event as EscrowEventType, handler);
      }
    }

    // Secret redactor — mandatory input sanitization (agentseenoevil)
    this.redactor = new Redactor({ builtins: true, scanEnv: true, labelRedactions: true });

    // Pending verification requests (inter-agent)
    this.pendingVerifications = new Map();
    this.verificationTimeoutMs = options.verificationTimeoutMs || 30000;

    // Pending challenges (challenge-response auth)
    this.pendingChallenges = new Map();
    this.challengeTimeoutMs = options.challengeTimeoutMs
      || parseInt(process.env.CHALLENGE_TIMEOUT_MS || '', 10)
      || 60000;

    // Allowlist
    const allowlistEnabled = options.allowlistEnabled || process.env.ALLOWLIST_ENABLED === 'true';
    if (allowlistEnabled) {
      this.allowlist = new Allowlist({
        enabled: true,
        strict: options.allowlistStrict || process.env.ALLOWLIST_STRICT === 'true',
        adminKey: options.allowlistAdminKey || process.env.ALLOWLIST_ADMIN_KEY || null,
        filePath: options.allowlistFilePath,
      });
    } else {
      this.allowlist = null;
    }

    // Banlist — uses same admin key as allowlist
    const banlistAdminKey = options.allowlistAdminKey || process.env.ALLOWLIST_ADMIN_KEY || null;
    if (banlistAdminKey) {
      this.banlist = new Banlist({ adminKey: banlistAdminKey });
    } else {
      this.banlist = null;
    }

    // MOTD — prefer inline string, fall back to file
    const motdFile = options.motdFile || process.env.MOTD_FILE || null;
    if (options.motd || process.env.MOTD) {
      this.motd = options.motd || process.env.MOTD || null;
    } else if (motdFile) {
      try {
        this.motd = fs.readFileSync(motdFile, 'utf-8').trim();
        this._log('motd_loaded', { file: motdFile, length: this.motd.length });
      } catch (err) {
        this._log('motd_error', { file: motdFile, error: (err as Error).message });
        this.motd = null;
      }
    } else {
      this.motd = null;
    }

    // Per-IP connection limiting
    this.maxConnectionsPerIp = options.maxConnectionsPerIp || parseInt(process.env.MAX_CONNECTIONS_PER_IP || '0');
    this.connectionsByIp = new Map();

    // WebSocket heartbeat
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000; // 30s
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;   // 10s
    this.heartbeatTimer = null;

    this.wss = null;
    this.httpServer = null;
    this.startedAt = null;
  }

  /**
   * Register a handler for escrow events
   */
  onEscrow(event: string, handler: (payload: unknown) => Promise<void>): () => void {
    return this.escrowHooks.on(event as EscrowEventType, handler);
  }

  /**
   * Get server health status
   */
  getHealth(): HealthStatus {
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

  _createChannel(name: string, inviteOnly: boolean = false): ChannelState {
    if (!this.channels.has(name)) {
      this.channels.set(name, {
        name,
        inviteOnly,
        invited: new Set(),
        agents: new Set(),
        messageBuffer: []
      });
    }
    return this.channels.get(name)!;
  }

  /**
   * Add a message to a channel's buffer (circular buffer)
   */
  _bufferMessage(channel: string, msg: AnyMessage): void {
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
  _replayMessages(ws: ExtendedWebSocket, channel: string): void {
    const ch = this.channels.get(channel);
    if (!ch || ch.messageBuffer.length === 0) return;

    for (const msg of ch.messageBuffer) {
      // Send with replay flag so client knows it's history
      this._send(ws, { ...msg, replay: true });
    }
  }

  _log(event: string, data: Record<string, unknown> = {}): void {
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...data
    };
    console.error(JSON.stringify(entry));
  }

  _send(ws: ExtendedWebSocket, msg: AnyMessage): void {
    if (ws.readyState === 1) { // OPEN
      ws.send(serialize(msg));
    }
  }

  _broadcast(channel: string, msg: AnyMessage, excludeWs: ExtendedWebSocket | null = null): void {
    const ch = this.channels.get(channel);
    if (!ch) return;

    for (const ws of ch.agents) {
      if (ws !== excludeWs) {
        this._send(ws, msg);
      }
    }
  }

  _getAgentId(ws: ExtendedWebSocket): string | null {
    const agent = this.agents.get(ws);
    return agent ? `@${agent.id}` : null;
  }

  start(): this {
    const tls = !!(this.tlsCert && this.tlsKey);
    this.startedAt = Date.now();

    // HTTP request handler for health endpoint
    const httpHandler = (req: IncomingMessage, res: ServerResponse): void => {
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
        cert: fs.readFileSync(this.tlsCert!),
        key: fs.readFileSync(this.tlsKey!)
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

    this.wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
      // Get real IP (X-Forwarded-For for proxied connections like Fly.io)
      const forwardedFor = req.headers['x-forwarded-for'];
      const forwardedForStr = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const realIp = forwardedForStr ? forwardedForStr.split(',')[0].trim() : req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Per-IP connection limiting
      if (this.maxConnectionsPerIp > 0 && realIp) {
        const current = this.connectionsByIp.get(realIp) || 0;
        if (current >= this.maxConnectionsPerIp) {
          this._log('ip_connection_limit', { ip: realIp, current, max: this.maxConnectionsPerIp });
          ws.close(1008, 'Too many connections from this IP');
          return;
        }
        this.connectionsByIp.set(realIp, current + 1);
      }

      // Store connection metadata on ws for later logging
      ws._connectedAt = Date.now();
      ws._realIp = realIp;
      ws._userAgent = userAgent;
      ws._isAlive = true;

      // WS-level pong handler for heartbeat
      ws.on('pong', () => {
        ws._isAlive = true;
      });

      this._log('connection', {
        ip: realIp,
        proxy_ip: req.socket.remoteAddress,
        user_agent: userAgent
      });

      ws.on('message', (data: Buffer) => {
        this._handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        // Decrement per-IP connection count
        if (ws._realIp && this.maxConnectionsPerIp > 0) {
          const current = this.connectionsByIp.get(ws._realIp) || 0;
          if (current <= 1) {
            this.connectionsByIp.delete(ws._realIp);
          } else {
            this.connectionsByIp.set(ws._realIp, current - 1);
          }
        }

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

      ws.on('error', (err: Error) => {
        this._log('ws_error', { error: err.message });
      });
    });

    this.wss.on('error', (err: Error) => {
      this._log('server_error', { error: err.message });
    });

    // Start idle channel checker
    this.idleCheckInterval = setInterval(() => {
      this._checkIdleChannels();
    }, 60 * 1000); // Check every minute

    // Start WebSocket heartbeat — detect and clean up zombie connections
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws: WebSocket) => {
        const ews = ws as ExtendedWebSocket;
        if (ews._isAlive === false) {
          this._log('heartbeat_timeout', {
            ip: ews._realIp,
            agent: this.agents.get(ews)?.id,
          });
          return ews.terminate();
        }
        ews._isAlive = false;
        ews.ping();
      });
    }, this.heartbeatIntervalMs);

    return this;
  }

  /**
   * Check for idle channels and post conversation starters
   */
  _checkIdleChannels(): void {
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
        const agentMentions: string[] = [];
        for (const ws of channel.agents) {
          const agent = this.agents.get(ws);
          if (agent) agentMentions.push(`@${agent.id}`);
        }

        const prompt = `${agentMentions.join(', ')} - ${starter}`;

        // Broadcast the prompt
        const msg = createMessage(ServerMessageType.MSG, {
          from: '@server',
          from_name: 'Server',
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

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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
      this.disputes.close();
    }
    this._log('server_stop');
  }

  _handleMessage(ws: ExtendedWebSocket, data: string): void {
    // Application-level message size limit (defense-in-depth for proxy bypass)
    const maxPayloadBytes = 256 * 1024; // 256KB - matches wsOptions.maxPayload
    if (data.length > maxPayloadBytes) {
      this._log('message_too_large', {
        ip: ws._realIp,
        size: data.length,
        max: maxPayloadBytes
      });
      this._send(ws, createError(ErrorCode.INVALID_MSG, `Message too large (${data.length} bytes, max ${maxPayloadBytes})`));
      return;
    }

    // Per-connection rate limiting (applies before auth check)
    const now = Date.now();
    if (!ws._msgTimestamps) ws._msgTimestamps = [];

    // Sliding window: keep only timestamps from last 10 seconds
    ws._msgTimestamps = ws._msgTimestamps.filter((t: number) => now - t < 10000);
    ws._msgTimestamps.push(now);

    const isIdentified = this.agents.has(ws);
    // Pre-auth: max 10 messages per 10s window (enough for IDENTIFY + JOINs)
    // Post-auth: max 60 messages per 10s window (existing MSG rate limit also applies)
    const maxMessages = isIdentified ? 60 : 10;

    if (ws._msgTimestamps.length > maxMessages) {
      if (!isIdentified) {
        this._log('pre_auth_rate_limit', {
          ip: ws._realIp,
          count: ws._msgTimestamps.length,
          window: '10s'
        });
        ws.close(1008, 'Rate limit exceeded');
        return;
      }
      this._send(ws, createError(ErrorCode.RATE_LIMITED, 'Too many messages'));
      return;
    }

    const result = validateClientMessage(data);

    if (!result.valid) {
      this._send(ws, createError(ErrorCode.INVALID_MSG, (result as { valid: false; error: string }).error));
      return;
    }

    const msg = result.msg;

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
      // Agentcourt dispute messages
      case ClientMessageType.DISPUTE_INTENT:
        handleDisputeIntent(this, ws, msg);
        break;
      case ClientMessageType.DISPUTE_REVEAL:
        handleDisputeReveal(this, ws, msg);
        break;
      case ClientMessageType.EVIDENCE:
        handleEvidence(this, ws, msg);
        break;
      case ClientMessageType.ARBITER_ACCEPT:
        handleArbiterAccept(this, ws, msg);
        break;
      case ClientMessageType.ARBITER_DECLINE:
        handleArbiterDecline(this, ws, msg);
        break;
      case ClientMessageType.ARBITER_VOTE:
        handleArbiterVote(this, ws, msg);
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
      // Challenge-response auth
      case ClientMessageType.VERIFY_IDENTITY:
        handleVerifyIdentity(this, ws, msg);
        break;
      // Nick
      case ClientMessageType.SET_NICK:
        handleSetNick(this, ws, msg);
        break;
      // Admin messages
      case ClientMessageType.ADMIN_APPROVE:
        handleAdminApprove(this, ws, msg);
        break;
      case ClientMessageType.ADMIN_REVOKE:
        handleAdminRevoke(this, ws, msg);
        break;
      case ClientMessageType.ADMIN_LIST:
        handleAdminList(this, ws, msg);
        break;
      // Moderation messages
      case ClientMessageType.ADMIN_KICK:
        handleAdminKick(this, ws, msg);
        break;
      case ClientMessageType.ADMIN_BAN:
        handleAdminBan(this, ws, msg);
        break;
      case ClientMessageType.ADMIN_UNBAN:
        handleAdminUnban(this, ws, msg);
        break;
      // Typing indicator
      case ClientMessageType.TYPING: {
        const typingAgent = this.agents.get(ws);
        if (!typingAgent || !msg.channel) break;
        const typingChannel = this.channels.get(msg.channel);
        if (!typingChannel) break;
        const typingMsg = createMessage(ServerMessageType.TYPING, {
          from: `@${typingAgent.id}`,
          from_name: typingAgent.name,
          channel: msg.channel
        });
        for (const memberWs of typingChannel.agents) {
          if (memberWs !== ws) this._send(memberWs, typingMsg);
        }
        break;
      }
    }
  }

  _handleDisconnect(ws: ExtendedWebSocket): void {
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
export function startServer(options: AgentChatServerOptions = {}): AgentChatServer {
  // Support environment variable overrides (for Docker)
  const config: AgentChatServerOptions = {
    port: parseInt(String(options.port || process.env.PORT || 6667)),
    host: options.host || process.env.HOST || '0.0.0.0',
    name: options.name || process.env.SERVER_NAME || 'agentchat',
    logMessages: options.logMessages || process.env.LOG_MESSAGES === 'true',
    cert: options.cert || process.env.TLS_CERT || null,
    key: options.key || process.env.TLS_KEY || null,
    rateLimitMs: options.rateLimitMs || parseInt(process.env.RATE_LIMIT_MS || '1000'),
    messageBufferSize: options.messageBufferSize || parseInt(process.env.MESSAGE_BUFFER_SIZE || '20')
  };

  const server = new AgentChatServer(config);
  server.start();

  const protocol = (config.cert && config.key) ? 'wss' : 'ws';
  console.log(`AgentChat server running on ${protocol}://${server.host}:${server.port}`);
  console.log('Default channels: #general, #engineering, #pull-requests, #help, #love, #agents, #discovery');
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
