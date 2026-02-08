"use strict";
/**
 * Proposal Handlers
 * Handles proposal, accept, reject, complete, dispute operations
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProposal = handleProposal;
exports.handleAccept = handleAccept;
exports.handleReject = handleReject;
exports.handleComplete = handleComplete;
exports.handleDispute = handleDispute;
var protocol_js_1 = require("../../protocol.js");
var proposals_js_1 = require("../../proposals.js");
var escrow_hooks_js_1 = require("../../escrow-hooks.js");
var identity_js_1 = require("../../identity.js");
/**
 * Handle PROPOSAL command
 */
function handleProposal(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    // Proposals require a persistent identity (signature verification)
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Proposals require persistent identity'));
        return;
    }
    // Verify signature
    var sigContent = (0, proposals_js_1.getProposalSigningContent)(msg);
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'PROPOSAL' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    var targetId = msg.to.slice(1);
    var targetWs = server.agentById.get(targetId);
    if (!targetWs) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AGENT_NOT_FOUND, "Agent ".concat(msg.to, " not found")));
        return;
    }
    // Redact secrets from proposal task description
    var taskText = server.redactor.clean(msg.task);
    // Create proposal in store
    var proposal = server.proposals.create({
        from: "@".concat(agent.id),
        to: msg.to,
        task: taskText,
        amount: msg.amount,
        currency: msg.currency,
        payment_code: msg.payment_code,
        terms: msg.terms,
        expires: msg.expires,
        sig: msg.sig,
        elo_stake: msg.elo_stake || null
    });
    server._log('proposal', { id: proposal.id, from: agent.id, to: targetId });
    // Send to target
    var outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.PROPOSAL, __assign({}, (0, proposals_js_1.formatProposal)(proposal)));
    server._send(targetWs, outMsg);
    // Echo back to sender with the assigned ID
    server._send(ws, outMsg);
}
/**
 * Handle ACCEPT command
 */
function handleAccept(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, sigContent, existingProposal, proposerStake, acceptorStake, canProposerStake, canAcceptorStake, result, proposal, escrowResult, creatorId, creatorWs, outMsg;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Accepting proposals requires persistent identity'));
                        return [2 /*return*/];
                    }
                    sigContent = (0, proposals_js_1.getAcceptSigningContent)(msg.proposal_id, msg.payment_code || '', msg.elo_stake || '');
                    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'ACCEPT' });
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                        return [2 /*return*/];
                    }
                    existingProposal = server.proposals.get(msg.proposal_id);
                    if (!existingProposal) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found'));
                        return [2 /*return*/];
                    }
                    proposerStake = existingProposal.proposer_stake || 0;
                    acceptorStake = msg.elo_stake || 0;
                    if (!(proposerStake > 0)) return [3 /*break*/, 2];
                    return [4 /*yield*/, server.reputationStore.canStake(existingProposal.from, proposerStake)];
                case 1:
                    canProposerStake = _a.sent();
                    if (!canProposerStake.canStake) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INSUFFICIENT_REPUTATION, "Proposer: ".concat(canProposerStake.reason)));
                        return [2 /*return*/];
                    }
                    _a.label = 2;
                case 2:
                    if (!(acceptorStake > 0)) return [3 /*break*/, 4];
                    return [4 /*yield*/, server.reputationStore.canStake("@".concat(agent.id), acceptorStake)];
                case 3:
                    canAcceptorStake = _a.sent();
                    if (!canAcceptorStake.canStake) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INSUFFICIENT_REPUTATION, canAcceptorStake.reason));
                        return [2 /*return*/];
                    }
                    _a.label = 4;
                case 4:
                    result = server.proposals.accept(msg.proposal_id, "@".concat(agent.id), msg.sig, msg.payment_code, acceptorStake);
                    if (result.error) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_PROPOSAL, result.error));
                        return [2 /*return*/];
                    }
                    proposal = result.proposal;
                    if (!(proposerStake > 0 || acceptorStake > 0)) return [3 /*break*/, 6];
                    return [4 /*yield*/, server.reputationStore.createEscrow(proposal.id, { agent_id: proposal.from, stake: proposerStake }, { agent_id: proposal.to, stake: acceptorStake }, proposal.expires)];
                case 5:
                    escrowResult = _a.sent();
                    if (escrowResult.success) {
                        proposal.stakes_escrowed = true;
                        server._log('escrow_created', {
                            proposal_id: proposal.id,
                            proposer_stake: proposerStake,
                            acceptor_stake: acceptorStake
                        });
                        // Emit escrow:created hook for external integrations
                        server.escrowHooks.emit(escrow_hooks_js_1.EscrowEvent.CREATED, (0, escrow_hooks_js_1.createEscrowCreatedPayload)(proposal, escrowResult))
                            .catch(function (err) { return server._log('escrow_hook_error', { event: 'created', error: err.message }); });
                    }
                    else {
                        server._log('escrow_error', { proposal_id: proposal.id, error: escrowResult.error });
                    }
                    _a.label = 6;
                case 6:
                    server._log('accept', { id: proposal.id, by: agent.id, proposer_stake: proposerStake, acceptor_stake: acceptorStake });
                    creatorId = proposal.from.slice(1);
                    creatorWs = server.agentById.get(creatorId);
                    outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ACCEPT, __assign({}, (0, proposals_js_1.formatProposalResponse)(proposal, 'accept')));
                    if (creatorWs) {
                        server._send(creatorWs, outMsg);
                    }
                    // Echo to acceptor
                    server._send(ws, outMsg);
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Handle REJECT command
 */
function handleReject(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Rejecting proposals requires persistent identity'));
        return;
    }
    // Verify signature
    var sigContent = (0, proposals_js_1.getRejectSigningContent)(msg.proposal_id, msg.reason || '');
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'REJECT' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    var result = server.proposals.reject(msg.proposal_id, "@".concat(agent.id), msg.sig, msg.reason);
    if (result.error) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_PROPOSAL, result.error));
        return;
    }
    var proposal = result.proposal;
    server._log('reject', { id: proposal.id, by: agent.id });
    // Notify the proposal creator
    var creatorId = proposal.from.slice(1);
    var creatorWs = server.agentById.get(creatorId);
    var outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.REJECT, __assign({}, (0, proposals_js_1.formatProposalResponse)(proposal, 'reject')));
    if (creatorWs) {
        server._send(creatorWs, outMsg);
    }
    // Echo to rejector
    server._send(ws, outMsg);
}
/**
 * Handle COMPLETE command
 */
function handleComplete(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, sigContent, result, proposal, ratingChanges, err_1, outMsg, otherId, otherWs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Completing proposals requires persistent identity'));
                        return [2 /*return*/];
                    }
                    sigContent = (0, proposals_js_1.getCompleteSigningContent)(msg.proposal_id, msg.proof || '');
                    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'COMPLETE' });
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                        return [2 /*return*/];
                    }
                    result = server.proposals.complete(msg.proposal_id, "@".concat(agent.id), msg.sig, msg.proof);
                    if (result.error) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_PROPOSAL, result.error));
                        return [2 /*return*/];
                    }
                    proposal = result.proposal;
                    server._log('complete', { id: proposal.id, by: agent.id });
                    ratingChanges = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, server.reputationStore.processCompletion({
                            type: 'COMPLETE',
                            proposal_id: proposal.id,
                            from: proposal.from,
                            to: proposal.to,
                            amount: proposal.amount
                        })];
                case 2:
                    ratingChanges = _a.sent();
                    server._log('reputation_updated', {
                        proposal_id: proposal.id,
                        changes: ratingChanges,
                        escrow: ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow
                    });
                    // Emit settlement:completion hook for external integrations
                    if (ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow) {
                        server.escrowHooks.emit(escrow_hooks_js_1.EscrowEvent.COMPLETION_SETTLED, (0, escrow_hooks_js_1.createCompletionPayload)(proposal, ratingChanges))
                            .catch(function (err) { return server._log('escrow_hook_error', { event: 'completion', error: err.message }); });
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    server._log('reputation_error', { error: err_1.message });
                    return [3 /*break*/, 4];
                case 4:
                    outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.COMPLETE, __assign(__assign({}, (0, proposals_js_1.formatProposalResponse)(proposal, 'complete')), { rating_changes: ratingChanges }));
                    otherId = proposal.from === "@".concat(agent.id) ? proposal.to.slice(1) : proposal.from.slice(1);
                    otherWs = server.agentById.get(otherId);
                    if (otherWs) {
                        server._send(otherWs, outMsg);
                    }
                    // Echo to completer
                    server._send(ws, outMsg);
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Handle DISPUTE command
 */
function handleDispute(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, sigContent, result, proposal, ratingChanges, err_2, outMsg, otherId, otherWs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    if (!agent.pubkey) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Disputing proposals requires persistent identity'));
                        return [2 /*return*/];
                    }
                    sigContent = (0, proposals_js_1.getDisputeSigningContent)(msg.proposal_id, msg.reason);
                    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
                        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'DISPUTE' });
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
                        return [2 /*return*/];
                    }
                    result = server.proposals.dispute(msg.proposal_id, "@".concat(agent.id), msg.sig, msg.reason);
                    if (result.error) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_PROPOSAL, result.error));
                        return [2 /*return*/];
                    }
                    proposal = result.proposal;
                    server._log('dispute', { id: proposal.id, by: agent.id, reason: msg.reason });
                    ratingChanges = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, server.reputationStore.processDispute({
                            type: 'DISPUTE',
                            proposal_id: proposal.id,
                            from: proposal.from,
                            to: proposal.to,
                            amount: proposal.amount,
                            disputed_by: "@".concat(agent.id)
                        })];
                case 2:
                    ratingChanges = _a.sent();
                    server._log('reputation_updated', {
                        proposal_id: proposal.id,
                        changes: ratingChanges,
                        escrow: ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow
                    });
                    // Emit settlement:dispute hook for external integrations
                    if (ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow) {
                        server.escrowHooks.emit(escrow_hooks_js_1.EscrowEvent.DISPUTE_SETTLED, (0, escrow_hooks_js_1.createDisputePayload)(proposal, ratingChanges))
                            .catch(function (err) { return server._log('escrow_hook_error', { event: 'dispute', error: err.message }); });
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_2 = _a.sent();
                    server._log('reputation_error', { error: err_2.message });
                    return [3 /*break*/, 4];
                case 4:
                    outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.DISPUTE, __assign(__assign({}, (0, proposals_js_1.formatProposalResponse)(proposal, 'dispute')), { rating_changes: ratingChanges }));
                    otherId = proposal.from === "@".concat(agent.id) ? proposal.to.slice(1) : proposal.from.slice(1);
                    otherWs = server.agentById.get(otherId);
                    if (otherWs) {
                        server._send(otherWs, outMsg);
                    }
                    // Echo to disputer
                    server._send(ws, outMsg);
                    return [2 /*return*/];
            }
        });
    });
}
