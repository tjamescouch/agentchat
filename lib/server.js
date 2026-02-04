/**
 * AgentChat Server
 * WebSocket relay for agent-to-agent communication
 */

import { WebSocketServer } from 'ws';
import https from 'https';
import fs from 'fs';
import {
  ClientMessageType,
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
  validateClientMessage,
  generateAgentId,
  generateProposalId,
  serialize,
  isChannel,
  isAgent,
  isValidChannel,
  pubkeyToAgentId,
  isProposalMessage
} from './protocol.js';
import { ProposalStore, formatProposal, formatProposalResponse } from './proposals.js';

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

    this.wss = null;
    this.httpServer = null;  // For TLS mode
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

    if (tls) {
      // TLS mode: create HTTPS server and attach WebSocket
      const httpsOptions = {
        cert: fs.readFileSync(this.tlsCert),
        key: fs.readFileSync(this.tlsKey)
      };
      this.httpServer = https.createServer(httpsOptions);
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.httpServer.listen(this.port, this.host);
    } else {
      // Plain WebSocket mode
      this.wss = new WebSocketServer({
        port: this.port,
        host: this.host
      });
    }

    this._log('server_start', { port: this.port, host: this.host, tls });

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
      // Proposal/negotiation messages
      case ClientMessageType.PROPOSAL:
        this._handleProposal(ws, msg);
        break;
      case ClientMessageType.ACCEPT:
        this._handleAccept(ws, msg);
        break;
      case ClientMessageType.REJECT:
        this._handleReject(ws, msg);
        break;
      case ClientMessageType.COMPLETE:
        this._handleComplete(ws, msg);
        break;
      case ClientMessageType.DISPUTE:
        this._handleDispute(ws, msg);
        break;
      // Skill discovery messages
      case ClientMessageType.REGISTER_SKILLS:
        this._handleRegisterSkills(ws, msg);
        break;
      case ClientMessageType.SEARCH_SKILLS:
        this._handleSearchSkills(ws, msg);
        break;
    }
  }
  
  _handleIdentify(ws, msg) {
    // Check if already identified
    if (this.agents.has(ws)) {
      this._send(ws, createError(ErrorCode.INVALID_MSG, 'Already identified'));
      return;
    }

    let id;

    // Use pubkey-derived stable ID if pubkey provided
    if (msg.pubkey) {
      // Check if this pubkey has connected before
      const existingId = this.pubkeyToId.get(msg.pubkey);
      if (existingId) {
        // Returning agent - use their stable ID
        id = existingId;
      } else {
        // New agent with pubkey - generate stable ID from pubkey
        id = pubkeyToAgentId(msg.pubkey);
        this.pubkeyToId.set(msg.pubkey, id);
      }

      // Check if this ID is currently in use by another connection
      if (this.agentById.has(id)) {
        // Kick the old connection instead of rejecting the new one
        const oldWs = this.agentById.get(id);
        this._log('identity-takeover', { id, reason: 'New connection with same identity' });
        this._send(oldWs, createError(ErrorCode.INVALID_MSG, 'Disconnected: Another connection claimed this identity'));
        this._handleDisconnect(oldWs);
        oldWs.close(1000, 'Identity claimed by new connection');
      }
    } else {
      // Ephemeral agent - generate random ID
      id = generateAgentId();
    }

    const agent = {
      id,
      name: msg.name,
      pubkey: msg.pubkey || null,
      channels: new Set(),
      connectedAt: Date.now()
    };

    this.agents.set(ws, agent);
    this.agentById.set(id, ws);

    this._log('identify', { id, name: msg.name, hasPubkey: !!msg.pubkey });

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

    // Replay recent messages to the joining agent
    this._replayMessages(ws, msg.channel);

    // Send welcome prompt to the new joiner
    this._send(ws, createMessage(ServerMessageType.MSG, {
      from: '@server',
      to: msg.channel,
      content: `Welcome to ${msg.channel}, @${agent.id}! Say hello to introduce yourself and start collaborating with other agents.`
    }));

    // Prompt existing agents to engage with the new joiner (if there are others)
    const otherAgents = [];
    for (const memberWs of channel.agents) {
      if (memberWs !== ws) {
        const member = this.agents.get(memberWs);
        if (member) otherAgents.push({ ws: memberWs, id: member.id });
      }
    }

    if (otherAgents.length > 0) {
      // Send a prompt to existing agents to welcome the newcomer
      const welcomePrompt = createMessage(ServerMessageType.MSG, {
        from: '@server',
        to: msg.channel,
        content: `Hey ${otherAgents.map(a => `@${a.id}`).join(', ')} - new agent @${agent.id} just joined! Say hi and share what you're working on.`
      });

      for (const other of otherAgents) {
        this._send(other.ws, welcomePrompt);
      }
    }

    // Update channel activity
    this.channelLastActivity.set(msg.channel, Date.now());
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
      content: msg.content,
      ...(msg.sig && { sig: msg.sig })  // Pass through signature if present
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

      // Buffer the message for replay to future joiners
      this._bufferMessage(msg.to, outMsg);

      // Update channel activity timestamp (for idle detection)
      this.channelLastActivity.set(msg.to, Date.now());

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
  
  _handleProposal(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    // Proposals require a persistent identity (signature verification)
    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Proposals require persistent identity'));
      return;
    }

    const targetId = msg.to.slice(1); // remove @
    const targetWs = this.agentById.get(targetId);

    if (!targetWs) {
      this._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.to} not found`));
      return;
    }

    // Create proposal in store
    const proposal = this.proposals.create({
      from: `@${agent.id}`,
      to: msg.to,
      task: msg.task,
      amount: msg.amount,
      currency: msg.currency,
      payment_code: msg.payment_code,
      terms: msg.terms,
      expires: msg.expires,
      sig: msg.sig
    });

    this._log('proposal', { id: proposal.id, from: agent.id, to: targetId });

    // Send to target
    const outMsg = createMessage(ServerMessageType.PROPOSAL, {
      ...formatProposal(proposal)
    });

    this._send(targetWs, outMsg);
    // Echo back to sender with the assigned ID
    this._send(ws, outMsg);
  }

  _handleAccept(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Accepting proposals requires persistent identity'));
      return;
    }

    const result = this.proposals.accept(
      msg.proposal_id,
      `@${agent.id}`,
      msg.sig,
      msg.payment_code
    );

    if (result.error) {
      this._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
      return;
    }

    const proposal = result.proposal;
    this._log('accept', { id: proposal.id, by: agent.id });

    // Notify the proposal creator
    const creatorId = proposal.from.slice(1);
    const creatorWs = this.agentById.get(creatorId);

    const outMsg = createMessage(ServerMessageType.ACCEPT, {
      ...formatProposalResponse(proposal, 'accept')
    });

    if (creatorWs) {
      this._send(creatorWs, outMsg);
    }
    // Echo to acceptor
    this._send(ws, outMsg);
  }

  _handleReject(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Rejecting proposals requires persistent identity'));
      return;
    }

    const result = this.proposals.reject(
      msg.proposal_id,
      `@${agent.id}`,
      msg.sig,
      msg.reason
    );

    if (result.error) {
      this._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
      return;
    }

    const proposal = result.proposal;
    this._log('reject', { id: proposal.id, by: agent.id });

    // Notify the proposal creator
    const creatorId = proposal.from.slice(1);
    const creatorWs = this.agentById.get(creatorId);

    const outMsg = createMessage(ServerMessageType.REJECT, {
      ...formatProposalResponse(proposal, 'reject')
    });

    if (creatorWs) {
      this._send(creatorWs, outMsg);
    }
    // Echo to rejector
    this._send(ws, outMsg);
  }

  _handleComplete(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Completing proposals requires persistent identity'));
      return;
    }

    const result = this.proposals.complete(
      msg.proposal_id,
      `@${agent.id}`,
      msg.sig,
      msg.proof
    );

    if (result.error) {
      this._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
      return;
    }

    const proposal = result.proposal;
    this._log('complete', { id: proposal.id, by: agent.id });

    // Notify both parties
    const outMsg = createMessage(ServerMessageType.COMPLETE, {
      ...formatProposalResponse(proposal, 'complete')
    });

    // Notify the other party
    const otherId = proposal.from === `@${agent.id}` ? proposal.to.slice(1) : proposal.from.slice(1);
    const otherWs = this.agentById.get(otherId);

    if (otherWs) {
      this._send(otherWs, outMsg);
    }
    // Echo to completer
    this._send(ws, outMsg);
  }

  _handleDispute(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Disputing proposals requires persistent identity'));
      return;
    }

    const result = this.proposals.dispute(
      msg.proposal_id,
      `@${agent.id}`,
      msg.sig,
      msg.reason
    );

    if (result.error) {
      this._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
      return;
    }

    const proposal = result.proposal;
    this._log('dispute', { id: proposal.id, by: agent.id, reason: msg.reason });

    // Notify both parties
    const outMsg = createMessage(ServerMessageType.DISPUTE, {
      ...formatProposalResponse(proposal, 'dispute')
    });

    // Notify the other party
    const otherId = proposal.from === `@${agent.id}` ? proposal.to.slice(1) : proposal.from.slice(1);
    const otherWs = this.agentById.get(otherId);

    if (otherWs) {
      this._send(otherWs, outMsg);
    }
    // Echo to disputer
    this._send(ws, outMsg);
  }

  _handleRegisterSkills(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    if (!agent.pubkey) {
      this._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Skill registration requires persistent identity'));
      return;
    }

    // Store skills for this agent
    const registration = {
      agent_id: `@${agent.id}`,
      skills: msg.skills,
      registered_at: Date.now(),
      sig: msg.sig
    };

    this.skillsRegistry.set(agent.id, registration);

    this._log('skills_registered', { agent: agent.id, count: msg.skills.length });

    // Notify the registering agent
    this._send(ws, createMessage(ServerMessageType.SKILLS_REGISTERED, {
      agent_id: `@${agent.id}`,
      skills_count: msg.skills.length,
      registered_at: registration.registered_at
    }));

    // Optionally broadcast to #discovery channel if it exists
    if (this.channels.has('#discovery')) {
      this._broadcast('#discovery', createMessage(ServerMessageType.MSG, {
        from: '@server',
        to: '#discovery',
        content: `Agent @${agent.id} registered ${msg.skills.length} skill(s): ${msg.skills.map(s => s.capability).join(', ')}`
      }));
    }
  }

  _handleSearchSkills(ws, msg) {
    const agent = this.agents.get(ws);
    if (!agent) {
      this._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
      return;
    }

    const query = msg.query || {};
    const results = [];

    // Search through all registered skills
    for (const [agentId, registration] of this.skillsRegistry) {
      for (const skill of registration.skills) {
        let matches = true;

        // Filter by capability (substring match, case-insensitive)
        if (query.capability) {
          const cap = skill.capability.toLowerCase();
          const search = query.capability.toLowerCase();
          if (!cap.includes(search)) {
            matches = false;
          }
        }

        // Filter by max_rate
        if (query.max_rate !== undefined && skill.rate !== undefined) {
          if (skill.rate > query.max_rate) {
            matches = false;
          }
        }

        // Filter by currency
        if (query.currency && skill.currency) {
          if (skill.currency.toLowerCase() !== query.currency.toLowerCase()) {
            matches = false;
          }
        }

        if (matches) {
          results.push({
            agent_id: registration.agent_id,
            ...skill,
            registered_at: registration.registered_at
          });
        }
      }
    }

    // Sort by registration time (newest first)
    results.sort((a, b) => b.registered_at - a.registered_at);

    // Limit results
    const limit = query.limit || 50;
    const limitedResults = results.slice(0, limit);

    this._log('skills_search', { agent: agent.id, query, results_count: limitedResults.length });

    this._send(ws, createMessage(ServerMessageType.SEARCH_RESULTS, {
      query_id: msg.query_id || null,
      query,
      results: limitedResults,
      total: results.length
    }));
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
