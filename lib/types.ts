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
  VERIFY_RESPONSE = 'VERIFY_RESPONSE'
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
  VERIFY_FAILED = 'VERIFY_FAILED'
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
  NO_PUBKEY = 'NO_PUBKEY'
}

export enum PresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  BUSY = 'busy',
  OFFLINE = 'offline'
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
  presence?: PresenceStatus;
  status_text?: string | null;
}

export interface ChannelInfo {
  name: string;
  agents?: number;
  members?: string[];
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
  | VerifyResponseMessage;

// ============ Server Messages ============

export interface WelcomeMessage extends BaseMessage {
  type: ServerMessageType.WELCOME;
  agent_id: string;
  name?: string;
  server?: string;
}

export interface ServerMsgMessage extends BaseMessage {
  type: ServerMessageType.MSG;
  from: string;
  to: string;
  content: string;
  name?: string;
  sig?: string;
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
  code: ErrorCode;
  message: string;
}

export interface PongMessage extends BaseMessage {
  type: ServerMessageType.PONG;
}

export interface ServerProposalMessage extends BaseMessage {
  type: ServerMessageType.PROPOSAL;
  proposal_id: string;
  from: string;
  to: string;
  task: string;
  amount?: number;
  currency?: string;
  elo_stake?: number;
  expires?: number;
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
  | SkillsRegisteredMessage
  | SearchResultsMessage
  | PresenceChangedMessage
  | VerifySuccessMessage
  | VerifyFailedMessage;

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
}
