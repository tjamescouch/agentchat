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

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// Default ratings file location
const AGENTCHAT_DIR = path.join(os.homedir(), '.agentchat');
export const DEFAULT_RATINGS_PATH = path.join(AGENTCHAT_DIR, 'ratings.json');

// ELO constants
export const DEFAULT_RATING = 1200;
export const ELO_DIVISOR = 400; // Standard ELO divisor

// K-factor thresholds
const K_FACTOR_NEW = 32;        // < 30 transactions
const K_FACTOR_INTERMEDIATE = 24; // < 100 transactions
const K_FACTOR_ESTABLISHED = 16;  // >= 100 transactions

const TRANSACTIONS_NEW = 30;
const TRANSACTIONS_INTERMEDIATE = 100;

/**
 * Calculate expected outcome (standard ELO formula)
 * E = 1 / (1 + 10^((R_opponent - R_self) / 400))
 *
 * @param {number} selfRating - Your rating
 * @param {number} opponentRating - Counterparty rating
 * @returns {number} Expected outcome (0-1)
 */
export function calculateExpected(selfRating, opponentRating) {
  const exponent = (opponentRating - selfRating) / ELO_DIVISOR;
  return 1 / (1 + Math.pow(10, exponent));
}

/**
 * Get K-factor based on transaction count
 * New agents have higher K (volatile), established agents lower K (stable)
 *
 * @param {number} transactions - Number of completed transactions
 * @returns {number} K-factor
 */
export function getKFactor(transactions) {
  if (transactions < TRANSACTIONS_NEW) {
    return K_FACTOR_NEW;
  } else if (transactions < TRANSACTIONS_INTERMEDIATE) {
    return K_FACTOR_INTERMEDIATE;
  }
  return K_FACTOR_ESTABLISHED;
}

/**
 * Calculate effective K-factor with optional task value weighting
 * effective_K = K * (1 + log10(amount + 1))
 *
 * @param {number} baseK - Base K-factor
 * @param {number} amount - Task value/amount (optional)
 * @returns {number} Effective K-factor
 */
export function getEffectiveK(baseK, amount = 0) {
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
 * @param {number} selfRating - Your current rating
 * @param {number} counterpartyRating - Counterparty's rating
 * @param {number} kFactor - Your K-factor
 * @param {number} amount - Optional task value
 * @returns {number} Rating change (positive)
 */
export function calculateCompletionGain(selfRating, counterpartyRating, kFactor, amount = 0) {
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
 * @param {number} selfRating - Your current rating
 * @param {number} counterpartyRating - Counterparty's rating
 * @param {number} kFactor - Your K-factor
 * @param {number} amount - Optional task value
 * @returns {number} Rating change (negative)
 */
export function calculateDisputeLoss(selfRating, counterpartyRating, kFactor, amount = 0) {
  const expected = calculateExpected(selfRating, counterpartyRating);
  const effectiveK = getEffectiveK(kFactor, amount);

  // Loss = K * E
  // You lose more when you were expected to succeed (higher E)
  const loss = effectiveK * expected;

  // Minimum loss of 1 point
  return -Math.max(1, Math.round(loss));
}

/**
 * Reputation Store - manages agent ratings
 */
export class ReputationStore {
  constructor(ratingsPath = DEFAULT_RATINGS_PATH) {
    this.ratingsPath = ratingsPath;
    this._ratings = null; // Lazy load
  }

  /**
   * Load ratings from file
   */
  async load() {
    try {
      const content = await fsp.readFile(this.ratingsPath, 'utf-8');
      this._ratings = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._ratings = {}; // No ratings file yet
      } else {
        throw err;
      }
    }
    return this._ratings;
  }

  /**
   * Save ratings to file
   */
  async save() {
    await fsp.mkdir(path.dirname(this.ratingsPath), { recursive: true });
    await fsp.writeFile(
      this.ratingsPath,
      JSON.stringify(this._ratings, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Ensure ratings are loaded
   */
  async _ensureLoaded() {
    if (this._ratings === null) {
      await this.load();
    }
  }

  /**
   * Normalize agent ID (ensure @ prefix)
   */
  _normalizeId(agentId) {
    return agentId.startsWith('@') ? agentId : `@${agentId}`;
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
        rating: DEFAULT_RATING,
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
   * Update rating for an agent
   */
  async _updateAgent(agentId, ratingChange) {
    await this._ensureLoaded();
    const id = this._normalizeId(agentId);

    if (!this._ratings[id]) {
      this._ratings[id] = {
        rating: DEFAULT_RATING,
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
   * Process a COMPLETE receipt - both parties gain
   *
   * @param {object} receipt - The COMPLETE receipt
   * @returns {object} Rating changes for both parties
   */
  async processCompletion(receipt) {
    // Extract parties from receipt
    const party1 = receipt.proposal?.from || receipt.from;
    const party2 = receipt.proposal?.to || receipt.to;
    const amount = receipt.proposal?.amount || receipt.amount || 0;

    if (!party1 || !party2) {
      throw new Error('Receipt missing party information');
    }

    // Get current ratings
    const rating1 = await this.getRating(party1);
    const rating2 = await this.getRating(party2);

    // Calculate gains
    const k1 = getKFactor(rating1.transactions);
    const k2 = getKFactor(rating2.transactions);

    const gain1 = calculateCompletionGain(rating1.rating, rating2.rating, k1, amount);
    const gain2 = calculateCompletionGain(rating2.rating, rating1.rating, k2, amount);

    // Apply updates
    const updated1 = await this._updateAgent(party1, gain1);
    const updated2 = await this._updateAgent(party2, gain2);

    // Save
    await this.save();

    return {
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
  }

  /**
   * Process a DISPUTE receipt
   * If disputed_by is set, they are the "winner" (counterparty is at fault)
   * Otherwise, both parties lose (mutual fault)
   *
   * @param {object} receipt - The DISPUTE receipt
   * @returns {object} Rating changes for both parties
   */
  async processDispute(receipt) {
    const party1 = receipt.proposal?.from || receipt.from;
    const party2 = receipt.proposal?.to || receipt.to;
    const disputedBy = receipt.disputed_by;
    const amount = receipt.proposal?.amount || receipt.amount || 0;

    if (!party1 || !party2) {
      throw new Error('Receipt missing party information');
    }

    const rating1 = await this.getRating(party1);
    const rating2 = await this.getRating(party2);

    const k1 = getKFactor(rating1.transactions);
    const k2 = getKFactor(rating2.transactions);

    let change1, change2;

    if (disputedBy) {
      // The disputer is the "winner", counterparty at fault
      const atFault = disputedBy === party1 ? party2 : party1;
      const winner = disputedBy === party1 ? party1 : party2;

      if (atFault === party1) {
        change1 = calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount);
        change2 = Math.round(Math.abs(change1) * 0.5); // Winner gains half of loser's loss
      } else {
        change2 = calculateDisputeLoss(rating2.rating, rating1.rating, k2, amount);
        change1 = Math.round(Math.abs(change2) * 0.5);
      }
    } else {
      // Mutual fault - both lose
      change1 = calculateDisputeLoss(rating1.rating, rating2.rating, k1, amount);
      change2 = calculateDisputeLoss(rating2.rating, rating1.rating, k2, amount);
    }

    const updated1 = await this._updateAgent(party1, change1);
    const updated2 = await this._updateAgent(party2, change2);

    await this.save();

    return {
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
  }

  /**
   * Process a receipt (routes to completion or dispute)
   */
  async updateRatings(receipt) {
    const type = receipt.type || receipt.status;

    if (type === 'COMPLETE' || type === 'completed') {
      return this.processCompletion(receipt);
    } else if (type === 'DISPUTE' || type === 'disputed') {
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
   * @param {Array} receipts - Array of receipts to process
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
      } catch (err) {
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
        averageRating: DEFAULT_RATING,
        highestRating: DEFAULT_RATING,
        lowestRating: DEFAULT_RATING,
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

// Default instance for convenience
let defaultStore = null;

export function getDefaultStore() {
  if (!defaultStore) {
    defaultStore = new ReputationStore();
  }
  return defaultStore;
}
