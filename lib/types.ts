/**
 * AgentChat Protocol Types
 * TypeScript type definitions for agent-to-agent communication
 */

// ============ Enums ============

export enum ClientMessageType {
  IDENTIFY = 'IDENTIFY',
  JOIN = 'JOIN',
  LEAVE = 'LEAVE',
  MSG = 'MSG',
  LIST_CHANNELS = 'LIST_CHANNELS',
  LIST_AGENTS = 'LIST_AGENTS',
  CREATE_CHANNEL = 'CREATE_CHANNEL',
  INVITE = 'INVITE',
  PING = 'PING',
  PROPOSAL = 'PROPOSAL',
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
  COMPLETE = 'COMPLETE',
  DISPUTE = 'DISPUTE',
  REGISTER_SKILLS = 'REGISTER_SKILLS',
  SEARCH_SKILLS = 'SEARCH_SKILLS',
  SET_PRESENCE = 'SET_PRESENCE',
  VERIFY_REQUEST = 'VERIFY_REQUEST',
  VERIFY_RESPONSE = 'VERIFY_RESPONSE',
  ADMIN_APPROVE = 'ADMIN_APPROVE',
  ADMIN_REVOKE = 'ADMIN_REVOKE',
  ADMIN_LIST = 'ADMIN_LIST',
  VERIFY_IDENTITY = 'VERIFY_IDENTITY',
  SET_NICK = 'SET_NICK',
  // Agentcourt dispute types
  DISPUTE_INTENT = 'DISPUTE_INTENT',
  DISPUTE_REVEAL = 'DISPUTE_REVEAL',
  EVIDENCE = 'EVIDENCE',
  ARBITER_ACCEPT = 'ARBITER_ACCEPT',
  ARBITER_DECLINE = 'ARBITER_DECLINE',
  ARBITER_VOTE = 'ARBITER_VOTE',
  TYPING = 'TYPING',
  // Floor control
  RESPONDING_TO = 'RESPONDING_TO',
  // Moderation
  ADMIN_KICK = 'ADMIN_KICK',
  // Captcha
  CAPTCHA_RESPONSE = 'CAPTCHA_RESPONSE',
  ADMIN_BAN = 'ADMIN_BAN',
  ADMIN_UNBAN = 'ADMIN_UNBAN',
  ADMIN_MOTD = 'ADMIN_MOTD',
  // File transfer
  FILE_CHUNK = 'FILE_CHUNK'
}

export enum ServerMessageType {
  WELCOME = 'WELCOME',
  MSG = 'MSG',
  JOINED = 'JOINED',
  LEFT = 'LEFT',
  AGENT_JOINED = 'AGENT_JOINED',
  AGENT_LEFT = 'AGENT_LEFT',
  CHANNELS = 'CHANNELS',
  AGENTS = 'AGENTS',
  ERROR = 'ERROR',
  PONG = 'PONG',
  PROPOSAL = 'PROPOSAL',
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
  COMPLETE = 'COMPLETE',
  DISPUTE = 'DISPUTE',
  SKILLS_REGISTERED = 'SKILLS_REGISTERED',
  SEARCH_RESULTS = 'SEARCH_RESULTS',
  PRESENCE_CHANGED = 'PRESENCE_CHANGED',
  VERIFY_REQUEST = 'VERIFY_REQUEST',
  VERIFY_RESPONSE = 'VERIFY_RESPONSE',
  VERIFY_SUCCESS = 'VERIFY_SUCCESS',
  VERIFY_FAILED = 'VERIFY_FAILED',
  ADMIN_RESULT = 'ADMIN_RESULT',
  CHALLENGE = 'CHALLENGE',
  NICK_CHANGED = 'NICK_CHANGED',
  // Agentcourt dispute types
  PANEL_FORMED = 'PANEL_FORMED',
  ARBITER_ASSIGNED = 'ARBITER_ASSIGNED',
  EVIDENCE_RECEIVED = 'EVIDENCE_RECEIVED',
  CASE_READY = 'CASE_READY',
  VERDICT = 'VERDICT',
  DISPUTE_FALLBACK = 'DISPUTE_FALLBACK',
  DISPUTE_INTENT_ACK = 'DISPUTE_INTENT_ACK',
  DISPUTE_REVEALED = 'DISPUTE_REVEALED',
  TYPING = 'TYPING',
  // Floor control
  YIELD = 'YIELD',
  FLOOR_CLAIMED = 'FLOOR_CLAIMED',
  SESSION_DISPLACED = 'SESSION_DISPLACED',
  SETTLEMENT_COMPLETE = 'SETTLEMENT_COMPLETE',
  // Moderation
  KICKED = 'KICKED',
  BANNED = 'BANNED',
  MOTD_UPDATE = 'MOTD_UPDATE',
  // File transfer
  FILE_CHUNK = 'FILE_CHUNK',
  // Captcha
  CAPTCHA_CHALLENGE = 'CAPTCHA_CHALLENGE'
}

export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  NOT_INVITED = 'NOT_INVITED',
  INVALID_MSG = 'INVALID_MSG',
  RATE_LIMITED = 'RATE_LIMITED',
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  CHANNEL_EXISTS = 'CHANNEL_EXISTS',
  INVALID_NAME = 'INVALID_NAME',
  PROPOSAL_NOT_FOUND = 'PROPOSAL_NOT_FOUND',
  PROPOSAL_EXPIRED = 'PROPOSAL_EXPIRED',
  INVALID_PROPOSAL = 'INVALID_PROPOSAL',
  SIGNATURE_REQUIRED = 'SIGNATURE_REQUIRED',
  NOT_PROPOSAL_PARTY = 'NOT_PROPOSAL_PARTY',
  INSUFFICIENT_REPUTATION = 'INSUFFICIENT_REPUTATION',
  INVALID_STAKE = 'INVALID_STAKE',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  VERIFICATION_EXPIRED = 'VERIFICATION_EXPIRED',
  NO_PUBKEY = 'NO_PUBKEY',
  NOT_ALLOWED = 'NOT_ALLOWED',
  BANNED = 'BANNED',
  CAPTCHA_FAILED = 'CAPTCHA_FAILED',
  CAPTCHA_EXPIRED = 'CAPTCHA_EXPIRED'
}

export enum PresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  BUSY = 'busy',
  OFFLINE = 'offline',
  LISTENING = 'listening'
}

export enum ProposalStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  EXPIRED = 'expired'
}

// ============ Base Types ============

export interface BaseMessage {
  type: string;
  ts?: number;
}

export interface Skill {
  capability: string;
  description?: string;
  rate?: number;
  currency?: string;
}

export interface SkillQuery {
  capability?: string;
  max_rate?: number;
  currency?: string;
  limit?: number;
}

export interface AgentInfo {
  id: string;
  name?: string;
  nick?: string | null;
  presence?: PresenceStatus;
  status_text?: string | null;
}

export interface ChannelInfo {
  name: string;
  agents?: number;
  members?: string[];
  inviteOnly?: boolean;
  verifiedOnly?: boolean;
}

export interface Proposal {
  id: string;
  from: string;
  to: string;
  task: string;
  amount?: number;
  currency?: string;
  elo_stake?: number;
  expires?: number;
  status: ProposalStatus;
  created_at: number;
  accepted_at?: number;
  completed_at?: number;
  proposer_stake?: number;
  acceptor_stake?: number;
}

// ============ Client Messages ============

export interface IdentifyMessage extends BaseMessage {
  type: ClientMessageType.IDENTIFY;
  name: string;
  pubkey?: string | null;
}

export interface JoinMessage extends BaseMessage {
  type: ClientMessageType.JOIN;
  channel: string;
}

export interface LeaveMessage extends BaseMessage {
  type: ClientMessageType.LEAVE;
  channel: string;
}

export interface MsgMessage extends BaseMessage {
  type: ClientMessageType.MSG;
  to: string;
  content: string;
  sig?: string;
  in_reply_to?: string; // msg_id of the message being replied to (threading)
}

export interface FileChunkMessage extends BaseMessage {
  type: ClientMessageType.FILE_CHUNK;
  to: string;
  content: string;
}

export interface ListChannelsMessage extends BaseMessage {
  type: ClientMessageType.LIST_CHANNELS;
}

export interface ListAgentsMessage extends BaseMessage {
  type: ClientMessageType.LIST_AGENTS;
  channel: string;
}

export interface CreateChannelMessage extends BaseMessage {
  type: ClientMessageType.CREATE_CHANNEL;
  channel: string;
}

export interface InviteMessage extends BaseMessage {
  type: ClientMessageType.INVITE;
  channel: string;
  agent: string;
}

export interface PingMessage extends BaseMessage {
  type: ClientMessageType.PING;
}

export interface ProposalMessage extends BaseMessage {
  type: ClientMessageType.PROPOSAL;
  to: string;
  task: string;
  amount?: number;
  currency?: string;
  elo_stake?: number;
  expires?: number;
  terms?: string;
  sig: string;
}

export interface AcceptMessage extends BaseMessage {
  type: ClientMessageType.ACCEPT;
  proposal_id: string;
  elo_stake?: number;
  sig: string;
}

export interface RejectMessage extends BaseMessage {
  type: ClientMessageType.REJECT;
  proposal_id: string;
  sig: string;
}

export interface CompleteMessage extends BaseMessage {
  type: ClientMessageType.COMPLETE;
  proposal_id: string;
  proof?: string;
  sig: string;
}

export interface DisputeMessage extends BaseMessage {
  type: ClientMessageType.DISPUTE;
  proposal_id: string;
  reason: string;
  sig: string;
}

export interface RegisterSkillsMessage extends BaseMessage {
  type: ClientMessageType.REGISTER_SKILLS;
  skills: Skill[];
  sig: string;
}

export interface SearchSkillsMessage extends BaseMessage {
  type: ClientMessageType.SEARCH_SKILLS;
  query: SkillQuery;
  query_id?: string;
}

export interface SetPresenceMessage extends BaseMessage {
  type: ClientMessageType.SET_PRESENCE;
  status: PresenceStatus;
  status_text?: string;
}

export interface VerifyRequestMessage extends BaseMessage {
  type: ClientMessageType.VERIFY_REQUEST;
  target: string;
  nonce: string;
}

export interface VerifyResponseMessage extends BaseMessage {
  type: ClientMessageType.VERIFY_RESPONSE;
  request_id: string;
  nonce: string;
  sig: string;
}

export interface AdminApproveMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_APPROVE;
  pubkey: string;
  admin_key: string;
  note?: string;
}

export interface AdminRevokeMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_REVOKE;
  pubkey?: string;
  agent_id?: string;
  admin_key: string;
}

export interface AdminListMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_LIST;
  admin_key: string;
}

export interface AdminKickMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_KICK;
  agent_id: string;
  admin_key: string;
  reason?: string;
}

export interface AdminBanMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_BAN;
  agent_id: string;
  admin_key: string;
  reason?: string;
}

export interface AdminUnbanMessage extends BaseMessage {
  type: ClientMessageType.ADMIN_UNBAN;
  agent_id: string;
  admin_key: string;
}

export interface AdminMotdMessage extends BaseMessage {
  type: 'ADMIN_MOTD';
  admin_key: string;
  motd: string | null;
  kick?: boolean;
}

export interface VerifyIdentityMessage extends BaseMessage {
  type: ClientMessageType.VERIFY_IDENTITY;
  challenge_id: string;
  signature: string;
  timestamp: number;
}

// Agentcourt dispute messages
export interface DisputeIntentMessage extends BaseMessage {
  type: ClientMessageType.DISPUTE_INTENT;
  proposal_id: string;
  reason: string;
  commitment: string;
  sig: string;
}

export interface DisputeRevealMessage extends BaseMessage {
  type: ClientMessageType.DISPUTE_REVEAL;
  proposal_id: string;
  nonce: string;
  sig: string;
}

export interface EvidenceMessage extends BaseMessage {
  type: ClientMessageType.EVIDENCE;
  dispute_id: string;
  items: Array<{
    kind: string;
    label: string;
    value: string;
    url?: string;
  }>;
  statement: string;
  sig: string;
}

export interface ArbiterAcceptMessage extends BaseMessage {
  type: ClientMessageType.ARBITER_ACCEPT;
  dispute_id: string;
  sig: string;
}

export interface ArbiterDeclineMessage extends BaseMessage {
  type: ClientMessageType.ARBITER_DECLINE;
  dispute_id: string;
  reason?: string;
}

export interface ArbiterVoteMessage extends BaseMessage {
  type: ClientMessageType.ARBITER_VOTE;
  dispute_id: string;
  verdict: string;
  reasoning: string;
  sig: string;
}

export interface SetNickMessage extends BaseMessage {
  type: ClientMessageType.SET_NICK;
  nick: string;
}

export interface TypingMessage extends BaseMessage {
  type: ClientMessageType.TYPING;
  channel: string;
}

export interface RespondingToMessage extends BaseMessage {
  type: ClientMessageType.RESPONDING_TO;
  msg_id: string;
  channel: string;
  started_at: number;
}

export interface CaptchaResponseMessage extends BaseMessage {
  type: ClientMessageType.CAPTCHA_RESPONSE;
  captcha_id: string;
  answer: string;
}

export type ClientMessage =
  | IdentifyMessage
  | JoinMessage
  | LeaveMessage
  | MsgMessage
  | ListChannelsMessage
  | ListAgentsMessage
  | CreateChannelMessage
  | InviteMessage
  | PingMessage
  | ProposalMessage
  | AcceptMessage
  | RejectMessage
  | CompleteMessage
  | DisputeMessage
  | RegisterSkillsMessage
  | SearchSkillsMessage
  | SetPresenceMessage
  | VerifyRequestMessage
  | VerifyResponseMessage
  | AdminApproveMessage
  | AdminRevokeMessage
  | AdminListMessage
  | VerifyIdentityMessage
  | DisputeIntentMessage
  | DisputeRevealMessage
  | EvidenceMessage
  | ArbiterAcceptMessage
  | ArbiterDeclineMessage
  | ArbiterVoteMessage
  | SetNickMessage
  | TypingMessage
  | RespondingToMessage
  | AdminKickMessage
  | AdminBanMessage
  | AdminUnbanMessage
  | AdminMotdMessage
  | FileChunkMessage
  | CaptchaResponseMessage;

// ============ Server Messages ============

export interface WelcomeMessage extends BaseMessage {
  type: ServerMessageType.WELCOME;
  agent_id: string;
  name?: string;
  server?: string;
  motd?: string;
}

export interface ServerMsgMessage extends BaseMessage {
  type: ServerMessageType.MSG;
  from: string;
  from_name?: string;
  to: string;
  content: string;
  sig?: string;
  in_reply_to?: string; // msg_id of the message being replied to (threading)
  msg_id?: string;      // unique message ID for threading references
  verified?: boolean;   // whether the sender completed identity verification
}

export interface ServerFileChunkMessage extends BaseMessage {
  type: ServerMessageType.FILE_CHUNK;
  from: string;
  to: string;
  content: string;
}

export interface JoinedMessage extends BaseMessage {
  type: ServerMessageType.JOINED;
  channel: string;
  agents?: string[];
}

export interface LeftMessage extends BaseMessage {
  type: ServerMessageType.LEFT;
  channel: string;
}

export interface AgentJoinedMessage extends BaseMessage {
  type: ServerMessageType.AGENT_JOINED;
  channel: string;
  agent: string;
  name?: string;
}

export interface AgentLeftMessage extends BaseMessage {
  type: ServerMessageType.AGENT_LEFT;
  channel: string;
  agent: string;
}

export interface ChannelsMessage extends BaseMessage {
  type: ServerMessageType.CHANNELS;
  list: ChannelInfo[];
}

export interface AgentsMessage extends BaseMessage {
  type: ServerMessageType.AGENTS;
  channel: string;
  list: AgentInfo[];
}

export interface ErrorMessage extends BaseMessage {
  type: ServerMessageType.ERROR;
  code: ErrorCode | string;
  message: string;
}

export interface PongMessage extends BaseMessage {
  type: ServerMessageType.PONG;
}

export interface ServerProposalMessage extends BaseMessage {
  type: ServerMessageType.PROPOSAL;
  id?: string;
  proposal_id: string;
  from: string;
  to: string;
  task: string;
  amount?: number;
  currency?: string;
  elo_stake?: number;
  expires?: number;
  proposer_stake?: number;
  acceptor_stake?: number;
  status?: ProposalStatus | string;
}

export interface ServerAcceptMessage extends BaseMessage {
  type: ServerMessageType.ACCEPT;
  proposal_id: string;
  from: string;
  to: string;
  status: ProposalStatus | string;
  proposer_stake?: number;
  acceptor_stake?: number;
}

export interface ServerRejectMessage extends BaseMessage {
  type: ServerMessageType.REJECT;
  proposal_id: string;
  from: string;
  to: string;
  status: ProposalStatus | string;
}

export interface ServerCompleteMessage extends BaseMessage {
  type: ServerMessageType.COMPLETE;
  proposal_id: string;
  from: string;
  to: string;
  status: ProposalStatus | string;
  proof?: string;
}

export interface ServerDisputeMessage extends BaseMessage {
  type: ServerMessageType.DISPUTE;
  proposal_id: string;
  from: string;
  to: string;
  status: ProposalStatus | string;
  reason: string;
}

export interface SkillsRegisteredMessage extends BaseMessage {
  type: ServerMessageType.SKILLS_REGISTERED;
  count: number;
}

export interface SearchResultsMessage extends BaseMessage {
  type: ServerMessageType.SEARCH_RESULTS;
  query_id?: string;
  results: Array<Skill & { agent_id: string }>;
}

export interface PresenceChangedMessage extends BaseMessage {
  type: ServerMessageType.PRESENCE_CHANGED;
  agent_id: string;
  status: PresenceStatus;
  status_text?: string;
}

export interface ServerVerifyRequestMessage extends BaseMessage {
  type: ServerMessageType.VERIFY_REQUEST;
  request_id: string;
  from: string;
  nonce: string;
}

export interface ServerVerifyResponseMessage extends BaseMessage {
  type: ServerMessageType.VERIFY_RESPONSE;
  request_id: string;
  from: string;
  verified: boolean;
}

export interface VerifySuccessMessage extends BaseMessage {
  type: ServerMessageType.VERIFY_SUCCESS;
  agent_id: string;
  verified: boolean;
}

export interface VerifyFailedMessage extends BaseMessage {
  type: ServerMessageType.VERIFY_FAILED;
  agent_id: string;
  reason: string;
}

export interface ChallengeMessage extends BaseMessage {
  type: ServerMessageType.CHALLENGE;
  nonce: string;
  challenge_id: string;
  expires_at: number;
}

export interface NickChangedMessage extends BaseMessage {
  type: ServerMessageType.NICK_CHANGED;
  agent_id: string;
  old_nick: string;
  new_nick: string;
}

export interface SessionDisplacedMessage extends BaseMessage {
  type: ServerMessageType.SESSION_DISPLACED;
  reason: string;
  new_ip?: string;
}

export interface SettlementCompleteMessage extends BaseMessage {
  type: ServerMessageType.SETTLEMENT_COMPLETE;
  dispute_id: string;
  proposal_id: string;
  verdict: string;
  rating_changes: Record<string, { oldRating: number; newRating: number; change: number }>;
}

export interface AdminResultMessage extends BaseMessage {
  type: ServerMessageType.ADMIN_RESULT;
  action: string;
  success?: boolean;
  agentId?: string;
  entries?: Array<{
    agentId: string;
    pubkeyPrefix: string;
    approvedAt: string;
    note: string;
  }>;
  enabled?: boolean;
  strict?: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | ServerMsgMessage
  | JoinedMessage
  | LeftMessage
  | AgentJoinedMessage
  | AgentLeftMessage
  | ChannelsMessage
  | AgentsMessage
  | ErrorMessage
  | PongMessage
  | ServerProposalMessage
  | ServerAcceptMessage
  | ServerRejectMessage
  | ServerCompleteMessage
  | ServerDisputeMessage
  | SkillsRegisteredMessage
  | SearchResultsMessage
  | PresenceChangedMessage
  | ServerVerifyRequestMessage
  | ServerVerifyResponseMessage
  | VerifySuccessMessage
  | VerifyFailedMessage
  | AdminResultMessage
  | ChallengeMessage
  | NickChangedMessage
  | SessionDisplacedMessage
  | SettlementCompleteMessage
  | ServerFileChunkMessage
  | CaptchaChallengeServerMessage;

// ============ Captcha Server Message ============

export interface CaptchaChallengeServerMessage extends BaseMessage {
  type: ServerMessageType.CAPTCHA_CHALLENGE;
  captcha_id: string;
  question: string;
  hint?: string;
  expires_at: number;
}

// ============ Validation Result ============

export interface ValidationSuccess {
  valid: true;
  msg: ClientMessage;
}

export interface ValidationFailure {
  valid: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ============ Identity Types ============

export interface Identity {
  publicKey: string;
  privateKey: string;
  agentId: string;
  name?: string;
}

export interface IdentityFile {
  publicKey: string;
  privateKey: string;
  agentId?: string;
  name?: string;
  created?: string;
  rotations?: Array<{
    old_pubkey: string;
    old_agent_id: string;
    new_pubkey: string;
    new_agent_id: string;
    signature: string;
    timestamp: string;
  }>;
}

// ============ Escrow Types ============

export interface RatingChange {
  old: number;
  new: number;
  delta: number;
}

export interface EscrowSettlement {
  proposer: RatingChange;
  acceptor: RatingChange;
}

export interface RatingChanges {
  [agentId: string]: RatingChange | EscrowSettlement | undefined;
}

// Flexible message type for internal use
export interface AnyMessage {
  type: string;
  ts?: number;
  [key: string]: unknown;
}
