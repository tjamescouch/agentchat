"use strict";
/**
 * AgentChat Proposals Module
 * Handles structured negotiation between agents
 *
 * Proposals enable agents to make verifiable, signed commitments
 * for work, services, or payments.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalStore = void 0;
exports.formatProposal = formatProposal;
exports.formatProposalResponse = formatProposalResponse;
exports.getProposalSigningContent = getProposalSigningContent;
exports.getAcceptSigningContent = getAcceptSigningContent;
exports.getRejectSigningContent = getRejectSigningContent;
exports.getCompleteSigningContent = getCompleteSigningContent;
exports.getDisputeSigningContent = getDisputeSigningContent;
var protocol_js_1 = require("./protocol.js");
// ============ ProposalStore Class ============
/**
 * In-memory proposal store
 * In production, this could be backed by persistence
 */
var ProposalStore = /** @class */ (function () {
    function ProposalStore() {
        var _this = this;
        // Map of proposal_id -> proposal object
        this.proposals = new Map();
        // Index by agent for quick lookups
        this.byAgent = new Map(); // agent_id -> Set of proposal_ids
        // Cleanup expired proposals periodically
        this.cleanupInterval = setInterval(function () { return _this.cleanupExpired(); }, 60000);
    }
    /**
     * Create a new proposal
     */
    ProposalStore.prototype.create = function (proposal) {
        var id = proposal.id || (0, protocol_js_1.generateProposalId)();
        var now = Date.now();
        var stored = {
            id: id,
            from: proposal.from,
            to: proposal.to,
            task: proposal.task,
            amount: proposal.amount || null,
            currency: proposal.currency || null,
            payment_code: proposal.payment_code || null,
            terms: proposal.terms || null,
            expires: proposal.expires ? now + (proposal.expires * 1000) : null,
            status: protocol_js_1.ProposalStatus.PENDING,
            created_at: now,
            updated_at: now,
            sig: proposal.sig,
            // ELO staking
            proposer_stake: proposal.elo_stake || null,
            acceptor_stake: null,
            stakes_escrowed: false,
            // Response tracking
            response_sig: null,
            response_payment_code: null,
            completed_at: null,
            completion_proof: null,
            dispute_reason: null
        };
        this.proposals.set(id, stored);
        // Index by both agents
        this._indexAgent(proposal.from, id);
        this._indexAgent(proposal.to, id);
        return stored;
    };
    /**
     * Get a proposal by ID
     */
    ProposalStore.prototype.get = function (id) {
        var proposal = this.proposals.get(id);
        if (!proposal)
            return null;
        // Check expiration
        if (proposal.expires && Date.now() > proposal.expires) {
            if (proposal.status === protocol_js_1.ProposalStatus.PENDING) {
                proposal.status = protocol_js_1.ProposalStatus.EXPIRED;
                proposal.updated_at = Date.now();
            }
        }
        return proposal;
    };
    /**
     * Accept a proposal
     * @param id - Proposal ID
     * @param acceptorId - Agent accepting the proposal
     * @param sig - Signature of acceptance
     * @param payment_code - Optional payment code
     * @param acceptor_stake - Optional ELO stake from acceptor
     */
    ProposalStore.prototype.accept = function (id, acceptorId, sig, payment_code, acceptor_stake) {
        if (payment_code === void 0) { payment_code = null; }
        if (acceptor_stake === void 0) { acceptor_stake = null; }
        var proposal = this.get(id);
        if (!proposal) {
            return { error: 'PROPOSAL_NOT_FOUND' };
        }
        if (proposal.status !== protocol_js_1.ProposalStatus.PENDING) {
            return { error: 'PROPOSAL_NOT_PENDING', status: proposal.status };
        }
        if (proposal.to !== acceptorId) {
            return { error: 'NOT_PROPOSAL_RECIPIENT' };
        }
        if (proposal.expires && Date.now() > proposal.expires) {
            proposal.status = protocol_js_1.ProposalStatus.EXPIRED;
            proposal.updated_at = Date.now();
            return { error: 'PROPOSAL_EXPIRED' };
        }
        proposal.status = protocol_js_1.ProposalStatus.ACCEPTED;
        proposal.response_sig = sig;
        proposal.response_payment_code = payment_code;
        proposal.acceptor_stake = acceptor_stake;
        proposal.updated_at = Date.now();
        return { proposal: proposal };
    };
    /**
     * Reject a proposal
     */
    ProposalStore.prototype.reject = function (id, rejectorId, sig, reason) {
        if (reason === void 0) { reason = null; }
        var proposal = this.get(id);
        if (!proposal) {
            return { error: 'PROPOSAL_NOT_FOUND' };
        }
        if (proposal.status !== protocol_js_1.ProposalStatus.PENDING) {
            return { error: 'PROPOSAL_NOT_PENDING', status: proposal.status };
        }
        if (proposal.to !== rejectorId) {
            return { error: 'NOT_PROPOSAL_RECIPIENT' };
        }
        proposal.status = protocol_js_1.ProposalStatus.REJECTED;
        proposal.response_sig = sig;
        proposal.reject_reason = reason;
        proposal.updated_at = Date.now();
        return { proposal: proposal };
    };
    /**
     * Mark a proposal as complete
     */
    ProposalStore.prototype.complete = function (id, completerId, sig, proof) {
        if (proof === void 0) { proof = null; }
        var proposal = this.get(id);
        if (!proposal) {
            return { error: 'PROPOSAL_NOT_FOUND' };
        }
        if (proposal.status !== protocol_js_1.ProposalStatus.ACCEPTED) {
            return { error: 'PROPOSAL_NOT_ACCEPTED', status: proposal.status };
        }
        // Either party can mark as complete
        if (proposal.from !== completerId && proposal.to !== completerId) {
            return { error: 'NOT_PROPOSAL_PARTY' };
        }
        proposal.status = protocol_js_1.ProposalStatus.COMPLETED;
        proposal.completed_at = Date.now();
        proposal.completion_proof = proof;
        proposal.completion_sig = sig;
        proposal.completed_by = completerId;
        proposal.updated_at = Date.now();
        return { proposal: proposal };
    };
    /**
     * Dispute a proposal
     */
    ProposalStore.prototype.dispute = function (id, disputerId, sig, reason) {
        var proposal = this.get(id);
        if (!proposal) {
            return { error: 'PROPOSAL_NOT_FOUND' };
        }
        // Can only dispute accepted proposals
        if (proposal.status !== protocol_js_1.ProposalStatus.ACCEPTED) {
            return { error: 'PROPOSAL_NOT_ACCEPTED', status: proposal.status };
        }
        // Either party can dispute
        if (proposal.from !== disputerId && proposal.to !== disputerId) {
            return { error: 'NOT_PROPOSAL_PARTY' };
        }
        proposal.status = protocol_js_1.ProposalStatus.DISPUTED;
        proposal.dispute_reason = reason;
        proposal.dispute_sig = sig;
        proposal.disputed_by = disputerId;
        proposal.disputed_at = Date.now();
        proposal.updated_at = Date.now();
        return { proposal: proposal };
    };
    /**
     * List proposals for an agent
     */
    ProposalStore.prototype.listByAgent = function (agentId, options) {
        var _this = this;
        if (options === void 0) { options = {}; }
        var ids = this.byAgent.get(agentId) || new Set();
        var proposals = Array.from(ids)
            .map(function (id) { return _this.get(id); })
            .filter(function (p) { return p !== null; });
        // Filter by status
        if (options.status) {
            proposals = proposals.filter(function (p) { return p.status === options.status; });
        }
        // Filter by role (from/to)
        if (options.role === 'from') {
            proposals = proposals.filter(function (p) { return p.from === agentId; });
        }
        else if (options.role === 'to') {
            proposals = proposals.filter(function (p) { return p.to === agentId; });
        }
        // Sort by created_at descending
        proposals.sort(function (a, b) { return b.created_at - a.created_at; });
        // Limit
        if (options.limit) {
            proposals = proposals.slice(0, options.limit);
        }
        return proposals;
    };
    /**
     * Index a proposal by agent
     */
    ProposalStore.prototype._indexAgent = function (agentId, proposalId) {
        if (!this.byAgent.has(agentId)) {
            this.byAgent.set(agentId, new Set());
        }
        this.byAgent.get(agentId).add(proposalId);
    };
    /**
     * Clean up expired proposals (older than 24 hours after expiration)
     */
    ProposalStore.prototype.cleanupExpired = function () {
        var cutoff = Date.now() - (24 * 60 * 60 * 1000);
        for (var _i = 0, _a = this.proposals; _i < _a.length; _i++) {
            var _b = _a[_i], id = _b[0], proposal = _b[1];
            if (proposal.expires && proposal.expires < cutoff) {
                this.proposals.delete(id);
                // Remove from agent indices
                var fromSet = this.byAgent.get(proposal.from);
                if (fromSet)
                    fromSet.delete(id);
                var toSet = this.byAgent.get(proposal.to);
                if (toSet)
                    toSet.delete(id);
            }
        }
    };
    /**
     * Stop the cleanup interval
     */
    ProposalStore.prototype.close = function () {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    };
    /**
     * Get stats about the proposal store
     */
    ProposalStore.prototype.stats = function () {
        var byStatus = {};
        for (var _i = 0, _a = this.proposals.values(); _i < _a.length; _i++) {
            var proposal = _a[_i];
            byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
        }
        return {
            total: this.proposals.size,
            byStatus: byStatus,
            agents: this.byAgent.size
        };
    };
    return ProposalStore;
}());
exports.ProposalStore = ProposalStore;
// ============ Helper Functions ============
/**
 * Format a proposal for display/transmission
 */
function formatProposal(proposal) {
    return {
        id: proposal.id,
        from: proposal.from,
        to: proposal.to,
        task: proposal.task,
        amount: proposal.amount,
        currency: proposal.currency,
        payment_code: proposal.payment_code,
        terms: proposal.terms,
        expires: proposal.expires,
        status: proposal.status,
        created_at: proposal.created_at,
        sig: proposal.sig,
        elo_stake: proposal.proposer_stake
    };
}
/**
 * Format a proposal response (accept/reject/complete/dispute)
 */
function formatProposalResponse(proposal, responseType) {
    var base = {
        proposal_id: proposal.id,
        status: proposal.status,
        updated_at: proposal.updated_at
    };
    switch (responseType) {
        case 'accept':
            return __assign(__assign({}, base), { from: proposal.from, to: proposal.to, payment_code: proposal.response_payment_code, sig: proposal.response_sig, proposer_stake: proposal.proposer_stake, acceptor_stake: proposal.acceptor_stake });
        case 'reject':
            return __assign(__assign({}, base), { from: proposal.from, to: proposal.to, reason: proposal.reject_reason, sig: proposal.response_sig });
        case 'complete':
            return __assign(__assign({}, base), { from: proposal.from, to: proposal.to, completed_by: proposal.completed_by, completed_at: proposal.completed_at, proof: proposal.completion_proof, sig: proposal.completion_sig, elo_stakes: {
                    proposer: proposal.proposer_stake || 0,
                    acceptor: proposal.acceptor_stake || 0
                } });
        case 'dispute':
            return __assign(__assign({}, base), { from: proposal.from, to: proposal.to, disputed_by: proposal.disputed_by, disputed_at: proposal.disputed_at, reason: proposal.dispute_reason, sig: proposal.dispute_sig, elo_stakes: {
                    proposer: proposal.proposer_stake || 0,
                    acceptor: proposal.acceptor_stake || 0
                } });
        default:
            return base;
    }
}
/**
 * Create proposal content string for signing
 * This ensures both parties sign the same canonical data
 */
function getProposalSigningContent(proposal) {
    var fields = [
        proposal.to,
        proposal.task,
        proposal.amount || '',
        proposal.currency || '',
        proposal.payment_code || '',
        proposal.expires || '',
        proposal.elo_stake || ''
    ];
    return fields.join('|');
}
/**
 * Create accept content string for signing
 * @param proposalId - The proposal being accepted
 * @param payment_code - Optional payment code
 * @param elo_stake - Optional ELO stake from acceptor
 */
function getAcceptSigningContent(proposalId, payment_code, elo_stake) {
    if (payment_code === void 0) { payment_code = ''; }
    if (elo_stake === void 0) { elo_stake = ''; }
    return "ACCEPT|".concat(proposalId, "|").concat(payment_code, "|").concat(elo_stake);
}
/**
 * Create reject content string for signing
 */
function getRejectSigningContent(proposalId, reason) {
    if (reason === void 0) { reason = ''; }
    return "REJECT|".concat(proposalId, "|").concat(reason);
}
/**
 * Create complete content string for signing
 */
function getCompleteSigningContent(proposalId, proof) {
    if (proof === void 0) { proof = ''; }
    return "COMPLETE|".concat(proposalId, "|").concat(proof);
}
/**
 * Create dispute content string for signing
 */
function getDisputeSigningContent(proposalId, reason) {
    return "DISPUTE|".concat(proposalId, "|").concat(reason);
}
