/**
 * AgentChat Client
 * Connect to agentchat servers from Node.js or CLI
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  ClientMessageType,
  ServerMessageType,
  WelcomeMessage,
  ServerMsgMessage,
  JoinedMessage,
  LeftMessage,
  AgentJoinedMessage,
  AgentLeftMessage,
  ChannelsMessage,
  AgentsMessage,
  ErrorMessage,
  PongMessage,
  ServerProposalMessage,
  SkillsRegisteredMessage,
  SearchResultsMessage,
  ChannelInfo,
  AgentInfo,
  ServerMessage,
} from './types.js';
import {
  createMessage,
  serialize,
  parse,
  generateNonce
} from './protocol.js';
import { Identity } from './identity.js';
import {
  getProposalSigningContent,
  getAcceptSigningContent,
  getRejectSigningContent,
  getCompleteSigningContent,
  getDisputeSigningContent
} from './proposals.js';

// ============ Client-specific Types ============

export interface ClientOptions {
  server: string;
  name?: string;
  pubkey?: string | null;
  identity?: string | null;
}

export interface ProposalOptions {
  task: string;
  amount?: number;
  currency?: string;
  payment_code?: string;
  terms?: string;
  expires?: number;
  elo_stake?: number;
}

export interface VerificationResult {
  verified: boolean;
  agent?: string;
  target?: string;
  pubkey?: string;
  reason?: string;
  request_id?: string;
}

type PendingRequestCallback = (result: unknown) => void;

// ============ AgentChatClient Class ============

export class AgentChatClient extends EventEmitter {
  server: string;
  name: string;
  pubkey: string | null;
  identityPath: string | null;

  private _identity: Identity | null;
  private ws: WebSocket | null;
  agentId: string | null;
  connected: boolean;
  channels: Set<string>;

  private _pendingRequests: Map<number, PendingRequestCallback>;
  private _requestId: number;
  private _autoVerifyHandler: ((msg: ServerMessage) => void) | null;

  constructor(options: ClientOptions) {
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
    this._autoVerifyHandler = null;
  }

  /**
   * Load identity from file, or create new one if it doesn't exist
   */
  private async _loadIdentity(): Promise<void> {
    if (this.identityPath) {
      try {
        // Check if identity file exists
        const exists = await Identity.exists(this.identityPath);
        if (exists) {
          this._identity = await Identity.load(this.identityPath);
        } else {
          // Generate new identity and save it
          this._identity = Identity.generate(this.name);
          await this._identity.save(this.identityPath);
        }
        this.name = this._identity.name || this.name;
        this.pubkey = this._identity.pubkey;
      } catch (err) {
        const error = err as Error;
        throw new Error(`Failed to load/create identity at ${this.identityPath}: ${error.message}`);
      }
    }
  }

  /**
   * Connect to the server and identify
   */
  async connect(): Promise<WelcomeMessage> {
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

      this.ws.on('message', (data: WebSocket.Data) => {
        this._handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnect');
      });

      this.ws.on('error', (err: Error) => {
        this.emit('error', err);
        if (!this.connected) {
          reject(err);
        }
      });

      // Wait for WELCOME
      this.once('welcome', (info: WelcomeMessage) => {
        this.connected = true;
        this.agentId = info.agent_id;
        resolve(info);
      });

      // Handle connection error
      this.once('error', (err: Error) => {
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Join a channel
   */
  async join(channel: string): Promise<JoinedMessage> {
    this._send({
      type: ClientMessageType.JOIN,
      channel
    });

    return new Promise((resolve, reject) => {
      const onJoined = (msg: JoinedMessage): void => {
        if (msg.channel === channel) {
          this.removeListener('error', onError);
          this.channels.add(channel);
          resolve(msg);
        }
      };

      const onError = (msg: ErrorMessage): void => {
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
  async leave(channel: string): Promise<void> {
    this._send({
      type: ClientMessageType.LEAVE,
      channel
    });
    this.channels.delete(channel);
  }

  /**
   * Send a message to a channel or agent
   */
  async send(to: string, content: string): Promise<void> {
    const msg: Record<string, unknown> = {
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
  async dm(agent: string, content: string): Promise<void> {
    const target = agent.startsWith('@') ? agent : `@${agent}`;
    return this.send(target, content);
  }

  /**
   * List available channels
   */
  async listChannels(): Promise<ChannelInfo[]> {
    this._send({
      type: ClientMessageType.LIST_CHANNELS
    });

    return new Promise((resolve) => {
      this.once('channels', (msg: ChannelsMessage) => {
        resolve(msg.list);
      });
    });
  }

  /**
   * List agents in a channel
   */
  async listAgents(channel: string): Promise<AgentInfo[]> {
    this._send({
      type: ClientMessageType.LIST_AGENTS,
      channel
    });

    return new Promise((resolve) => {
      this.once('agents', (msg: AgentsMessage) => {
        resolve(msg.list);
      });
    });
  }

  /**
   * Create a new channel
   */
  async createChannel(channel: string, inviteOnly: boolean = false): Promise<JoinedMessage> {
    this._send({
      type: ClientMessageType.CREATE_CHANNEL,
      channel,
      invite_only: inviteOnly
    });

    return new Promise((resolve, reject) => {
      const onJoined = (msg: JoinedMessage): void => {
        if (msg.channel === channel) {
          this.removeListener('error', onError);
          this.channels.add(channel);
          resolve(msg);
        }
      };

      const onError = (msg: ErrorMessage): void => {
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
  async invite(channel: string, agent: string): Promise<void> {
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
  ping(): void {
    this._send({ type: ClientMessageType.PING });
  }

  // ===== PROPOSAL/NEGOTIATION METHODS =====

  /**
   * Send a proposal to another agent
   * Requires persistent identity for signing
   */
  async propose(to: string, proposal: ProposalOptions): Promise<ServerProposalMessage> {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Proposals require persistent identity. Use --identity flag.');
    }

    const target = to.startsWith('@') ? to : `@${to}`;

    const proposalData = {
      to: target,
      task: proposal.task,
      amount: proposal.amount,
      currency: proposal.currency,
      payment_code: proposal.payment_code,
      terms: proposal.terms,
      expires: proposal.expires,
      elo_stake: proposal.elo_stake
    };

    // Sign the proposal
    const sigContent = getProposalSigningContent(proposalData);

    const msg: Record<string, unknown> = {
      type: ClientMessageType.PROPOSAL,
      ...proposalData,
      sig: this._identity.sign(sigContent)
    };

    this._send(msg);

    // Wait for the proposal response with ID
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('proposal', onProposal);
        this.removeListener('error', onError);
        reject(new Error('Proposal timeout'));
      }, 10000);

      const onProposal = (p: ServerProposalMessage): void => {
        if (p.to === target && p.from === this.agentId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(p);
        }
      };

      const onError = (err: ErrorMessage): void => {
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
   */
  async accept(proposalId: string, payment_code: string | null = null, elo_stake: number | null = null): Promise<ServerMessage> {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Accepting proposals requires persistent identity.');
    }

    const sigContent = getAcceptSigningContent(proposalId, payment_code || '', elo_stake || '');
    const sig = this._identity.sign(sigContent);

    const msg = {
      type: ClientMessageType.ACCEPT,
      proposal_id: proposalId,
      payment_code,
      elo_stake,
      sig
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('accept', onAccept);
        this.removeListener('error', onError);
        reject(new Error('Accept timeout'));
      }, 10000);

      const onAccept = (response: ServerMessage & { proposal_id?: string }): void => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err: ErrorMessage): void => {
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
   */
  async reject(proposalId: string, reason: string | null = null): Promise<ServerMessage> {
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

      const onReject = (response: ServerMessage & { proposal_id?: string }): void => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err: ErrorMessage): void => {
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
   */
  async complete(proposalId: string, proof: string | null = null): Promise<ServerMessage> {
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

      const onComplete = (response: ServerMessage & { proposal_id?: string }): void => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err: ErrorMessage): void => {
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
   */
  async dispute(proposalId: string, reason: string): Promise<ServerMessage> {
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

      const onDispute = (response: ServerMessage & { proposal_id?: string }): void => {
        if (response.proposal_id === proposalId) {
          clearTimeout(timeout);
          this.removeListener('error', onError);
          resolve(response);
        }
      };

      const onError = (err: ErrorMessage): void => {
        clearTimeout(timeout);
        this.removeListener('dispute', onDispute);
        reject(new Error(err.message));
      };

      this.once('dispute', onDispute);
      this.once('error', onError);
    });
  }

  // ===== IDENTITY VERIFICATION METHODS =====

  /**
   * Request identity verification from another agent
   * Sends a challenge nonce that the target must sign to prove they control their identity
   */
  async verify(target: string): Promise<VerificationResult> {
    const targetAgent = target.startsWith('@') ? target : `@${target}`;
    const nonce = generateNonce();

    const msg = {
      type: ClientMessageType.VERIFY_REQUEST,
      target: targetAgent,
      nonce
    };

    this._send(msg);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('verify_success', onSuccess);
        this.removeListener('verify_failed', onFailed);
        this.removeListener('error', onError);
        reject(new Error('Verification timeout'));
      }, 35000); // Slightly longer than server timeout

      const onSuccess = (response: ServerMessage & { agent?: string; target?: string; pubkey?: string; request_id?: string }): void => {
        if (response.agent === targetAgent || response.target === targetAgent) {
          clearTimeout(timeout);
          this.removeListener('verify_failed', onFailed);
          this.removeListener('error', onError);
          resolve({
            verified: true,
            agent: response.agent,
            pubkey: response.pubkey,
            request_id: response.request_id
          });
        }
      };

      const onFailed = (response: ServerMessage & { target?: string; reason?: string; request_id?: string }): void => {
        if (response.target === targetAgent) {
          clearTimeout(timeout);
          this.removeListener('verify_success', onSuccess);
          this.removeListener('error', onError);
          resolve({
            verified: false,
            target: response.target,
            reason: response.reason,
            request_id: response.request_id
          });
        }
      };

      const onError = (err: ErrorMessage): void => {
        clearTimeout(timeout);
        this.removeListener('verify_success', onSuccess);
        this.removeListener('verify_failed', onFailed);
        reject(new Error(err.message));
      };

      this.on('verify_success', onSuccess);
      this.on('verify_failed', onFailed);
      this.once('error', onError);
    });
  }

  /**
   * Respond to a verification request by signing the nonce
   * This is typically called automatically when a VERIFY_REQUEST is received
   */
  async respondToVerification(requestId: string, nonce: string): Promise<void> {
    if (!this._identity || !this._identity.privkey) {
      throw new Error('Responding to verification requires persistent identity.');
    }

    const sig = this._identity.sign(nonce);

    const msg = {
      type: ClientMessageType.VERIFY_RESPONSE,
      request_id: requestId,
      nonce,
      sig
    };

    this._send(msg);
  }

  /**
   * Enable automatic verification response
   * When enabled, the client will automatically respond to VERIFY_REQUEST messages
   */
  enableAutoVerification(enabled: boolean = true): void {
    if (enabled) {
      this._autoVerifyHandler = (msg: ServerMessage & { request_id?: string; nonce?: string; from?: string }): void => {
        if (msg.request_id && msg.nonce && msg.from) {
          this.respondToVerification(msg.request_id, msg.nonce)
            .catch(err => this.emit('error', { message: `Auto-verification failed: ${(err as Error).message}` }));
        }
      };
      this.on('verify_request', this._autoVerifyHandler);
    } else if (this._autoVerifyHandler) {
      this.removeListener('verify_request', this._autoVerifyHandler);
      this._autoVerifyHandler = null;
    }
  }

  private _send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serialize(msg));
    }
  }

  /**
   * Send a raw message (for protocol extensions)
   */
  sendRaw(msg: Record<string, unknown>): void {
    this._send(msg);
  }

  private _handleMessage(data: string): void {
    let msg: ServerMessage;
    try {
      msg = parse(data) as ServerMessage;
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

      // Skills discovery messages
      case ServerMessageType.SKILLS_REGISTERED:
        this.emit('skills_registered', msg);
        this.emit('message', msg);
        break;

      case ServerMessageType.SEARCH_RESULTS:
        this.emit('search_results', msg);
        this.emit('message', msg);
        break;

      // Identity verification messages
      case ServerMessageType.VERIFY_REQUEST:
        this.emit('verify_request', msg);
        break;

      case ServerMessageType.VERIFY_RESPONSE:
        this.emit('verify_response', msg);
        break;

      case ServerMessageType.VERIFY_SUCCESS:
        this.emit('verify_success', msg);
        break;

      case ServerMessageType.VERIFY_FAILED:
        this.emit('verify_failed', msg);
        break;
    }
  }
}

/**
 * Quick send - connect, send message, disconnect
 */
export async function quickSend(
  server: string,
  name: string,
  to: string,
  content: string,
  identityPath: string | null = null
): Promise<void> {
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
export async function listen(
  server: string,
  name: string,
  channels: string[],
  callback: (msg: ServerMessage) => void,
  identityPath: string | null = null
): Promise<AgentChatClient> {
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

// Re-export security utilities
export { checkDirectorySafety, enforceDirectorySafety } from './security.js';
