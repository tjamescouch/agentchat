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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationStore = exports.PAIR_COOLDOWN_MS = exports.MINIMUM_RATING = exports.ELO_DIVISOR = exports.DEFAULT_RATING = exports.DEFAULT_RATINGS_PATH = void 0;
exports.calculateExpected = calculateExpected;
exports.getKFactor = getKFactor;
exports.getEffectiveK = getEffectiveK;
exports.calculateCompletionGain = calculateCompletionGain;
exports.calculateDisputeLoss = calculateDisputeLoss;
exports.getDefaultStore = getDefaultStore;
const promises_1 = require("fs/promises");
const path_1 = require("path");
// ============ Constants ============
// Default ratings file location
const AGENTCHAT_DIR = path_1.default.join(process.env.DATA_DIR || process.cwd(), '.agentchat');
exports.DEFAULT_RATINGS_PATH = path_1.default.join(AGENTCHAT_DIR, 'ratings.json');
// ELO constants
exports.DEFAULT_RATING = 1200;
exports.ELO_DIVISOR = 400; // Standard ELO divisor
exports.MINIMUM_RATING = 100; // Floor - can't drop below this
// K-factor thresholds
const K_FACTOR_NEW = 32; // < 30 transactions
const K_FACTOR_INTERMEDIATE = 24; // < 100 transactions
const K_FACTOR_ESTABLISHED = 16; // >= 100 transactions
const TRANSACTIONS_NEW = 30;
const TRANSACTIONS_INTERMEDIATE = 100;
// Anti-sybil constants
exports.PAIR_COOLDOWN_MS = 3600000; // 1 hour between same-pair completions
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
    const exponent = (opponentRating - selfRating) / exports.ELO_DIVISOR;
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
function getEffectiveK(baseK, amount = 0) {
    if (!amount || amount <= 0) {
        return baseK;
    }
    // Weight by task value: higher value = more rating movement
    // Cap the multiplier to prevent extreme swings
    const multiplier = Math.min(1 + Math.log10(amount + 1), 3);
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
function calculateCompletionGain(selfRating, counterpartyRating, kFactor, amount = 0) {
    const expected = calculateExpected(selfRating, counterpartyRating);
    const effectiveK = getEffectiveK(kFactor, amount);
    // Gain = K * (1 - E)
    // You gain more when completing with higher-rated counterparty (lower E)
    const gain = effectiveK * (1 - expected);
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
function calculateDisputeLoss(selfRating, counterpartyRating, kFactor, amount = 0) {
    const expected = calculateExpected(selfRating, counterpartyRating);
    const effectiveK = getEffectiveK(kFactor, amount);
    // Loss = K * E
    // You lose more when you were expected to succeed (higher E)
    const loss = effectiveK * expected;
    // Minimum loss of 1 point
    return -Math.max(1, Math.round(loss));
}
// ============ ReputationStore Class ============
/**
 * Reputation Store - manages agent ratings
 */
class ReputationStore {
    constructor(ratingsPath = exports.DEFAULT_RATINGS_PATH, escrowsPath) {
        this.ratingsPath = ratingsPath;
        this.escrowsPath = escrowsPath || path_1.default.join(path_1.default.dirname(ratingsPath), 'escrows.json');
        this._ratings = null; // Lazy load
        this._escrows = new Map(); // proposalId -> escrow record
        this._escrowsLoaded = false;
        this._completionLog = new Map();
        this._pairCompletionCount = new Map();
    }
    /**
     * Load ratings from file
     */
    async load() {
        try {
            const content = await promises_1.default.readFile(this.ratingsPath, 'utf-8');
            this._ratings = JSON.parse(content);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                this._ratings = {}; // No ratings file yet
            }
            else {
                throw err;
            }
        }
        return this._ratings;
    }
    /**
     * Save ratings to file
     */
    async save() {
        await promises_1.default.mkdir(path_1.default.dirname(this.ratingsPath), { recursive: true });
        await promises_1.default.writeFile(this.ratingsPath, JSON.stringify(this._ratings, null, 2), { mode: 0o600 });
    }
    /**
     * Load escrows from file
     */
    async loadEscrows() {
        try {
            const content = await promises_1.default.readFile(this.escrowsPath, 'utf-8');
            const entries = JSON.parse(content);
            for (const [key, value] of Object.entries(entries)) {
                this._escrows.set(key, value);
            }
            this._escrowsLoaded = true;
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                this._escrowsLoaded = true; // No file yet, that's fine
            }
            else {
                throw err;
            }
        }
    }
    /**
     * Save escrows to file (write-ahead)
     */
    async saveEscrows() {
        const obj = {};
        for (const [key, value] of this._escrows) {
            obj[key] = value;
        }
        await promises_1.default.mkdir(path_1.default.dirname(this.escrowsPath), { recursive: true });
        await promises_1.default.writeFile(this.escrowsPath, JSON.stringify(obj, null, 2), { mode: 0o600 });
    }
    /**
     * Ensure ratings and escrows are loaded
     */
    async _ensureLoaded() {
        if (this._ratings === null) {
            await this.load();
        }
        if (!this._escrowsLoaded) {
            await this.loadEscrows();
        }
    }
    /**
     * Normalize agent ID (ensure @ prefix)
     */
    _normalizeId(agentId) {
        return agentId.startsWith('@') ? agentId : `@${agentId}`;
    }
    /**
     * Migrate an agent's rating record from an old ID to a new ID
     * Used when agent ID format changes (e.g., 8-char to 16-char)
     */
    migrateAgentId(oldId, newId) {
        if (!this._ratings)
            return;
        const normalizedOld = this._normalizeId(oldId);
        const normalizedNew = this._normalizeId(newId);
        if (normalizedOld === normalizedNew)
            return;
        const record = this._ratings[normalizedOld];
        if (record) {
            this._ratings[normalizedNew] = record;
            delete this._ratings[normalizedOld];
            this.save().catch(() => { }); // Best-effort persist
        }
        // Also migrate escrow references
        let escrowMigrated = false;
        for (const escrow of this._escrows.values()) {
            if (escrow.from.agent_id === normalizedOld) {
                escrow.from.agent_id = normalizedNew;
                escrowMigrated = true;
            }
            if (escrow.to.agent_id === normalizedOld) {
                escrow.to.agent_id = normalizedNew;
                escrowMigrated = true;
            }
        }
        if (escrowMigrated) {
            this.saveEscrows().catch(() => { }); // Best-effort persist
        }
    }
    /**
     * Get rating for an agent
     * Returns default rating if agent not found
     */
    async getRating(agentId) {
        await this._ensureLoaded();
        const id = this._normalizeId(agentId);
        const record = this._ratings[id];
        if (!record) {
            return {
                agentId: id,
                rating: exports.DEFAULT_RATING,
                transactions: 0,
                updated: null,
                isNew: true
            };
        }
        return {
            agentId: id,
            rating: record.rating,
            transactions: record.transactions,
            updated: record.updated,
            isNew: false
        };
    }
    /**
     * Get K-factor for an agent
     */
    async getAgentKFactor(agentId) {
        const record = await this.getRating(agentId);
        return getKFactor(record.transactions);
    }
    /**
     * Get rating for a specific skill/capability
     * Returns agent's global rating if skill not found
     */
    async getRatingForSkill(agentId, capability) {
        await this._ensureLoaded();
        const id = this._normalizeId(agentId);
        const record = this._ratings[id];
        if (!record || !record.skills || !record.skills[capability]) {
            // Return default skill rating
            return {
                rating: record ? record.rating : exports.DEFAULT_RATING,
                transactions: 0,
                updated: null
            };
        }
        return record.skills[capability];
    }
    /**
     * Get all skills for an agent with their ratings
     */
    async getSkillsForAgent(agentId) {
        await this._ensureLoaded();
        const id = this._normalizeId(agentId);
        const record = this._ratings[id];
        if (!record || !record.skills) {
            return {};
        }
        return { ...record.skills };
    }
    /**
     * Update skill-specific rating (internal use)
     */
    _updateSkillRating(record, capability, ratingChange) {
        if (!capability) {
            return; // Don't track unlabeled work
        }
        if (!record.skills) {
            record.skills = {};
        }
        if (!record.skills[capability]) {
            record.skills[capability] = {
                rating: exports.DEFAULT_RATING,
                transactions: 0,
                updated: null
            };
        }
        const skill = record.skills[capability];
        skill.rating = Math.max(exports.MINIMUM_RATING, skill.rating + ratingChange);
        skill.transactions += 1;
        skill.updated = new Date().toISOString();
    }
    /**
     * Get total escrowed ELO for an agent
     */
    getEscrowedAmount(agentId) {
        const id = this._normalizeId(agentId);
        let total = 0;
        for (const escrow of this._escrows.values()) {
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
    }
    /**
     * Get available rating for staking (rating - escrowed - minimum floor)
     */
    async getAvailableRating(agentId) {
        const record = await this.getRating(agentId);
        const escrowed = this.getEscrowedAmount(agentId);
        const available = record.rating - escrowed - exports.MINIMUM_RATING;
        return Math.max(0, available);
    }
    /**
     * Check if agent can stake the requested amount
     */
    async canStake(agentId, amount) {
        if (!amount || amount <= 0) {
            return { canStake: true, available: await this.getAvailableRating(agentId) };
        }
        const available = await this.getAvailableRating(agentId);
        if (amount > available) {
            return {
                canStake: false,
                available,
                reason: `Insufficient ELO. Available: ${available}, Requested: ${amount}`
            };
        }
        return { canStake: true, available };
    }
    /**
     * Create escrow for a proposal
     * Called when proposal is accepted with stakes
     */
    async createEscrow(proposalId, fromStake, toStake, expiresAt = null) {
        // Validate both parties can stake
        if (fromStake.stake > 0) {
            const canFrom = await this.canStake(fromStake.agent_id, fromStake.stake);
            if (!canFrom.canStake) {
                return { success: false, error: `Proposer: ${canFrom.reason}` };
            }
        }
        if (toStake.stake > 0) {
            const canTo = await this.canStake(toStake.agent_id, toStake.stake);
            if (!canTo.canStake) {
                return { success: false, error: `Acceptor: ${canTo.reason}` };
            }
        }
        const escrow = {
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
        await this.saveEscrows(); // Write-ahead: persist before confirming
        return { success: true, escrow };
    }
    /**
     * Get escrow for a proposal
     */
    getEscrow(proposalId) {
        return this._escrows.get(proposalId) || null;
    }
    /**
     * Release escrow (return stakes to both parties, no rating change)
     * Used for proposal expiration
     */
    async releaseEscrow(proposalId) {
        const escrow = this._escrows.get(proposalId);
        if (!escrow) {
            return { released: false, error: 'Escrow not found' };
        }
        if (escrow.status !== 'active') {
            return { released: false, error: `Escrow already ${escrow.status}` };
        }
        escrow.status = 'released';
        escrow.settled_at = Date.now();
        escrow.settlement_reason = 'expired';
        await this.saveEscrows(); // Persist release
        return { released: true, escrow };
    }
    /**
     * Update rating for an agent
     */
    async _updateAgent(agentId, ratingChange) {
        await this._ensureLoaded();
        const id = this._normalizeId(agentId);
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
        return this._ratings[id];
    }
    /**
     * Process a COMPLETE receipt - both parties gain (halved gains with staking)
     *
     * @param receipt - The COMPLETE receipt
     * @returns Rating changes for both parties
     */
    async processCompletion(receipt) {
        // Extract parties from receipt
        const party1 = receipt.proposal?.from || receipt.from;
        const party2 = receipt.proposal?.to || receipt.to;
        const amount = receipt.proposal?.amount || receipt.amount || 0;
        const proposalId = receipt.proposal_id;
        if (!party1 || !party2) {
            throw new Error('Receipt missing party information');
        }
        // Anti-sybil: cooldown between same-pair completions
        const pairKey = [this._normalizeId(party1), this._normalizeId(party2)].sort().join('|');
        const lastCompletion = this._completionLog.get(pairKey);
        if (lastCompletion && (Date.now() - lastCompletion) < exports.PAIR_COOLDOWN_MS) {
            const remainingSec = Math.ceil((exports.PAIR_COOLDOWN_MS - (Date.now() - lastCompletion)) / 1000);
            throw new Error(`Completion cooldown: same pair can complete at most once per hour (${remainingSec}s remaining)`);
        }
        // Get current ratings
        const rating1 = await this.getRating(party1);
        const rating2 = await this.getRating(party2);
        // Calculate gains (halved for staking model)
        const k1 = getKFactor(rating1.transactions);
        const k2 = getKFactor(rating2.transactions);
        const fullGain1 = calculateCompletionGain(rating1.rating, rating2.rating, k1, amount);
        const fullGain2 = calculateCompletionGain(rating2.rating, rating1.rating, k2, amount);
        // Anti-sybil: diminishing returns on repeated same-pair completions
        const pairCount = (this._pairCompletionCount.get(pairKey) || 0) + 1;
        this._pairCompletionCount.set(pairKey, pairCount);
        const diminishingFactor = 1 / pairCount;
        // Half the gains (staking model) and apply diminishing factor
        const gain1 = Math.max(1, Math.round(fullGain1 / 2 * diminishingFactor));
        const gain2 = Math.max(1, Math.round(fullGain2 / 2 * diminishingFactor));
        // Record completion timestamp for cooldown
        this._completionLog.set(pairKey, Date.now());
        // Settle escrow if exists (return stakes)
        let escrowSettlement = null;
        if (proposalId) {
            const escrow = this._escrows.get(proposalId);
            if (escrow && escrow.status === 'active') {
                escrow.status = 'settled';
                escrow.settled_at = Date.now();
                escrow.settlement_reason = 'completed';
                escrowSettlement = {
                    proposer_stake: escrow.from.stake,
                    acceptor_stake: escrow.to.stake,
                    settlement: 'returned'
                };
                await this.saveEscrows(); // Persist settlement
            }
        }
        // Apply updates
        const updated1 = await this._updateAgent(party1, gain1);
        const updated2 = await this._updateAgent(party2, gain2);
        // Apply skill-specific rating updates
        const capability = receipt.proposal?.capability || null;
        if (this._ratings[this._normalizeId(party1)]) {
            this._updateSkillRating(this._ratings[this._normalizeId(party1)], capability, gain1);
        }
        if (this._ratings[this._normalizeId(party2)]) {
            this._updateSkillRating(this._ratings[this._normalizeId(party2)], capability, gain2);
        }
        // Save
        await this.save();
        const result = {
            [party1]: {
                oldRating: rating1.rating,
                newRating: updated1.rating,
                change: gain1,
                transactions: updated1.transactions
            },
            [party2]: {
                oldRating: rating2.rating,
                newRating: updated2.rating,
                change: gain2,
                transactions: updated2.transactions
            }
        };
        if (escrowSettlement) {
            result._escrow = escrowSettlement;
        }
        return result;
    }
    /**
     * Process a DISPUTE receipt
     * If disputed_by is set, they are the "winner" (counterparty is at fault)
     * Otherwise, both parties lose (mutual fault)
     * Stakes are transferred to winner or burned on mutual fault
     *
     * @param receipt - The DISPUTE receipt
     * @returns Rating changes for both parties
     */
    async processDispute(receipt) {
        const party1 = receipt.proposal?.from || receipt.from;
        const party2 = receipt.proposal?.to || receipt.to;
        const disputedBy = receipt.disputed_by;
        const amount = receipt.proposal?.amount || receipt.amount || 0;
        const proposalId = receipt.proposal_id;
        if (!party1 || !party2) {
            throw new Error('Receipt missing party information');
        }
        const rating1 = await this.getRating(party1);
        const rating2 = await this.getRating(party2);
        const k1 = getKFactor(rating1.transactions);
        const k2 = getKFactor(rating2.transactions);
        // Get escrow info for stake calculations
        let escrow = null;
        let stake1 = 0, stake2 = 0;
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
        let change1, change2;
        let escrowSettlement = null;
        if (disputedBy) {
            // The disputer is the "winner", counterparty at fault
            const atFault = disputedBy === party1 ? party2 : party1;
            if (atFault === party1) {
                // Party1 at fault: loses ELO + loses stake to party2
                change1 = calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount) - stake1;
                change2 = Math.round(Math.abs(calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount)) * 0.5) + stake1;
                escrowSettlement = {
                    proposer_stake: escrow?.from.stake || 0,
                    acceptor_stake: escrow?.to.stake || 0,
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
                    proposer_stake: escrow?.from.stake || 0,
                    acceptor_stake: escrow?.to.stake || 0,
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
                proposer_stake: escrow?.from.stake || 0,
                acceptor_stake: escrow?.to.stake || 0,
                settlement: 'burned',
                burned_amount: stake1 + stake2
            };
        }
        // Settle escrow
        if (escrow && escrow.status === 'active') {
            escrow.status = 'settled';
            escrow.settled_at = Date.now();
            escrow.settlement_reason = 'disputed';
            await this.saveEscrows(); // Persist settlement
        }
        const updated1 = await this._updateAgent(party1, change1);
        const updated2 = await this._updateAgent(party2, change2);
        // Apply skill-specific rating updates
        const capability = receipt.proposal?.capability || null;
        if (this._ratings[this._normalizeId(party1)]) {
            this._updateSkillRating(this._ratings[this._normalizeId(party1)], capability, change1);
        }
        if (this._ratings[this._normalizeId(party2)]) {
            this._updateSkillRating(this._ratings[this._normalizeId(party2)], capability, change2);
        }
        await this.save();
        const result = {
            [party1]: {
                oldRating: rating1.rating,
                newRating: updated1.rating,
                change: change1,
                transactions: updated1.transactions
            },
            [party2]: {
                oldRating: rating2.rating,
                newRating: updated2.rating,
                change: change2,
                transactions: updated2.transactions
            }
        };
        if (escrowSettlement) {
            result._escrow = escrowSettlement;
        }
        return result;
    }
    /**
     * Apply pre-calculated rating changes from an agentcourt verdict settlement.
     * Takes the output of calculateDisputeSettlement() and persists the changes.
     */
    async applyVerdictSettlement(changes) {
        for (const [agentId, { change }] of Object.entries(changes)) {
            await this._updateAgent(agentId, change);
        }
        await this.save();
    }
    /**
     * Process a receipt (routes to completion or dispute)
     */
    async updateRatings(receipt) {
        const type = receipt.type || receipt.status;
        if (type === 'COMPLETE' || type === 'completed') {
            return this.processCompletion(receipt);
        }
        else if (type === 'DISPUTE' || type === 'disputed') {
            return this.processDispute(receipt);
        }
        // Not a rating-relevant receipt type
        return null;
    }
    /**
     * Export all ratings
     */
    async exportRatings() {
        await this._ensureLoaded();
        return { ...this._ratings };
    }
    /**
     * Get all ratings sorted by rating (descending)
     */
    async getLeaderboard(limit = 50) {
        await this._ensureLoaded();
        const entries = Object.entries(this._ratings)
            .map(([id, data]) => ({
            agentId: id,
            rating: data.rating,
            transactions: data.transactions,
            updated: data.updated
        }))
            .sort((a, b) => b.rating - a.rating)
            .slice(0, limit);
        return entries;
    }
    /**
     * Recalculate all ratings from receipt history
     *
     * @param receipts - Array of receipts to process
     */
    async recalculateFromReceipts(receipts) {
        // Reset ratings
        this._ratings = {};
        // Sort receipts by timestamp
        const sorted = [...receipts].sort((a, b) => {
            const tsA = a.completed_at || a.disputed_at || a.stored_at || 0;
            const tsB = b.completed_at || b.disputed_at || b.stored_at || 0;
            return tsA - tsB;
        });
        // Process each receipt
        for (const receipt of sorted) {
            try {
                await this.updateRatings(receipt);
            }
            catch (err) {
                // Skip invalid receipts
                console.error(`Skipping invalid receipt: ${err.message}`);
            }
        }
        // Save is called by updateRatings, but save final state
        await this.save();
        return this._ratings;
    }
    /**
     * Get statistics about the rating system
     */
    async getStats() {
        await this._ensureLoaded();
        const ratings = Object.values(this._ratings).map(r => r.rating);
        if (ratings.length === 0) {
            return {
                totalAgents: 0,
                averageRating: exports.DEFAULT_RATING,
                highestRating: exports.DEFAULT_RATING,
                lowestRating: exports.DEFAULT_RATING,
                totalTransactions: 0
            };
        }
        const totalTransactions = Object.values(this._ratings)
            .reduce((sum, r) => sum + r.transactions, 0);
        return {
            totalAgents: ratings.length,
            averageRating: Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length),
            highestRating: Math.max(...ratings),
            lowestRating: Math.min(...ratings),
            totalTransactions
        };
    }
}
exports.ReputationStore = ReputationStore;
// ============ Default Instance ============
// Default instance for convenience
let defaultStore = null;
function getDefaultStore() {
    if (!defaultStore) {
        defaultStore = new ReputationStore();
    }
    return defaultStore;
}
