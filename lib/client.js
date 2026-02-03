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
import { Identity } from './identity.js';
import {
  getProposalSigningContent,
  getAcceptSigningContent,
  getRejectSigningContent,
  getCompleteSigningContent,
  getDisputeSigningContent
} from './proposals.js';

export class AgentChatClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.server = options.server;
    this.name = options.name || `agent-${Date.now()}`;
    this.pubkey = options.pubkey || null;

    // Identity support
    this.identityPath = options.identity || null;
    this._identity = null;

    this.ws = null;
    this.agentId = null;
    this.connected = false;
    this.channels = new Set();

    this._pendingRequests = new Map();
    this._requestId = 0;
  }

  /**
   * Load identity from file
   */
  async _loadIdentity() {
    if (this.identityPath) {
      try {
        this._identity = await Identity.load(this.identityPath);
        this.name = this._identity.name;
        this.pubkey = this._identity.pubkey;
      } catch (err) {
        throw new Error(`Failed to load identity from ${this.identityPath}: ${err.message}`);
      }
    }
  }
  
  /**
   * Connect to the server and identify
   */
  async connect() {
    // Load identity if path provided
    await this._loadIdentity();

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
    const msg = {
      type: ClientMessageType.MSG,
      to,
      content
    };

    // Sign message if identity available
    if (this._identity && this._identity.privkey) {
      msg.ts = Date.now();
      const dataToSign = JSON.stringify({
        to: msg.to,
        content: msg.content,
        ts: msg.ts
      });
      msg.sig = this._identity.sign(dataToSign);
    }

    this._send(msg);
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

  // ===== PROPOSAL/NEGOTIATION METHODS =====

  /**
   * Send a proposal to another agent
   * Requires persistent identity for signing
   *
   * @param {string} to - Target agent (@id)
   * @param {object} proposal - Proposal details
   * @param {string} proposal.task - Description of the task/work
   * @param {number} [proposal.amount] - Payment amount
   * @param {string} [proposal.currency] - Currency (SOL, USDC, AKT, etc)
   * @param {string} [proposal.payment_code] - BIP47 payment code or address
   * @param {string} [proposal.terms] - Additional terms
   * @param {number} [proposal.expires] - Seconds until expiration
   */
  async propose(to, proposal) {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Proposals require persistent identity. Use --identity flag.');
    }

    const target = to.startsWith('@') ? to : `@${to}`;

    const msg = {
      type: ClientMessageType.PROPOSAL,
      to: target,
      task: proposal.task,
      amount: proposal.amount,
      currency: proposal.currency,
      payment_code: proposal.payment_code,
      terms: proposal.terms,
      expires: proposal.expires
    };

    // Sign the proposal
    const sigContent = getProposalSigningContent(msg);
    msg.sig = this._identity.sign(sigContent);

    this._send(msg);

    // Wait for the proposal response with ID
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('proposal', onProposal);
        this.removeListener('error', onError);
        reject(new Error('Proposal timeout'));
      }, 10000);

      const onProposal = (p) => {
        if (p.to === target && p.from === this.agentId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(p);
        }
      };

      const onError = (err) => {
        clearTimeout(timeout);
        this.removeListener('proposal', onProposal);
        reject(new Error(err.message));
      };

      this.once('proposal', onProposal);
      this.once('error', onError);
    });
  }

  /**
   * Accept a proposal
   * @param {string} proposalId - The proposal ID to accept
   * @param {string} [payment_code] - Your payment code for receiving payment
   */
  async accept(proposalId, payment_code = null) {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Accepting proposals requires persistent identity.');
    }

    const sigContent = getAcceptSigningContent(proposalId, payment_code || '');
    const sig = this._identity.sign(sigContent);

    const msg = {
      type: ClientMessageType.ACCEPT,
      proposal_id: proposalId,
      payment_code,
      sig
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('accept', onAccept);
        this.removeListener('error', onError);
        reject(new Error('Accept timeout'));
      }, 10000);

      const onAccept = (response) => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err) => {
        clearTimeout(timeout);
        this.removeListener('accept', onAccept);
        reject(new Error(err.message));
      };

      this.once('accept', onAccept);
      this.once('error', onError);
    });
  }

  /**
   * Reject a proposal
   * @param {string} proposalId - The proposal ID to reject
   * @param {string} [reason] - Reason for rejection
   */
  async reject(proposalId, reason = null) {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Rejecting proposals requires persistent identity.');
    }

    const sigContent = getRejectSigningContent(proposalId, reason || '');
    const sig = this._identity.sign(sigContent);

    const msg = {
      type: ClientMessageType.REJECT,
      proposal_id: proposalId,
      reason,
      sig
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('reject', onReject);
        this.removeListener('error', onError);
        reject(new Error('Reject timeout'));
      }, 10000);

      const onReject = (response) => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err) => {
        clearTimeout(timeout);
        this.removeListener('reject', onReject);
        reject(new Error(err.message));
      };

      this.once('reject', onReject);
      this.once('error', onError);
    });
  }

  /**
   * Mark a proposal as complete
   * @param {string} proposalId - The proposal ID to complete
   * @param {string} [proof] - Proof of completion (tx hash, URL, etc)
   */
  async complete(proposalId, proof = null) {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Completing proposals requires persistent identity.');
    }

    const sigContent = getCompleteSigningContent(proposalId, proof || '');
    const sig = this._identity.sign(sigContent);

    const msg = {
      type: ClientMessageType.COMPLETE,
      proposal_id: proposalId,
      proof,
      sig
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('complete', onComplete);
        this.removeListener('error', onError);
        reject(new Error('Complete timeout'));
      }, 10000);

      const onComplete = (response) => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err) => {
        clearTimeout(timeout);
        this.removeListener('complete', onComplete);
        reject(new Error(err.message));
      };

      this.once('complete', onComplete);
      this.once('error', onError);
    });
  }

  /**
   * Dispute a proposal
   * @param {string} proposalId - The proposal ID to dispute
   * @param {string} reason - Reason for the dispute
   */
  async dispute(proposalId, reason) {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Disputing proposals requires persistent identity.');
    }

    if (!reason) {
      throw new Error('Dispute reason is required');
    }

    const sigContent = getDisputeSigningContent(proposalId, reason);
    const sig = this._identity.sign(sigContent);

    const msg = {
      type: ClientMessageType.DISPUTE,
      proposal_id: proposalId,
      reason,
      sig
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('dispute', onDispute);
        this.removeListener('error', onError);
        reject(new Error('Dispute timeout'));
      }, 10000);

      const onDispute = (response) => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err) => {
        clearTimeout(timeout);
        this.removeListener('dispute', onDispute);
        reject(new Error(err.message));
      };

      this.once('dispute', onDispute);
      this.once('error', onError);
    });
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

      // Proposal/negotiation messages
      case ServerMessageType.PROPOSAL:
        this.emit('proposal', msg);
        break;

      case ServerMessageType.ACCEPT:
        this.emit('accept', msg);
        break;

      case ServerMessageType.REJECT:
        this.emit('reject', msg);
        break;

      case ServerMessageType.COMPLETE:
        this.emit('complete', msg);
        break;

      case ServerMessageType.DISPUTE:
        this.emit('dispute', msg);
        break;
    }
  }
}

/**
 * Quick send - connect, send message, disconnect
 */
export async function quickSend(server, name, to, content, identityPath = null) {
  const client = new AgentChatClient({ server, name, identity: identityPath });
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
export async function listen(server, name, channels, callback, identityPath = null) {
  const client = new AgentChatClient({ server, name, identity: identityPath });
  await client.connect();

  for (const channel of channels) {
    await client.join(channel);
  }

  client.on('message', callback);
  client.on('agent_joined', callback);
  client.on('agent_left', callback);

  // Also stream proposal events
  client.on('proposal', callback);
  client.on('accept', callback);
  client.on('reject', callback);
  client.on('complete', callback);
  client.on('dispute', callback);

  return client;
}
