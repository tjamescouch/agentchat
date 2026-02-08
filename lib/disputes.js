"use strict";
/**
 * AgentChat Disputes Module (Agentcourt)
 * Panel-based arbitration for dispute resolution.
 *
 * Lifecycle: DISPUTE_INTENT → DISPUTE_REVEAL → PANEL_SELECTION →
 *            EVIDENCE_PERIOD → DELIBERATION → VERDICT
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
exports.DisputeStore = exports.DISPUTE_CONSTANTS = void 0;
exports.generateDisputeId = generateDisputeId;
exports.getDisputeIntentSigningContent = getDisputeIntentSigningContent;
exports.getDisputeRevealSigningContent = getDisputeRevealSigningContent;
exports.getEvidenceSigningContent = getEvidenceSigningContent;
exports.getArbiterAcceptSigningContent = getArbiterAcceptSigningContent;
exports.getArbiterDeclineSigningContent = getArbiterDeclineSigningContent;
exports.getVoteSigningContent = getVoteSigningContent;
exports.calculateDisputeSettlement = calculateDisputeSettlement;
var crypto_1 = require("crypto");
// ============ Constants ============
exports.DISPUTE_CONSTANTS = {
    PANEL_SIZE: 3,
    ARBITER_STAKE: 25,
    ARBITER_REWARD: 5,
    ARBITER_MIN_RATING: 1200,
    ARBITER_MIN_TRANSACTIONS: 10,
    ARBITER_INDEPENDENCE_DAYS: 30,
    ARBITER_MIN_ACCOUNT_AGE_DAYS: 7,
    FILING_FEE: 10,
    EVIDENCE_PERIOD_MS: 3600000, // 1 hour
    ARBITER_RESPONSE_TIMEOUT_MS: 1800000, // 30 minutes
    VOTE_PERIOD_MS: 3600000, // 1 hour
    MAX_DISPUTE_DURATION_MS: 14400000, // 4 hours
    MAX_EVIDENCE_ITEMS: 10,
    MAX_STATEMENT_CHARS: 2000,
    MAX_REASONING_CHARS: 500,
    MAX_REPLACEMENT_ROUNDS: 2,
    REVEAL_TIMEOUT_MS: 600000, // 10 minutes
};
// ============ Per-dispute Mutex ============
/**
 * Serializes async operations on a single dispute to prevent interleaving.
 * Uses a promise-chain pattern: each operation awaits the previous one before running.
 */
var DisputeMutex = /** @class */ (function () {
    function DisputeMutex() {
        this.chains = new Map();
    }
    DisputeMutex.prototype.withLock = function (disputeId, fn) {
        return __awaiter(this, void 0, void 0, function () {
            var prev, resolve, next;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        prev = (_a = this.chains.get(disputeId)) !== null && _a !== void 0 ? _a : Promise.resolve();
                        next = new Promise(function (r) { resolve = r; });
                        this.chains.set(disputeId, next);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, , 4, 5]);
                        return [4 /*yield*/, prev];
                    case 2:
                        _b.sent();
                        return [4 /*yield*/, fn()];
                    case 3: return [2 /*return*/, _b.sent()];
                    case 4:
                        resolve();
                        if (this.chains.get(disputeId) === next) {
                            this.chains.delete(disputeId);
                        }
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    return DisputeMutex;
}());
// ============ DisputeStore Class ============
var DisputeStore = /** @class */ (function () {
    function DisputeStore() {
        this.disputes = new Map();
        this.byProposal = new Map(); // proposal_id -> dispute_id
        this.byAgent = new Map(); // agent_id -> Set<dispute_id>
        this.timeoutHandlers = new Map();
        this.mutex = new DisputeMutex();
    }
    /**
     * File a dispute intent (phase 1 of commit-reveal)
     */
    DisputeStore.prototype.fileIntent = function (proposalId, disputantId, respondentId, reason, commitment) {
        var id = generateDisputeId();
        var serverNonce = crypto_1.default.randomBytes(16).toString('hex');
        var dispute = {
            id: id,
            proposal_id: proposalId,
            disputant: disputantId,
            respondent: respondentId,
            reason: reason,
            phase: 'reveal_pending',
            commitment: commitment,
            server_nonce: serverNonce,
            arbiters: [],
            replacement_rounds: 0,
            votes: [],
            created_at: Date.now(),
            updated_at: Date.now(),
            filing_fee_escrowed: true,
        };
        this.disputes.set(id, dispute);
        this.byProposal.set(proposalId, id);
        this._indexAgent(disputantId, id);
        this._indexAgent(respondentId, id);
        return dispute;
    };
    /**
     * Reveal the nonce (phase 2 of commit-reveal)
     * Returns null if commitment doesn't match.
     */
    DisputeStore.prototype.reveal = function (disputeId, nonce) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'reveal_pending')
            return null;
        // Verify commitment
        var hash = crypto_1.default.createHash('sha256').update(nonce).digest('hex');
        if (hash !== dispute.commitment)
            return null;
        dispute.nonce = nonce;
        dispute.phase = 'panel_selection';
        dispute.revealed_at = Date.now();
        dispute.seed = crypto_1.default.createHash('sha256')
            .update(dispute.proposal_id + nonce + dispute.server_nonce)
            .digest('hex');
        dispute.updated_at = Date.now();
        return dispute;
    };
    /**
     * Select arbiters from the eligible pool using seeded PRNG.
     * Returns the selected agent IDs.
     */
    DisputeStore.prototype.selectPanel = function (disputeId, eligiblePool) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'panel_selection' || !dispute.seed)
            return null;
        if (eligiblePool.length < exports.DISPUTE_CONSTANTS.PANEL_SIZE) {
            // Not enough arbiters — fallback to legacy
            dispute.phase = 'fallback';
            dispute.updated_at = Date.now();
            return null;
        }
        // Seeded selection using the seed
        var selected = seededShuffle(eligiblePool, dispute.seed)
            .slice(0, exports.DISPUTE_CONSTANTS.PANEL_SIZE);
        dispute.arbiters = selected.map(function (id) { return ({
            agent_id: id,
            status: 'pending',
        }); });
        dispute.phase = 'arbiter_response';
        dispute.panel_formed_at = Date.now();
        dispute.updated_at = Date.now();
        // Index arbiters
        for (var _i = 0, selected_1 = selected; _i < selected_1.length; _i++) {
            var id = selected_1[_i];
            this._indexAgent(id, disputeId);
        }
        return selected;
    };
    /**
     * Arbiter accepts their panel appointment
     */
    DisputeStore.prototype.arbiterAccept = function (disputeId, arbiterId) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'arbiter_response')
            return false;
        var slot = dispute.arbiters.find(function (a) { return a.agent_id === arbiterId && a.status === 'pending'; });
        if (!slot)
            return false;
        slot.status = 'accepted';
        slot.accepted_at = Date.now();
        dispute.updated_at = Date.now();
        // Check if all arbiters have accepted → move to evidence phase
        if (dispute.arbiters.every(function (a) { return a.status === 'accepted'; })) {
            dispute.phase = 'evidence';
            dispute.evidence_deadline = Date.now() + exports.DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS;
            dispute.updated_at = Date.now();
        }
        return true;
    };
    /**
     * Arbiter declines — forfeit stake, trigger replacement
     */
    DisputeStore.prototype.arbiterDecline = function (disputeId, arbiterId, replacementPool) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'arbiter_response')
            return null;
        var slot = dispute.arbiters.find(function (a) { return a.agent_id === arbiterId && a.status === 'pending'; });
        if (!slot)
            return null;
        slot.status = 'declined';
        dispute.replacement_rounds++;
        dispute.updated_at = Date.now();
        if (dispute.replacement_rounds > exports.DISPUTE_CONSTANTS.MAX_REPLACEMENT_ROUNDS) {
            dispute.phase = 'fallback';
            dispute.updated_at = Date.now();
            return null;
        }
        // Find a replacement from pool (exclude current/past arbiters and parties)
        var excluded = new Set(__spreadArray([
            dispute.disputant,
            dispute.respondent
        ], dispute.arbiters.map(function (a) { return a.agent_id; }), true));
        var candidates = replacementPool.filter(function (id) { return !excluded.has(id); });
        if (candidates.length === 0) {
            dispute.phase = 'fallback';
            dispute.updated_at = Date.now();
            return null;
        }
        // Pick first available (deterministic from remaining pool)
        var replacement = candidates[0];
        slot.status = 'replaced';
        dispute.arbiters.push({
            agent_id: replacement,
            status: 'pending',
        });
        this._indexAgent(replacement, disputeId);
        return replacement;
    };
    /**
     * Submit evidence for a dispute
     */
    DisputeStore.prototype.submitEvidence = function (disputeId, agentId, items, statement, sig) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'evidence')
            return false;
        // Check deadline
        if (dispute.evidence_deadline && Date.now() > dispute.evidence_deadline)
            return false;
        // Reject duplicate submission from same party
        if (agentId === dispute.disputant && dispute.disputant_evidence)
            return false;
        if (agentId === dispute.respondent && dispute.respondent_evidence)
            return false;
        // Validate limits
        if (items.length > exports.DISPUTE_CONSTANTS.MAX_EVIDENCE_ITEMS)
            return false;
        if (statement.length > exports.DISPUTE_CONSTANTS.MAX_STATEMENT_CHARS)
            return false;
        // Hash each item for integrity (sorted keys for deterministic hashing)
        var hashedItems = items.map(function (item) { return (__assign(__assign({}, item), { hash: crypto_1.default.createHash('sha256').update(JSON.stringify(item, Object.keys(item).sort())).digest('hex') })); });
        var evidence = { items: hashedItems, statement: statement, sig: sig };
        if (agentId === dispute.disputant) {
            dispute.disputant_evidence = evidence;
        }
        else if (agentId === dispute.respondent) {
            dispute.respondent_evidence = evidence;
        }
        else {
            return false;
        }
        dispute.updated_at = Date.now();
        return true;
    };
    /**
     * Close evidence period and move to deliberation
     */
    DisputeStore.prototype.closeEvidence = function (disputeId) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'evidence')
            return false;
        dispute.phase = 'deliberation';
        dispute.vote_deadline = Date.now() + exports.DISPUTE_CONSTANTS.VOTE_PERIOD_MS;
        dispute.updated_at = Date.now();
        return true;
    };
    /**
     * Arbiter casts a vote
     */
    DisputeStore.prototype.castVote = function (disputeId, arbiterId, verdict, reasoning, sig) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'deliberation')
            return false;
        // Check deadline
        if (dispute.vote_deadline && Date.now() > dispute.vote_deadline)
            return false;
        // Validate reasoning length
        if (reasoning.length > exports.DISPUTE_CONSTANTS.MAX_REASONING_CHARS)
            return false;
        // Must be an accepted arbiter
        var slot = dispute.arbiters.find(function (a) { return a.agent_id === arbiterId && a.status === 'accepted'; });
        if (!slot)
            return false;
        var vote = {
            arbiter: arbiterId,
            verdict: verdict,
            reasoning: reasoning,
            sig: sig,
            voted_at: Date.now(),
        };
        slot.vote = vote;
        slot.status = 'voted';
        dispute.votes.push(vote);
        dispute.updated_at = Date.now();
        // Check if all accepted arbiters have voted
        var acceptedArbiters = dispute.arbiters.filter(function (a) {
            return a.status === 'accepted' || a.status === 'voted';
        });
        var allVoted = acceptedArbiters.every(function (a) { return a.status === 'voted'; });
        if (allVoted) {
            this._resolveVerdict(dispute);
        }
        return true;
    };
    /**
     * Force-resolve a dispute after vote deadline
     * (some arbiters may not have voted — they forfeit)
     */
    DisputeStore.prototype.forceResolve = function (disputeId) {
        var dispute = this.disputes.get(disputeId);
        if (!dispute || dispute.phase !== 'deliberation')
            return null;
        // Mark non-voters as forfeited
        for (var _i = 0, _a = dispute.arbiters; _i < _a.length; _i++) {
            var slot = _a[_i];
            if (slot.status === 'accepted') {
                slot.status = 'forfeited';
            }
        }
        this._resolveVerdict(dispute);
        return dispute;
    };
    /**
     * Get a dispute by ID
     */
    DisputeStore.prototype.get = function (id) {
        return this.disputes.get(id) || null;
    };
    /**
     * Get dispute by proposal ID
     */
    DisputeStore.prototype.getByProposal = function (proposalId) {
        var disputeId = this.byProposal.get(proposalId);
        if (!disputeId)
            return null;
        return this.get(disputeId);
    };
    /**
     * List disputes involving an agent
     */
    DisputeStore.prototype.listByAgent = function (agentId) {
        var _this = this;
        var ids = this.byAgent.get(agentId) || new Set();
        return Array.from(ids)
            .map(function (id) { return _this.get(id); })
            .filter(function (d) { return d !== null; })
            .sort(function (a, b) { return b.created_at - a.created_at; });
    };
    /**
     * Clear a timeout handler
     */
    DisputeStore.prototype.clearTimeout = function (disputeId) {
        var handler = this.timeoutHandlers.get(disputeId);
        if (handler) {
            globalThis.clearTimeout(handler);
            this.timeoutHandlers.delete(disputeId);
        }
    };
    /**
     * Set a timeout handler for a dispute phase
     */
    DisputeStore.prototype.setTimeout = function (disputeId, ms, callback) {
        this.clearTimeout(disputeId);
        var handler = globalThis.setTimeout(callback, ms);
        this.timeoutHandlers.set(disputeId, handler);
    };
    /**
     * Cleanup all timeouts
     */
    DisputeStore.prototype.close = function () {
        for (var _i = 0, _a = this.timeoutHandlers.values(); _i < _a.length; _i++) {
            var handler = _a[_i];
            globalThis.clearTimeout(handler);
        }
        this.timeoutHandlers.clear();
    };
    /**
     * Acquire a per-dispute lock for async operations.
     * Serializes concurrent reveal/decline/panel-selection sequences
     * that span await boundaries (e.g. buildArbiterPool).
     */
    DisputeStore.prototype.withLock = function (disputeId, fn) {
        return this.mutex.withLock(disputeId, fn);
    };
    // ============ Private ============
    DisputeStore.prototype._resolveVerdict = function (dispute) {
        var votes = dispute.votes;
        if (votes.length === 0) {
            dispute.verdict = 'mutual';
        }
        else {
            // Count votes
            var counts = { disputant: 0, respondent: 0, mutual: 0 };
            for (var _i = 0, votes_1 = votes; _i < votes_1.length; _i++) {
                var v = votes_1[_i];
                counts[v.verdict]++;
            }
            // Majority wins
            if (counts.disputant >= 2) {
                dispute.verdict = 'disputant';
            }
            else if (counts.respondent >= 2) {
                dispute.verdict = 'respondent';
            }
            else {
                // No majority (all different, or 2-voter tie) → mutual
                dispute.verdict = 'mutual';
            }
        }
        dispute.phase = 'resolved';
        dispute.resolved_at = Date.now();
        dispute.updated_at = Date.now();
    };
    DisputeStore.prototype._indexAgent = function (agentId, disputeId) {
        if (!this.byAgent.has(agentId)) {
            this.byAgent.set(agentId, new Set());
        }
        this.byAgent.get(agentId).add(disputeId);
    };
    return DisputeStore;
}());
exports.DisputeStore = DisputeStore;
// ============ Helpers ============
/**
 * Generate a unique dispute ID
 */
function generateDisputeId() {
    var timestamp = Date.now().toString(36);
    var random = crypto_1.default.randomBytes(4).toString('hex');
    return "disp_".concat(timestamp, "_").concat(random);
}
/**
 * Seeded shuffle using SHA256 chain for deterministic random selection
 */
function seededShuffle(arr, seed) {
    var _a;
    var result = __spreadArray([], arr, true);
    var currentSeed = seed;
    for (var i = result.length - 1; i > 0; i--) {
        currentSeed = crypto_1.default.createHash('sha256').update(currentSeed).digest('hex');
        var j = parseInt(currentSeed.substring(0, 8), 16) % (i + 1);
        _a = [result[j], result[i]], result[i] = _a[0], result[j] = _a[1];
    }
    return result;
}
/**
 * Signing content generators for dispute messages
 */
function getDisputeIntentSigningContent(proposalId, reason, commitment) {
    return "DISPUTE_INTENT|".concat(proposalId, "|").concat(reason, "|").concat(commitment);
}
function getDisputeRevealSigningContent(proposalId, nonce) {
    return "DISPUTE_REVEAL|".concat(proposalId, "|").concat(nonce);
}
function getEvidenceSigningContent(disputeId, itemsJson) {
    var hash = crypto_1.default.createHash('sha256').update(itemsJson).digest('hex');
    return "EVIDENCE|".concat(disputeId, "|").concat(hash);
}
function getArbiterAcceptSigningContent(disputeId) {
    return "ARBITER_ACCEPT|".concat(disputeId);
}
function getArbiterDeclineSigningContent(disputeId, reason) {
    return "ARBITER_DECLINE|".concat(disputeId, "|").concat(reason);
}
function getVoteSigningContent(disputeId, verdict) {
    return "VOTE|".concat(disputeId, "|").concat(verdict);
}
/**
 * Calculate all rating changes for a resolved dispute.
 * Uses standard ELO expected outcome formula with configurable K-factor.
 *
 * Party settlements:
 * - Winner gains half of loser's loss (inflation prevention)
 * - Mutual fault: both lose
 *
 * Arbiter settlements:
 * - Majority voter: +ARBITER_REWARD
 * - Dissenting voter: 0 (stake returned)
 * - No-show/forfeited: -ARBITER_STAKE
 */
function calculateDisputeSettlement(dispute, ratings, effectiveK) {
    var _a, _b, _c, _d, _e, _f;
    if (effectiveK === void 0) { effectiveK = 16; }
    var changes = {};
    if (!dispute.verdict || dispute.phase !== 'resolved') {
        throw new Error('Dispute not resolved');
    }
    var disputantRating = (_b = (_a = ratings[dispute.disputant]) === null || _a === void 0 ? void 0 : _a.rating) !== null && _b !== void 0 ? _b : 1200;
    var respondentRating = (_d = (_c = ratings[dispute.respondent]) === null || _c === void 0 ? void 0 : _c.rating) !== null && _d !== void 0 ? _d : 1200;
    // Standard ELO expected outcome
    var eDisputant = 1 / (1 + Math.pow(10, (respondentRating - disputantRating) / 400));
    var eRespondent = 1 - eDisputant;
    if (dispute.verdict === 'disputant') {
        var respondentLoss = Math.max(1, Math.round(effectiveK * eRespondent));
        var disputantGain = Math.max(1, Math.round(respondentLoss * 0.5));
        changes[dispute.disputant] = { oldRating: disputantRating, newRating: disputantRating + disputantGain, change: disputantGain };
        changes[dispute.respondent] = { oldRating: respondentRating, newRating: respondentRating - respondentLoss, change: -respondentLoss };
    }
    else if (dispute.verdict === 'respondent') {
        var disputantLoss = Math.max(1, Math.round(effectiveK * eDisputant));
        var respondentGain = Math.max(1, Math.round(disputantLoss * 0.5));
        changes[dispute.disputant] = { oldRating: disputantRating, newRating: disputantRating - disputantLoss, change: -disputantLoss };
        changes[dispute.respondent] = { oldRating: respondentRating, newRating: respondentRating + respondentGain, change: respondentGain };
    }
    else {
        // Mutual fault: both lose
        var disputantLoss = Math.max(1, Math.round(effectiveK * eDisputant));
        var respondentLoss = Math.max(1, Math.round(effectiveK * eRespondent));
        changes[dispute.disputant] = { oldRating: disputantRating, newRating: disputantRating - disputantLoss, change: -disputantLoss };
        changes[dispute.respondent] = { oldRating: respondentRating, newRating: respondentRating - respondentLoss, change: -respondentLoss };
    }
    // Arbiter rewards/penalties
    for (var _i = 0, _g = dispute.arbiters; _i < _g.length; _i++) {
        var slot = _g[_i];
        var arbiterRating = (_f = (_e = ratings[slot.agent_id]) === null || _e === void 0 ? void 0 : _e.rating) !== null && _f !== void 0 ? _f : 1200;
        if (slot.status === 'voted' && slot.vote) {
            if (slot.vote.verdict === dispute.verdict) {
                // Voted with majority: +ARBITER_REWARD
                changes[slot.agent_id] = { oldRating: arbiterRating, newRating: arbiterRating + exports.DISPUTE_CONSTANTS.ARBITER_REWARD, change: exports.DISPUTE_CONSTANTS.ARBITER_REWARD };
            }
            else {
                // Dissenting: no penalty, stake returned
                changes[slot.agent_id] = { oldRating: arbiterRating, newRating: arbiterRating, change: 0 };
            }
        }
        else if (slot.status === 'forfeited') {
            // No-show: forfeit stake
            changes[slot.agent_id] = { oldRating: arbiterRating, newRating: arbiterRating - exports.DISPUTE_CONSTANTS.ARBITER_STAKE, change: -exports.DISPUTE_CONSTANTS.ARBITER_STAKE };
        }
    }
    return changes;
}
