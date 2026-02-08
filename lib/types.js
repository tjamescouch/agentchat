"use strict";
/**
 * AgentChat Protocol Types
 * TypeScript type definitions for agent-to-agent communication
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalStatus = exports.PresenceStatus = exports.ErrorCode = exports.ServerMessageType = exports.ClientMessageType = void 0;
// ============ Enums ============
var ClientMessageType;
(function (ClientMessageType) {
    ClientMessageType["IDENTIFY"] = "IDENTIFY";
    ClientMessageType["JOIN"] = "JOIN";
    ClientMessageType["LEAVE"] = "LEAVE";
    ClientMessageType["MSG"] = "MSG";
    ClientMessageType["LIST_CHANNELS"] = "LIST_CHANNELS";
    ClientMessageType["LIST_AGENTS"] = "LIST_AGENTS";
    ClientMessageType["CREATE_CHANNEL"] = "CREATE_CHANNEL";
    ClientMessageType["INVITE"] = "INVITE";
    ClientMessageType["PING"] = "PING";
    ClientMessageType["PROPOSAL"] = "PROPOSAL";
    ClientMessageType["ACCEPT"] = "ACCEPT";
    ClientMessageType["REJECT"] = "REJECT";
    ClientMessageType["COMPLETE"] = "COMPLETE";
    ClientMessageType["DISPUTE"] = "DISPUTE";
    ClientMessageType["REGISTER_SKILLS"] = "REGISTER_SKILLS";
    ClientMessageType["SEARCH_SKILLS"] = "SEARCH_SKILLS";
    ClientMessageType["SET_PRESENCE"] = "SET_PRESENCE";
    ClientMessageType["VERIFY_REQUEST"] = "VERIFY_REQUEST";
    ClientMessageType["VERIFY_RESPONSE"] = "VERIFY_RESPONSE";
    ClientMessageType["ADMIN_APPROVE"] = "ADMIN_APPROVE";
    ClientMessageType["ADMIN_REVOKE"] = "ADMIN_REVOKE";
    ClientMessageType["ADMIN_LIST"] = "ADMIN_LIST";
    ClientMessageType["VERIFY_IDENTITY"] = "VERIFY_IDENTITY";
    ClientMessageType["SET_NICK"] = "SET_NICK";
    // Agentcourt dispute types
    ClientMessageType["DISPUTE_INTENT"] = "DISPUTE_INTENT";
    ClientMessageType["DISPUTE_REVEAL"] = "DISPUTE_REVEAL";
    ClientMessageType["EVIDENCE"] = "EVIDENCE";
    ClientMessageType["ARBITER_ACCEPT"] = "ARBITER_ACCEPT";
    ClientMessageType["ARBITER_DECLINE"] = "ARBITER_DECLINE";
    ClientMessageType["ARBITER_VOTE"] = "ARBITER_VOTE";
    ClientMessageType["TYPING"] = "TYPING";
})(ClientMessageType || (exports.ClientMessageType = ClientMessageType = {}));
var ServerMessageType;
(function (ServerMessageType) {
    ServerMessageType["WELCOME"] = "WELCOME";
    ServerMessageType["MSG"] = "MSG";
    ServerMessageType["JOINED"] = "JOINED";
    ServerMessageType["LEFT"] = "LEFT";
    ServerMessageType["AGENT_JOINED"] = "AGENT_JOINED";
    ServerMessageType["AGENT_LEFT"] = "AGENT_LEFT";
    ServerMessageType["CHANNELS"] = "CHANNELS";
    ServerMessageType["AGENTS"] = "AGENTS";
    ServerMessageType["ERROR"] = "ERROR";
    ServerMessageType["PONG"] = "PONG";
    ServerMessageType["PROPOSAL"] = "PROPOSAL";
    ServerMessageType["ACCEPT"] = "ACCEPT";
    ServerMessageType["REJECT"] = "REJECT";
    ServerMessageType["COMPLETE"] = "COMPLETE";
    ServerMessageType["DISPUTE"] = "DISPUTE";
    ServerMessageType["SKILLS_REGISTERED"] = "SKILLS_REGISTERED";
    ServerMessageType["SEARCH_RESULTS"] = "SEARCH_RESULTS";
    ServerMessageType["PRESENCE_CHANGED"] = "PRESENCE_CHANGED";
    ServerMessageType["VERIFY_REQUEST"] = "VERIFY_REQUEST";
    ServerMessageType["VERIFY_RESPONSE"] = "VERIFY_RESPONSE";
    ServerMessageType["VERIFY_SUCCESS"] = "VERIFY_SUCCESS";
    ServerMessageType["VERIFY_FAILED"] = "VERIFY_FAILED";
    ServerMessageType["ADMIN_RESULT"] = "ADMIN_RESULT";
    ServerMessageType["CHALLENGE"] = "CHALLENGE";
    ServerMessageType["NICK_CHANGED"] = "NICK_CHANGED";
    // Agentcourt dispute types
    ServerMessageType["PANEL_FORMED"] = "PANEL_FORMED";
    ServerMessageType["ARBITER_ASSIGNED"] = "ARBITER_ASSIGNED";
    ServerMessageType["EVIDENCE_RECEIVED"] = "EVIDENCE_RECEIVED";
    ServerMessageType["CASE_READY"] = "CASE_READY";
    ServerMessageType["VERDICT"] = "VERDICT";
    ServerMessageType["DISPUTE_FALLBACK"] = "DISPUTE_FALLBACK";
    ServerMessageType["DISPUTE_INTENT_ACK"] = "DISPUTE_INTENT_ACK";
    ServerMessageType["DISPUTE_REVEALED"] = "DISPUTE_REVEALED";
    ServerMessageType["TYPING"] = "TYPING";
    ServerMessageType["SESSION_DISPLACED"] = "SESSION_DISPLACED";
    ServerMessageType["SETTLEMENT_COMPLETE"] = "SETTLEMENT_COMPLETE";
})(ServerMessageType || (exports.ServerMessageType = ServerMessageType = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["AUTH_REQUIRED"] = "AUTH_REQUIRED";
    ErrorCode["CHANNEL_NOT_FOUND"] = "CHANNEL_NOT_FOUND";
    ErrorCode["NOT_INVITED"] = "NOT_INVITED";
    ErrorCode["INVALID_MSG"] = "INVALID_MSG";
    ErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    ErrorCode["AGENT_NOT_FOUND"] = "AGENT_NOT_FOUND";
    ErrorCode["CHANNEL_EXISTS"] = "CHANNEL_EXISTS";
    ErrorCode["INVALID_NAME"] = "INVALID_NAME";
    ErrorCode["PROPOSAL_NOT_FOUND"] = "PROPOSAL_NOT_FOUND";
    ErrorCode["PROPOSAL_EXPIRED"] = "PROPOSAL_EXPIRED";
    ErrorCode["INVALID_PROPOSAL"] = "INVALID_PROPOSAL";
    ErrorCode["SIGNATURE_REQUIRED"] = "SIGNATURE_REQUIRED";
    ErrorCode["NOT_PROPOSAL_PARTY"] = "NOT_PROPOSAL_PARTY";
    ErrorCode["INSUFFICIENT_REPUTATION"] = "INSUFFICIENT_REPUTATION";
    ErrorCode["INVALID_STAKE"] = "INVALID_STAKE";
    ErrorCode["VERIFICATION_FAILED"] = "VERIFICATION_FAILED";
    ErrorCode["VERIFICATION_EXPIRED"] = "VERIFICATION_EXPIRED";
    ErrorCode["NO_PUBKEY"] = "NO_PUBKEY";
    ErrorCode["NOT_ALLOWED"] = "NOT_ALLOWED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var PresenceStatus;
(function (PresenceStatus) {
    PresenceStatus["ONLINE"] = "online";
    PresenceStatus["AWAY"] = "away";
    PresenceStatus["BUSY"] = "busy";
    PresenceStatus["OFFLINE"] = "offline";
    PresenceStatus["LISTENING"] = "listening";
})(PresenceStatus || (exports.PresenceStatus = PresenceStatus = {}));
var ProposalStatus;
(function (ProposalStatus) {
    ProposalStatus["PENDING"] = "pending";
    ProposalStatus["ACCEPTED"] = "accepted";
    ProposalStatus["REJECTED"] = "rejected";
    ProposalStatus["COMPLETED"] = "completed";
    ProposalStatus["DISPUTED"] = "disputed";
    ProposalStatus["EXPIRED"] = "expired";
})(ProposalStatus || (exports.ProposalStatus = ProposalStatus = {}));
