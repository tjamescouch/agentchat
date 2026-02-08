"use strict";
/**
 * Agentcourt Dispute Handlers
 * Server-side handlers for the panel-based dispute resolution system
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDisputeIntent = handleDisputeIntent;
exports.handleDisputeReveal = handleDisputeReveal;
exports.handleEvidence = handleEvidence;
exports.handleArbiterAccept = handleArbiterAccept;
exports.handleArbiterDecline = handleArbiterDecline;
exports.handleArbiterVote = handleArbiterVote;
var protocol_js_1 = require("../../protocol.js");
var disputes_js_1 = require("../../disputes.js");
var identity_js_1 = require("../../identity.js");
var escrow_hooks_js_1 = require("../../escrow-hooks.js");
/**
 * Build the eligible arbiter pool based on Agentcourt spec criteria.
 * Checks: not-a-party, persistent identity, presence, rating, transactions,
 * independence (no recent transactions with parties), panel concurrency, stake availability.
 */
function buildArbiterPool(server, disputantId, respondentId) {
    return __awaiter(this, void 0, void 0, function () {
        var pool, _i, _a, _b, agent, agentId, rating, activePanels;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    pool = [];
                    _i = 0, _a = server.agents;
                    _c.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    _b = _a[_i], agent = _b[1];
                    agentId = "@".concat(agent.id);
                    // Must not be a party
                    if (agentId === disputantId || agentId === respondentId)
                        return [3 /*break*/, 3];
                    // Must have persistent identity
                    if (!agent.pubkey)
                        return [3 /*break*/, 3];
                    // Must not be away or offline
                    if (agent.presence === 'away' || agent.presence === 'offline')
                        return [3 /*break*/, 3];
                    return [4 /*yield*/, server.reputationStore.getRating(agentId)];
                case 2:
                    rating = _c.sent();
                    if (!rating || rating.rating < disputes_js_1.DISPUTE_CONSTANTS.ARBITER_MIN_RATING)
                        return [3 /*break*/, 3];
                    if (!rating || rating.transactions < disputes_js_1.DISPUTE_CONSTANTS.ARBITER_MIN_TRANSACTIONS)
                        return [3 /*break*/, 3];
                    // Must have sufficient rating for stake (rating - stake > 100 floor)
                    if (rating.rating - disputes_js_1.DISPUTE_CONSTANTS.ARBITER_STAKE < 100)
                        return [3 /*break*/, 3];
                    activePanels = countActivePanels(server, agentId);
                    if (activePanels >= 3)
                        return [3 /*break*/, 3];
                    pool.push(agentId);
                    _c.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, pool];
            }
        });
    });
}
/**
 * Count how many active dispute panels an agent is currently serving on
 */
function countActivePanels(server, agentId) {
    var _a;
    var disputes = server.disputes.listByAgent(agentId);
    var count = 0;
    for (var _i = 0, disputes_1 = disputes; _i < disputes_1.length; _i++) {
        var d = disputes_1[_i];
        if (d.phase === 'arbiter_response' || d.phase === 'evidence' || d.phase === 'deliberation') {
            var isArbiter = (_a = d.arbiters) === null || _a === void 0 ? void 0 : _a.some(function (a) { return a.agent_id === agentId && (a.status === 'pending' || a.status === 'accepted'); });
            if (isArbiter)
                count++;
        }
    }
    return count;
}
/**
 * Send a message to a specific agent by ID
 */
function sendToAgent(server, agentId, msg) {
    var id = agentId.startsWith('@') ? agentId.slice(1) : agentId;
    var ws = server.agentById.get(id);
    if (ws) {
        server._send(ws, msg);
    }
}
/**
 * Handle DISPUTE_INTENT — phase 1 of commit-reveal filing
 */
function handleDisputeIntent(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Filing disputes requires persistent identity'));
        return;
    }
    // Verify signature
    var sigContent = (0, disputes_js_1.getDisputeIntentSigningContent)(msg.proposal_id, msg.reason, msg.commitment);
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'DISPUTE_INTENT' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    // Get the proposal
    var proposal = server.proposals.get(msg.proposal_id);
    if (!proposal) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found'));
        return;
    }
    // Must be accepted to dispute
    if (proposal.status !== 'accepted' && proposal.status !== 'disputed') {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_PROPOSAL, 'Can only dispute accepted proposals'));
        return;
    }
    // Must be a party
    var disputantId = "@".concat(agent.id);
    if (proposal.from !== disputantId && proposal.to !== disputantId) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NOT_PROPOSAL_PARTY, 'Not a party to this proposal'));
        return;
    }
    // Check no existing agentcourt dispute for this proposal
    if (server.disputes.getByProposal(msg.proposal_id)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_ALREADY_EXISTS, 'Agentcourt dispute already filed for this proposal'));
        return;
    }
    var respondentId = proposal.from === disputantId ? proposal.to : proposal.from;
    var dispute = server.disputes.fileIntent(msg.proposal_id, disputantId, respondentId, server.redactor.clean(msg.reason), msg.commitment);
    server._log('dispute_intent', { dispute_id: dispute.id, proposal_id: msg.proposal_id, disputant: agent.id });
    // Set reveal timeout
    server.disputes.setTimeout(dispute.id, disputes_js_1.DISPUTE_CONSTANTS.REVEAL_TIMEOUT_MS, function () {
        var d = server.disputes.get(dispute.id);
        if (d && d.phase === 'reveal_pending') {
            d.phase = 'fallback';
            d.updated_at = Date.now();
            server._log('dispute_reveal_timeout', { dispute_id: dispute.id });
            sendToAgent(server, disputantId, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_FALLBACK, {
                dispute_id: dispute.id,
                reason: 'Reveal timeout expired',
            }));
        }
    });
    // ACK to disputant
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_INTENT_ACK, {
        dispute_id: dispute.id,
        proposal_id: msg.proposal_id,
        server_nonce: dispute.server_nonce,
    }));
    // Notify respondent
    sendToAgent(server, respondentId, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
        from: '@server',
        from_name: 'Server',
        to: respondentId,
        content: "Dispute filed against proposal ".concat(msg.proposal_id, " by ").concat(disputantId, ". Agentcourt panel arbitration in progress."),
    }));
}
/**
 * Handle DISPUTE_REVEAL — phase 2 of commit-reveal filing
 */
function handleDisputeReveal(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, dispute, sigContent;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    dispute = server.disputes.getByProposal(msg.proposal_id);
                    if (!dispute) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_FOUND, 'No pending dispute for this proposal'));
                        return [2 /*return*/];
                    }
                    // Must be the disputant
                    if (dispute.disputant !== "@".concat(agent.id)) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_PARTY, 'Only the disputant can reveal'));
                        return [2 /*return*/];
                    }
                    // Verify signature (disputant proved persistent identity in DISPUTE_INTENT)
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Dispute reveal requires persistent identity'));
                        return [2 /*return*/];
                    }
                    sigContent = (0, disputes_js_1.getDisputeRevealSigningContent)(msg.proposal_id, msg.nonce);
                    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'DISPUTE_REVEAL' });
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                        return [2 /*return*/];
                    }
                    // Acquire per-dispute lock to serialize reveal→buildPool→selectPanel sequence.
                    // Without this, concurrent reveals could interleave across the await boundary.
                    return [4 /*yield*/, server.disputes.withLock(dispute.id, function () { return __awaiter(_this, void 0, void 0, function () {
                            var revealed, pool, selected, fallbackMsg, d, panelMsg, _i, selected_1, arbiterId;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        revealed = server.disputes.reveal(dispute.id, msg.nonce);
                                        if (!revealed) {
                                            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_COMMITMENT_MISMATCH, 'Nonce does not match commitment'));
                                            return [2 /*return*/];
                                        }
                                        server.disputes.clearTimeout(dispute.id);
                                        server._log('dispute_revealed', { dispute_id: dispute.id });
                                        return [4 /*yield*/, buildArbiterPool(server, dispute.disputant, dispute.respondent)];
                                    case 1:
                                        pool = _a.sent();
                                        selected = server.disputes.selectPanel(dispute.id, pool);
                                        if (!selected) {
                                            // Fallback to legacy
                                            server._log('dispute_fallback', { dispute_id: dispute.id, pool_size: pool.length });
                                            fallbackMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_FALLBACK, {
                                                dispute_id: dispute.id,
                                                proposal_id: msg.proposal_id,
                                                reason: "Insufficient eligible arbiters (".concat(pool.length, " available, ").concat(disputes_js_1.DISPUTE_CONSTANTS.PANEL_SIZE, " required)"),
                                            });
                                            sendToAgent(server, dispute.disputant, fallbackMsg);
                                            sendToAgent(server, dispute.respondent, fallbackMsg);
                                            return [2 /*return*/];
                                        }
                                        d = server.disputes.get(dispute.id);
                                        panelMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.PANEL_FORMED, {
                                            dispute_id: dispute.id,
                                            proposal_id: msg.proposal_id,
                                            arbiters: selected,
                                            disputant: dispute.disputant,
                                            respondent: dispute.respondent,
                                            evidence_deadline: null, // set after all arbiters accept
                                            vote_deadline: null,
                                            seed: d.seed,
                                            server_nonce: d.server_nonce,
                                        });
                                        sendToAgent(server, dispute.disputant, panelMsg);
                                        sendToAgent(server, dispute.respondent, panelMsg);
                                        // Send individual assignment to each arbiter
                                        for (_i = 0, selected_1 = selected; _i < selected_1.length; _i++) {
                                            arbiterId = selected_1[_i];
                                            sendToAgent(server, arbiterId, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ARBITER_ASSIGNED, {
                                                dispute_id: dispute.id,
                                                proposal_id: msg.proposal_id,
                                                disputant: dispute.disputant,
                                                respondent: dispute.respondent,
                                                reason: dispute.reason,
                                                response_deadline: Date.now() + disputes_js_1.DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
                                            }));
                                        }
                                        // Set arbiter response timeout
                                        server.disputes.setTimeout(dispute.id, disputes_js_1.DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS, function () {
                                            var d = server.disputes.get(dispute.id);
                                            if (d && d.phase === 'arbiter_response') {
                                                // Forfeit non-responding arbiters
                                                for (var _i = 0, _a = d.arbiters; _i < _a.length; _i++) {
                                                    var slot = _a[_i];
                                                    if (slot.status === 'pending') {
                                                        slot.status = 'forfeited';
                                                    }
                                                }
                                                // Check if enough accepted
                                                var accepted = d.arbiters.filter(function (a) { return a.status === 'accepted'; });
                                                if (accepted.length >= disputes_js_1.DISPUTE_CONSTANTS.PANEL_SIZE) {
                                                    d.phase = 'evidence';
                                                    d.evidence_deadline = Date.now() + disputes_js_1.DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS;
                                                    d.updated_at = Date.now();
                                                }
                                                else {
                                                    d.phase = 'fallback';
                                                    d.updated_at = Date.now();
                                                    var msg_1 = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_FALLBACK, {
                                                        dispute_id: d.id,
                                                        reason: 'Insufficient arbiters accepted',
                                                    });
                                                    sendToAgent(server, d.disputant, msg_1);
                                                    sendToAgent(server, d.respondent, msg_1);
                                                }
                                            }
                                        });
                                        server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_REVEALED, {
                                            dispute_id: dispute.id,
                                            panel_size: selected.length,
                                            seed: d.seed,
                                        }));
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 1:
                    // Acquire per-dispute lock to serialize reveal→buildPool→selectPanel sequence.
                    // Without this, concurrent reveals could interleave across the await boundary.
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Handle EVIDENCE submission
 */
function handleEvidence(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var dispute = server.disputes.get(msg.dispute_id);
    if (!dispute) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
        return;
    }
    var agentId = "@".concat(agent.id);
    if (agentId !== dispute.disputant && agentId !== dispute.respondent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_PARTY, 'Not a party to this dispute'));
        return;
    }
    // Verify signature (both proposal parties have persistent identity)
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Evidence submission requires persistent identity'));
        return;
    }
    var itemsJson = JSON.stringify(msg.items);
    var sigContent = (0, disputes_js_1.getEvidenceSigningContent)(msg.dispute_id, itemsJson);
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'EVIDENCE' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    var success = server.disputes.submitEvidence(msg.dispute_id, agentId, msg.items, server.redactor.clean(msg.statement), msg.sig);
    if (!success) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_DEADLINE_PASSED, 'Evidence submission failed (deadline passed or limit exceeded)'));
        return;
    }
    server._log('evidence_submitted', { dispute_id: msg.dispute_id, agent: agent.id, items: msg.items.length });
    // Notify all parties and arbiters
    var ackMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.EVIDENCE_RECEIVED, {
        dispute_id: msg.dispute_id,
        from: agentId,
        items_count: msg.items.length,
    });
    sendToAgent(server, dispute.disputant, ackMsg);
    sendToAgent(server, dispute.respondent, ackMsg);
    for (var _i = 0, _a = dispute.arbiters; _i < _a.length; _i++) {
        var slot = _a[_i];
        if (slot.status === 'accepted' || slot.status === 'voted') {
            sendToAgent(server, slot.agent_id, ackMsg);
        }
    }
}
/**
 * Handle ARBITER_ACCEPT
 */
function handleArbiterAccept(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var dispute = server.disputes.get(msg.dispute_id);
    if (!dispute) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
        return;
    }
    // Verify signature (arbiters must have persistent identity per buildArbiterPool)
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Arbiter operations require persistent identity'));
        return;
    }
    var sigContent = (0, disputes_js_1.getArbiterAcceptSigningContent)(msg.dispute_id);
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'ARBITER_ACCEPT' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    var agentId = "@".concat(agent.id);
    var success = server.disputes.arbiterAccept(msg.dispute_id, agentId);
    if (!success) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_ARBITER, 'Not a pending arbiter for this dispute'));
        return;
    }
    server._log('arbiter_accepted', { dispute_id: msg.dispute_id, arbiter: agent.id });
    // Check if we transitioned to evidence phase
    var d = server.disputes.get(msg.dispute_id);
    if (d.phase === 'evidence') {
        server.disputes.clearTimeout(msg.dispute_id);
        // Send evidence period notification to all parties
        var evidenceMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
            from: '@server',
            from_name: 'Server',
            to: dispute.disputant,
            content: "All arbiters accepted. Evidence period open until ".concat(new Date(d.evidence_deadline).toISOString(), ". Submit your evidence now."),
        });
        sendToAgent(server, d.disputant, evidenceMsg);
        sendToAgent(server, d.respondent, __assign(__assign({}, evidenceMsg), { to: d.respondent }));
        // Set evidence deadline timeout
        server.disputes.setTimeout(msg.dispute_id, disputes_js_1.DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS, function () {
            var dispute = server.disputes.get(msg.dispute_id);
            if (dispute && dispute.phase === 'evidence') {
                server.disputes.closeEvidence(msg.dispute_id);
                _sendCaseReady(server, msg.dispute_id);
            }
        });
    }
}
/**
 * Handle ARBITER_DECLINE
 */
function handleArbiterDecline(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, dispute, sigContent, agentId;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    dispute = server.disputes.get(msg.dispute_id);
                    if (!dispute) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
                        return [2 /*return*/];
                    }
                    // Verify signature (arbiters must have persistent identity per buildArbiterPool)
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Arbiter operations require persistent identity'));
                        return [2 /*return*/];
                    }
                    if (msg.sig) {
                        sigContent = (0, disputes_js_1.getArbiterDeclineSigningContent)(msg.dispute_id, msg.reason || '');
                        if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                            server._log('sig_verification_failed', { agent: agent.id, msg_type: 'ARBITER_DECLINE' });
                            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                            return [2 /*return*/];
                        }
                    }
                    agentId = "@".concat(agent.id);
                    // Acquire per-dispute lock to serialize decline→buildPool→replace sequence.
                    // Without this, concurrent declines could pick the same replacement or
                    // double-increment replacement_rounds across the await boundary.
                    return [4 /*yield*/, server.disputes.withLock(msg.dispute_id, function () { return __awaiter(_this, void 0, void 0, function () {
                            var pool, replacement, d, fallbackMsg;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, buildArbiterPool(server, dispute.disputant, dispute.respondent)];
                                    case 1:
                                        pool = _a.sent();
                                        replacement = server.disputes.arbiterDecline(msg.dispute_id, agentId, pool);
                                        server._log('arbiter_declined', { dispute_id: msg.dispute_id, arbiter: agent.id, replacement: replacement });
                                        if (replacement) {
                                            // Notify the replacement
                                            sendToAgent(server, replacement, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ARBITER_ASSIGNED, {
                                                dispute_id: msg.dispute_id,
                                                proposal_id: dispute.proposal_id,
                                                disputant: dispute.disputant,
                                                respondent: dispute.respondent,
                                                reason: dispute.reason,
                                                response_deadline: Date.now() + disputes_js_1.DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
                                                is_replacement: true,
                                            }));
                                        }
                                        d = server.disputes.get(msg.dispute_id);
                                        if (d.phase === 'fallback') {
                                            fallbackMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE_FALLBACK, {
                                                dispute_id: msg.dispute_id,
                                                reason: 'Unable to form arbiter panel after replacements',
                                            });
                                            sendToAgent(server, d.disputant, fallbackMsg);
                                            sendToAgent(server, d.respondent, fallbackMsg);
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 1:
                    // Acquire per-dispute lock to serialize decline→buildPool→replace sequence.
                    // Without this, concurrent declines could pick the same replacement or
                    // double-increment replacement_rounds across the await boundary.
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Handle ARBITER_VOTE
 */
function handleArbiterVote(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, dispute, sigContent, agentId, success, d;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    dispute = server.disputes.get(msg.dispute_id);
                    if (!dispute) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
                        return [2 /*return*/];
                    }
                    // Verify signature (arbiters must have persistent identity per buildArbiterPool)
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Arbiter operations require persistent identity'));
                        return [2 /*return*/];
                    }
                    sigContent = (0, disputes_js_1.getVoteSigningContent)(msg.dispute_id, msg.verdict);
                    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'ARBITER_VOTE' });
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                        return [2 /*return*/];
                    }
                    agentId = "@".concat(agent.id);
                    success = server.disputes.castVote(msg.dispute_id, agentId, msg.verdict, msg.reasoning, msg.sig);
                    if (!success) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.DISPUTE_NOT_ARBITER, 'Cannot vote: not an accepted arbiter, wrong phase, or deadline passed'));
                        return [2 /*return*/];
                    }
                    server._log('arbiter_voted', { dispute_id: msg.dispute_id, arbiter: agent.id, verdict: msg.verdict });
                    d = server.disputes.get(msg.dispute_id);
                    if (!(d.phase === 'resolved')) return [3 /*break*/, 2];
                    server.disputes.clearTimeout(msg.dispute_id);
                    return [4 /*yield*/, _sendVerdict(server, msg.dispute_id)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
// ============ Internal helpers ============
/**
 * Send CASE_READY to all arbiters after evidence period closes
 */
function _sendCaseReady(server, disputeId) {
    var _this = this;
    var dispute = server.disputes.get(disputeId);
    if (!dispute)
        return;
    var proposal = server.proposals.get(dispute.proposal_id);
    var caseMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.CASE_READY, {
        dispute_id: disputeId,
        proposal: proposal ? {
            id: proposal.id,
            from: proposal.from,
            to: proposal.to,
            task: proposal.task,
            amount: proposal.amount,
            currency: proposal.currency,
        } : null,
        disputant: dispute.disputant,
        disputant_evidence: dispute.disputant_evidence || null,
        respondent: dispute.respondent,
        respondent_evidence: dispute.respondent_evidence || null,
        vote_deadline: dispute.vote_deadline,
    });
    for (var _i = 0, _a = dispute.arbiters; _i < _a.length; _i++) {
        var slot = _a[_i];
        if (slot.status === 'accepted') {
            sendToAgent(server, slot.agent_id, caseMsg);
        }
    }
    server._log('case_ready', { dispute_id: disputeId });
    // Set vote deadline timeout
    server.disputes.setTimeout(disputeId, disputes_js_1.DISPUTE_CONSTANTS.VOTE_PERIOD_MS, function () { return __awaiter(_this, void 0, void 0, function () {
        var d;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    d = server.disputes.get(disputeId);
                    if (!(d && d.phase === 'deliberation')) return [3 /*break*/, 2];
                    server.disputes.forceResolve(disputeId);
                    return [4 /*yield*/, _sendVerdict(server, disputeId)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    }); });
}
/**
 * Send VERDICT to all parties and arbiters, then apply settlement
 */
function _sendVerdict(server, disputeId) {
    return __awaiter(this, void 0, void 0, function () {
        var dispute, arbiterResults, verdictMsg, _i, _a, slot, allParties, ratings, _b, allParties_1, party, r, settlement, settlementMsg, _c, _d, slot, err_1;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    dispute = server.disputes.get(disputeId);
                    if (!dispute || !dispute.verdict)
                        return [2 /*return*/];
                    arbiterResults = dispute.arbiters
                        .filter(function (a) { return a.status === 'voted' || a.status === 'forfeited'; })
                        .map(function (slot) {
                        var _a, _b, _c;
                        if (slot.status === 'forfeited') {
                            return {
                                arbiter: slot.agent_id,
                                verdict: null,
                                reasoning: null,
                                reward: -disputes_js_1.DISPUTE_CONSTANTS.ARBITER_STAKE,
                            };
                        }
                        var votedWithMajority = ((_a = slot.vote) === null || _a === void 0 ? void 0 : _a.verdict) === dispute.verdict;
                        return {
                            arbiter: slot.agent_id,
                            verdict: (_b = slot.vote) === null || _b === void 0 ? void 0 : _b.verdict,
                            reasoning: (_c = slot.vote) === null || _c === void 0 ? void 0 : _c.reasoning,
                            reward: votedWithMajority ? disputes_js_1.DISPUTE_CONSTANTS.ARBITER_REWARD : 0,
                        };
                    });
                    verdictMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.VERDICT, {
                        dispute_id: disputeId,
                        proposal_id: dispute.proposal_id,
                        verdict: dispute.verdict,
                        votes: dispute.votes.map(function (v) { return ({
                            arbiter: v.arbiter,
                            verdict: v.verdict,
                            reasoning: v.reasoning,
                        }); }),
                        arbiter_results: arbiterResults,
                        resolved_at: dispute.resolved_at,
                    });
                    // Send to all involved parties
                    sendToAgent(server, dispute.disputant, verdictMsg);
                    sendToAgent(server, dispute.respondent, verdictMsg);
                    for (_i = 0, _a = dispute.arbiters; _i < _a.length; _i++) {
                        slot = _a[_i];
                        sendToAgent(server, slot.agent_id, verdictMsg);
                    }
                    server._log('verdict', {
                        dispute_id: disputeId,
                        verdict: dispute.verdict,
                        votes: dispute.votes.length,
                    });
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 7, , 8]);
                    allParties = __spreadArray([dispute.disputant, dispute.respondent], dispute.arbiters.map(function (a) { return a.agent_id; }), true);
                    ratings = {};
                    _b = 0, allParties_1 = allParties;
                    _e.label = 2;
                case 2:
                    if (!(_b < allParties_1.length)) return [3 /*break*/, 5];
                    party = allParties_1[_b];
                    return [4 /*yield*/, server.reputationStore.getRating(party)];
                case 3:
                    r = _e.sent();
                    ratings[party] = { rating: r.rating, transactions: r.transactions };
                    _e.label = 4;
                case 4:
                    _b++;
                    return [3 /*break*/, 2];
                case 5:
                    settlement = (0, disputes_js_1.calculateDisputeSettlement)(dispute, ratings);
                    return [4 /*yield*/, server.reputationStore.applyVerdictSettlement(settlement)];
                case 6:
                    _e.sent();
                    settlementMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.SETTLEMENT_COMPLETE, {
                        dispute_id: disputeId,
                        proposal_id: dispute.proposal_id,
                        verdict: dispute.verdict,
                        rating_changes: settlement,
                    });
                    sendToAgent(server, dispute.disputant, settlementMsg);
                    sendToAgent(server, dispute.respondent, settlementMsg);
                    for (_c = 0, _d = dispute.arbiters; _c < _d.length; _c++) {
                        slot = _d[_c];
                        sendToAgent(server, slot.agent_id, settlementMsg);
                    }
                    server.escrowHooks.emit(escrow_hooks_js_1.EscrowEvent.VERDICT_SETTLED, {
                        dispute_id: disputeId,
                        proposal_id: dispute.proposal_id,
                        verdict: dispute.verdict,
                        rating_changes: settlement,
                    });
                    server._log('settlement_complete', {
                        dispute_id: disputeId,
                        parties: Object.keys(settlement).length,
                    });
                    return [3 /*break*/, 8];
                case 7:
                    err_1 = _e.sent();
                    server._log('settlement_error', { dispute_id: disputeId, error: err_1.message });
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
