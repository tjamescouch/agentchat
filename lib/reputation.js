"use strict";
/**
 * AgentChat Reputation Module
 * ELO-based rating system for agent reputation
 *
 * Adapts chess ELO for cooperative agent coordination:
 * - Each agent starts at 1200
 * - On COMPLETE: both agents gain points, scaled by counterparty rating
 * - On DISPUTE: at-fault party loses points
 * - K-factor varies by experience (new agents move faster)
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
exports.ReputationStore = exports.MINIMUM_RATING = exports.ELO_DIVISOR = exports.DEFAULT_RATING = exports.DEFAULT_RATINGS_PATH = void 0;
exports.calculateExpected = calculateExpected;
exports.getKFactor = getKFactor;
exports.getEffectiveK = getEffectiveK;
exports.calculateCompletionGain = calculateCompletionGain;
exports.calculateDisputeLoss = calculateDisputeLoss;
exports.getDefaultStore = getDefaultStore;
var promises_1 = require("fs/promises");
var path_1 = require("path");
// ============ Constants ============
// Default ratings file location
var AGENTCHAT_DIR = path_1.default.join(process.cwd(), '.agentchat');
exports.DEFAULT_RATINGS_PATH = path_1.default.join(AGENTCHAT_DIR, 'ratings.json');
// ELO constants
exports.DEFAULT_RATING = 1200;
exports.ELO_DIVISOR = 400; // Standard ELO divisor
exports.MINIMUM_RATING = 100; // Floor - can't drop below this
// K-factor thresholds
var K_FACTOR_NEW = 32; // < 30 transactions
var K_FACTOR_INTERMEDIATE = 24; // < 100 transactions
var K_FACTOR_ESTABLISHED = 16; // >= 100 transactions
var TRANSACTIONS_NEW = 30;
var TRANSACTIONS_INTERMEDIATE = 100;
// ============ Helper Functions ============
/**
 * Calculate expected outcome (standard ELO formula)
 * E = 1 / (1 + 10^((R_opponent - R_self) / 400))
 *
 * @param selfRating - Your rating
 * @param opponentRating - Counterparty rating
 * @returns Expected outcome (0-1)
 */
function calculateExpected(selfRating, opponentRating) {
    var exponent = (opponentRating - selfRating) / exports.ELO_DIVISOR;
    return 1 / (1 + Math.pow(10, exponent));
}
/**
 * Get K-factor based on transaction count
 * New agents have higher K (volatile), established agents lower K (stable)
 *
 * @param transactions - Number of completed transactions
 * @returns K-factor
 */
function getKFactor(transactions) {
    if (transactions < TRANSACTIONS_NEW) {
        return K_FACTOR_NEW;
    }
    else if (transactions < TRANSACTIONS_INTERMEDIATE) {
        return K_FACTOR_INTERMEDIATE;
    }
    return K_FACTOR_ESTABLISHED;
}
/**
 * Calculate effective K-factor with optional task value weighting
 * effective_K = K * (1 + log10(amount + 1))
 *
 * @param baseK - Base K-factor
 * @param amount - Task value/amount (optional)
 * @returns Effective K-factor
 */
function getEffectiveK(baseK, amount) {
    if (amount === void 0) { amount = 0; }
    if (!amount || amount <= 0) {
        return baseK;
    }
    // Weight by task value: higher value = more rating movement
    // Cap the multiplier to prevent extreme swings
    var multiplier = Math.min(1 + Math.log10(amount + 1), 3);
    return baseK * multiplier;
}
/**
 * Calculate rating change for a completion (cooperative outcome)
 * Both parties gain, but you gain more when completing with higher-rated counterparty
 *
 * @param selfRating - Your current rating
 * @param counterpartyRating - Counterparty's rating
 * @param kFactor - Your K-factor
 * @param amount - Optional task value
 * @returns Rating change (positive)
 */
function calculateCompletionGain(selfRating, counterpartyRating, kFactor, amount) {
    if (amount === void 0) { amount = 0; }
    var expected = calculateExpected(selfRating, counterpartyRating);
    var effectiveK = getEffectiveK(kFactor, amount);
    // Gain = K * (1 - E)
    // You gain more when completing with higher-rated counterparty (lower E)
    var gain = effectiveK * (1 - expected);
    // Minimum gain of 1 point for any completion
    return Math.max(1, Math.round(gain));
}
/**
 * Calculate rating change for a dispute (loss for at-fault party)
 *
 * @param selfRating - Your current rating
 * @param counterpartyRating - Counterparty's rating
 * @param kFactor - Your K-factor
 * @param amount - Optional task value
 * @returns Rating change (negative)
 */
function calculateDisputeLoss(selfRating, counterpartyRating, kFactor, amount) {
    if (amount === void 0) { amount = 0; }
    var expected = calculateExpected(selfRating, counterpartyRating);
    var effectiveK = getEffectiveK(kFactor, amount);
    // Loss = K * E
    // You lose more when you were expected to succeed (higher E)
    var loss = effectiveK * expected;
    // Minimum loss of 1 point
    return -Math.max(1, Math.round(loss));
}
// ============ ReputationStore Class ============
/**
 * Reputation Store - manages agent ratings
 */
var ReputationStore = /** @class */ (function () {
    function ReputationStore(ratingsPath) {
        if (ratingsPath === void 0) { ratingsPath = exports.DEFAULT_RATINGS_PATH; }
        this.ratingsPath = ratingsPath;
        this._ratings = null; // Lazy load
        this._escrows = new Map(); // proposalId -> escrow record
    }
    /**
     * Load ratings from file
     */
    ReputationStore.prototype.load = function () {
        return __awaiter(this, void 0, void 0, function () {
            var content, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, promises_1.default.readFile(this.ratingsPath, 'utf-8')];
                    case 1:
                        content = _a.sent();
                        this._ratings = JSON.parse(content);
                        return [3 /*break*/, 3];
                    case 2:
                        err_1 = _a.sent();
                        if (err_1.code === 'ENOENT') {
                            this._ratings = {}; // No ratings file yet
                        }
                        else {
                            throw err_1;
                        }
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/, this._ratings];
                }
            });
        });
    };
    /**
     * Save ratings to file
     */
    ReputationStore.prototype.save = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, promises_1.default.mkdir(path_1.default.dirname(this.ratingsPath), { recursive: true })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, promises_1.default.writeFile(this.ratingsPath, JSON.stringify(this._ratings, null, 2), { mode: 384 })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Ensure ratings are loaded
     */
    ReputationStore.prototype._ensureLoaded = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this._ratings === null)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.load()];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Normalize agent ID (ensure @ prefix)
     */
    ReputationStore.prototype._normalizeId = function (agentId) {
        return agentId.startsWith('@') ? agentId : "@".concat(agentId);
    };
    /**
     * Get rating for an agent
     * Returns default rating if agent not found
     */
    ReputationStore.prototype.getRating = function (agentId) {
        return __awaiter(this, void 0, void 0, function () {
            var id, record;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._ensureLoaded()];
                    case 1:
                        _a.sent();
                        id = this._normalizeId(agentId);
                        record = this._ratings[id];
                        if (!record) {
                            return [2 /*return*/, {
                                    agentId: id,
                                    rating: exports.DEFAULT_RATING,
                                    transactions: 0,
                                    updated: null,
                                    isNew: true
                                }];
                        }
                        return [2 /*return*/, {
                                agentId: id,
                                rating: record.rating,
                                transactions: record.transactions,
                                updated: record.updated,
                                isNew: false
                            }];
                }
            });
        });
    };
    /**
     * Get K-factor for an agent
     */
    ReputationStore.prototype.getAgentKFactor = function (agentId) {
        return __awaiter(this, void 0, void 0, function () {
            var record;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getRating(agentId)];
                    case 1:
                        record = _a.sent();
                        return [2 /*return*/, getKFactor(record.transactions)];
                }
            });
        });
    };
    /**
     * Get total escrowed ELO for an agent
     */
    ReputationStore.prototype.getEscrowedAmount = function (agentId) {
        var id = this._normalizeId(agentId);
        var total = 0;
        for (var _i = 0, _a = this._escrows.values(); _i < _a.length; _i++) {
            var escrow = _a[_i];
            if (escrow.status === 'active') {
                if (escrow.from.agent_id === id) {
                    total += escrow.from.stake;
                }
                if (escrow.to.agent_id === id) {
                    total += escrow.to.stake;
                }
            }
        }
        return total;
    };
    /**
     * Get available rating for staking (rating - escrowed - minimum floor)
     */
    ReputationStore.prototype.getAvailableRating = function (agentId) {
        return __awaiter(this, void 0, void 0, function () {
            var record, escrowed, available;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getRating(agentId)];
                    case 1:
                        record = _a.sent();
                        escrowed = this.getEscrowedAmount(agentId);
                        available = record.rating - escrowed - exports.MINIMUM_RATING;
                        return [2 /*return*/, Math.max(0, available)];
                }
            });
        });
    };
    /**
     * Check if agent can stake the requested amount
     */
    ReputationStore.prototype.canStake = function (agentId, amount) {
        return __awaiter(this, void 0, void 0, function () {
            var available;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!(!amount || amount <= 0)) return [3 /*break*/, 2];
                        _a = { canStake: true };
                        return [4 /*yield*/, this.getAvailableRating(agentId)];
                    case 1: return [2 /*return*/, (_a.available = _b.sent(), _a)];
                    case 2: return [4 /*yield*/, this.getAvailableRating(agentId)];
                    case 3:
                        available = _b.sent();
                        if (amount > available) {
                            return [2 /*return*/, {
                                    canStake: false,
                                    available: available,
                                    reason: "Insufficient ELO. Available: ".concat(available, ", Requested: ").concat(amount)
                                }];
                        }
                        return [2 /*return*/, { canStake: true, available: available }];
                }
            });
        });
    };
    /**
     * Create escrow for a proposal
     * Called when proposal is accepted with stakes
     */
    ReputationStore.prototype.createEscrow = function (proposalId_1, fromStake_1, toStake_1) {
        return __awaiter(this, arguments, void 0, function (proposalId, fromStake, toStake, expiresAt) {
            var canFrom, canTo, escrow;
            if (expiresAt === void 0) { expiresAt = null; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(fromStake.stake > 0)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.canStake(fromStake.agent_id, fromStake.stake)];
                    case 1:
                        canFrom = _a.sent();
                        if (!canFrom.canStake) {
                            return [2 /*return*/, { success: false, error: "Proposer: ".concat(canFrom.reason) }];
                        }
                        _a.label = 2;
                    case 2:
                        if (!(toStake.stake > 0)) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.canStake(toStake.agent_id, toStake.stake)];
                    case 3:
                        canTo = _a.sent();
                        if (!canTo.canStake) {
                            return [2 /*return*/, { success: false, error: "Acceptor: ".concat(canTo.reason) }];
                        }
                        _a.label = 4;
                    case 4:
                        escrow = {
                            proposal_id: proposalId,
                            created_at: Date.now(),
                            from: {
                                agent_id: this._normalizeId(fromStake.agent_id),
                                stake: fromStake.stake || 0
                            },
                            to: {
                                agent_id: this._normalizeId(toStake.agent_id),
                                stake: toStake.stake || 0
                            },
                            status: 'active',
                            expires_at: expiresAt,
                            settled_at: null,
                            settlement_reason: null
                        };
                        this._escrows.set(proposalId, escrow);
                        return [2 /*return*/, { success: true, escrow: escrow }];
                }
            });
        });
    };
    /**
     * Get escrow for a proposal
     */
    ReputationStore.prototype.getEscrow = function (proposalId) {
        return this._escrows.get(proposalId) || null;
    };
    /**
     * Release escrow (return stakes to both parties, no rating change)
     * Used for proposal expiration
     */
    ReputationStore.prototype.releaseEscrow = function (proposalId) {
        var escrow = this._escrows.get(proposalId);
        if (!escrow) {
            return { released: false, error: 'Escrow not found' };
        }
        if (escrow.status !== 'active') {
            return { released: false, error: "Escrow already ".concat(escrow.status) };
        }
        escrow.status = 'released';
        escrow.settled_at = Date.now();
        escrow.settlement_reason = 'expired';
        return { released: true, escrow: escrow };
    };
    /**
     * Update rating for an agent
     */
    ReputationStore.prototype._updateAgent = function (agentId, ratingChange) {
        return __awaiter(this, void 0, void 0, function () {
            var id;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._ensureLoaded()];
                    case 1:
                        _a.sent();
                        id = this._normalizeId(agentId);
                        if (!this._ratings[id]) {
                            this._ratings[id] = {
                                rating: exports.DEFAULT_RATING,
                                transactions: 0,
                                updated: null
                            };
                        }
                        this._ratings[id].rating = Math.max(100, this._ratings[id].rating + ratingChange);
                        this._ratings[id].transactions += 1;
                        this._ratings[id].updated = new Date().toISOString();
                        return [2 /*return*/, this._ratings[id]];
                }
            });
        });
    };
    /**
     * Process a COMPLETE receipt - both parties gain (halved gains with staking)
     *
     * @param receipt - The COMPLETE receipt
     * @returns Rating changes for both parties
     */
    ReputationStore.prototype.processCompletion = function (receipt) {
        return __awaiter(this, void 0, void 0, function () {
            var party1, party2, amount, proposalId, rating1, rating2, k1, k2, fullGain1, fullGain2, gain1, gain2, escrowSettlement, escrow, updated1, updated2, result;
            var _a;
            var _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        party1 = ((_b = receipt.proposal) === null || _b === void 0 ? void 0 : _b.from) || receipt.from;
                        party2 = ((_c = receipt.proposal) === null || _c === void 0 ? void 0 : _c.to) || receipt.to;
                        amount = ((_d = receipt.proposal) === null || _d === void 0 ? void 0 : _d.amount) || receipt.amount || 0;
                        proposalId = receipt.proposal_id;
                        if (!party1 || !party2) {
                            throw new Error('Receipt missing party information');
                        }
                        return [4 /*yield*/, this.getRating(party1)];
                    case 1:
                        rating1 = _e.sent();
                        return [4 /*yield*/, this.getRating(party2)];
                    case 2:
                        rating2 = _e.sent();
                        k1 = getKFactor(rating1.transactions);
                        k2 = getKFactor(rating2.transactions);
                        fullGain1 = calculateCompletionGain(rating1.rating, rating2.rating, k1, amount);
                        fullGain2 = calculateCompletionGain(rating2.rating, rating1.rating, k2, amount);
                        gain1 = Math.max(1, Math.round(fullGain1 / 2));
                        gain2 = Math.max(1, Math.round(fullGain2 / 2));
                        escrowSettlement = null;
                        if (proposalId) {
                            escrow = this._escrows.get(proposalId);
                            if (escrow && escrow.status === 'active') {
                                escrow.status = 'settled';
                                escrow.settled_at = Date.now();
                                escrow.settlement_reason = 'completed';
                                escrowSettlement = {
                                    proposer_stake: escrow.from.stake,
                                    acceptor_stake: escrow.to.stake,
                                    settlement: 'returned'
                                };
                            }
                        }
                        return [4 /*yield*/, this._updateAgent(party1, gain1)];
                    case 3:
                        updated1 = _e.sent();
                        return [4 /*yield*/, this._updateAgent(party2, gain2)];
                    case 4:
                        updated2 = _e.sent();
                        // Save
                        return [4 /*yield*/, this.save()];
                    case 5:
                        // Save
                        _e.sent();
                        result = (_a = {},
                            _a[party1] = {
                                oldRating: rating1.rating,
                                newRating: updated1.rating,
                                change: gain1,
                                transactions: updated1.transactions
                            },
                            _a[party2] = {
                                oldRating: rating2.rating,
                                newRating: updated2.rating,
                                change: gain2,
                                transactions: updated2.transactions
                            },
                            _a);
                        if (escrowSettlement) {
                            result._escrow = escrowSettlement;
                        }
                        return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Process a DISPUTE receipt
     * If disputed_by is set, they are the "winner" (counterparty is at fault)
     * Otherwise, both parties lose (mutual fault)
     * Stakes are transferred to winner or burned on mutual fault
     *
     * @param receipt - The DISPUTE receipt
     * @returns Rating changes for both parties
     */
    ReputationStore.prototype.processDispute = function (receipt) {
        return __awaiter(this, void 0, void 0, function () {
            var party1, party2, disputedBy, amount, proposalId, rating1, rating2, k1, k2, escrow, stake1, stake2, change1, change2, escrowSettlement, atFault, updated1, updated2, result;
            var _a;
            var _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        party1 = ((_b = receipt.proposal) === null || _b === void 0 ? void 0 : _b.from) || receipt.from;
                        party2 = ((_c = receipt.proposal) === null || _c === void 0 ? void 0 : _c.to) || receipt.to;
                        disputedBy = receipt.disputed_by;
                        amount = ((_d = receipt.proposal) === null || _d === void 0 ? void 0 : _d.amount) || receipt.amount || 0;
                        proposalId = receipt.proposal_id;
                        if (!party1 || !party2) {
                            throw new Error('Receipt missing party information');
                        }
                        return [4 /*yield*/, this.getRating(party1)];
                    case 1:
                        rating1 = _e.sent();
                        return [4 /*yield*/, this.getRating(party2)];
                    case 2:
                        rating2 = _e.sent();
                        k1 = getKFactor(rating1.transactions);
                        k2 = getKFactor(rating2.transactions);
                        escrow = null;
                        stake1 = 0, stake2 = 0;
                        if (proposalId) {
                            escrow = this._escrows.get(proposalId) || null;
                            if (escrow && escrow.status === 'active') {
                                stake1 = escrow.from.agent_id === this._normalizeId(party1)
                                    ? escrow.from.stake
                                    : escrow.to.stake;
                                stake2 = escrow.from.agent_id === this._normalizeId(party2)
                                    ? escrow.from.stake
                                    : escrow.to.stake;
                            }
                        }
                        escrowSettlement = null;
                        if (disputedBy) {
                            atFault = disputedBy === party1 ? party2 : party1;
                            if (atFault === party1) {
                                // Party1 at fault: loses ELO + loses stake to party2
                                change1 = calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount) - stake1;
                                change2 = Math.round(Math.abs(calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount)) * 0.5) + stake1;
                                escrowSettlement = {
                                    proposer_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.from.stake) || 0,
                                    acceptor_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.to.stake) || 0,
                                    settlement: 'transferred',
                                    transferred_to: party2,
                                    transferred_amount: stake1
                                };
                            }
                            else {
                                // Party2 at fault: loses ELO + loses stake to party1
                                change2 = calculateDisputeLoss(rating2.rating, rating1.rating, k2, amount) - stake2;
                                change1 = Math.round(Math.abs(calculateDisputeLoss(rating2.rating, rating1.rating, k2, amount)) * 0.5) + stake2;
                                escrowSettlement = {
                                    proposer_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.from.stake) || 0,
                                    acceptor_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.to.stake) || 0,
                                    settlement: 'transferred',
                                    transferred_to: party1,
                                    transferred_amount: stake2
                                };
                            }
                        }
                        else {
                            // Mutual fault - both lose ELO + both stakes burned
                            change1 = calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount) - stake1;
                            change2 = calculateDisputeLoss(rating2.rating, rating1.rating, k2, amount) - stake2;
                            escrowSettlement = {
                                proposer_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.from.stake) || 0,
                                acceptor_stake: (escrow === null || escrow === void 0 ? void 0 : escrow.to.stake) || 0,
                                settlement: 'burned',
                                burned_amount: stake1 + stake2
                            };
                        }
                        // Settle escrow
                        if (escrow && escrow.status === 'active') {
                            escrow.status = 'settled';
                            escrow.settled_at = Date.now();
                            escrow.settlement_reason = 'disputed';
                        }
                        return [4 /*yield*/, this._updateAgent(party1, change1)];
                    case 3:
                        updated1 = _e.sent();
                        return [4 /*yield*/, this._updateAgent(party2, change2)];
                    case 4:
                        updated2 = _e.sent();
                        return [4 /*yield*/, this.save()];
                    case 5:
                        _e.sent();
                        result = (_a = {},
                            _a[party1] = {
                                oldRating: rating1.rating,
                                newRating: updated1.rating,
                                change: change1,
                                transactions: updated1.transactions
                            },
                            _a[party2] = {
                                oldRating: rating2.rating,
                                newRating: updated2.rating,
                                change: change2,
                                transactions: updated2.transactions
                            },
                            _a);
                        if (escrowSettlement) {
                            result._escrow = escrowSettlement;
                        }
                        return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Apply pre-calculated rating changes from an agentcourt verdict settlement.
     * Takes the output of calculateDisputeSettlement() and persists the changes.
     */
    ReputationStore.prototype.applyVerdictSettlement = function (changes) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, _b, agentId, change;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _i = 0, _a = Object.entries(changes);
                        _c.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        _b = _a[_i], agentId = _b[0], change = _b[1].change;
                        return [4 /*yield*/, this._updateAgent(agentId, change)];
                    case 2:
                        _c.sent();
                        _c.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [4 /*yield*/, this.save()];
                    case 5:
                        _c.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Process a receipt (routes to completion or dispute)
     */
    ReputationStore.prototype.updateRatings = function (receipt) {
        return __awaiter(this, void 0, void 0, function () {
            var type;
            return __generator(this, function (_a) {
                type = receipt.type || receipt.status;
                if (type === 'COMPLETE' || type === 'completed') {
                    return [2 /*return*/, this.processCompletion(receipt)];
                }
                else if (type === 'DISPUTE' || type === 'disputed') {
                    return [2 /*return*/, this.processDispute(receipt)];
                }
                // Not a rating-relevant receipt type
                return [2 /*return*/, null];
            });
        });
    };
    /**
     * Export all ratings
     */
    ReputationStore.prototype.exportRatings = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._ensureLoaded()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, __assign({}, this._ratings)];
                }
            });
        });
    };
    /**
     * Get all ratings sorted by rating (descending)
     */
    ReputationStore.prototype.getLeaderboard = function () {
        return __awaiter(this, arguments, void 0, function (limit) {
            var entries;
            if (limit === void 0) { limit = 50; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._ensureLoaded()];
                    case 1:
                        _a.sent();
                        entries = Object.entries(this._ratings)
                            .map(function (_a) {
                            var id = _a[0], data = _a[1];
                            return ({
                                agentId: id,
                                rating: data.rating,
                                transactions: data.transactions,
                                updated: data.updated
                            });
                        })
                            .sort(function (a, b) { return b.rating - a.rating; })
                            .slice(0, limit);
                        return [2 /*return*/, entries];
                }
            });
        });
    };
    /**
     * Recalculate all ratings from receipt history
     *
     * @param receipts - Array of receipts to process
     */
    ReputationStore.prototype.recalculateFromReceipts = function (receipts) {
        return __awaiter(this, void 0, void 0, function () {
            var sorted, _i, sorted_1, receipt, err_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Reset ratings
                        this._ratings = {};
                        sorted = __spreadArray([], receipts, true).sort(function (a, b) {
                            var tsA = a.completed_at || a.disputed_at || a.stored_at || 0;
                            var tsB = b.completed_at || b.disputed_at || b.stored_at || 0;
                            return tsA - tsB;
                        });
                        _i = 0, sorted_1 = sorted;
                        _a.label = 1;
                    case 1:
                        if (!(_i < sorted_1.length)) return [3 /*break*/, 6];
                        receipt = sorted_1[_i];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.updateRatings(receipt)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        err_2 = _a.sent();
                        // Skip invalid receipts
                        console.error("Skipping invalid receipt: ".concat(err_2.message));
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: 
                    // Save is called by updateRatings, but save final state
                    return [4 /*yield*/, this.save()];
                    case 7:
                        // Save is called by updateRatings, but save final state
                        _a.sent();
                        return [2 /*return*/, this._ratings];
                }
            });
        });
    };
    /**
     * Get statistics about the rating system
     */
    ReputationStore.prototype.getStats = function () {
        return __awaiter(this, void 0, void 0, function () {
            var ratings, totalTransactions;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._ensureLoaded()];
                    case 1:
                        _a.sent();
                        ratings = Object.values(this._ratings).map(function (r) { return r.rating; });
                        if (ratings.length === 0) {
                            return [2 /*return*/, {
                                    totalAgents: 0,
                                    averageRating: exports.DEFAULT_RATING,
                                    highestRating: exports.DEFAULT_RATING,
                                    lowestRating: exports.DEFAULT_RATING,
                                    totalTransactions: 0
                                }];
                        }
                        totalTransactions = Object.values(this._ratings)
                            .reduce(function (sum, r) { return sum + r.transactions; }, 0);
                        return [2 /*return*/, {
                                totalAgents: ratings.length,
                                averageRating: Math.round(ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length),
                                highestRating: Math.max.apply(Math, ratings),
                                lowestRating: Math.min.apply(Math, ratings),
                                totalTransactions: totalTransactions
                            }];
                }
            });
        });
    };
    return ReputationStore;
}());
exports.ReputationStore = ReputationStore;
// ============ Default Instance ============
// Default instance for convenience
var defaultStore = null;
function getDefaultStore() {
    if (!defaultStore) {
        defaultStore = new ReputationStore();
    }
    return defaultStore;
}
