/**
 * Tests for ELO-based reputation module
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  calculateExpected,
  getKFactor,
  getEffectiveK,
  calculateCompletionGain,
  calculateDisputeLoss,
  ReputationStore,
  DEFAULT_RATING,
  ELO_DIVISOR
} from '../lib/reputation.js';

// Test directory
const TEST_DIR = path.join(os.tmpdir(), 'agentchat-reputation-test');
const TEST_RATINGS_PATH = path.join(TEST_DIR, 'ratings.json');

describe('ELO Calculations', () => {
  it('calculateExpected returns 0.5 for equal ratings', () => {
    const expected = calculateExpected(1200, 1200);
    assert.strictEqual(expected, 0.5);
  });

  it('calculateExpected returns higher value for higher-rated self', () => {
    const expected = calculateExpected(1400, 1200);
    assert.ok(expected > 0.5);
    assert.ok(expected < 1);
  });

  it('calculateExpected returns lower value for lower-rated self', () => {
    const expected = calculateExpected(1000, 1200);
    assert.ok(expected < 0.5);
    assert.ok(expected > 0);
  });

  it('calculateExpected follows standard ELO formula', () => {
    // 200 point difference should give ~0.76 expected for higher rated
    const expected = calculateExpected(1400, 1200);
    const formula = 1 / (1 + Math.pow(10, (1200 - 1400) / 400));
    assert.strictEqual(expected, formula);
  });

  it('getKFactor returns 32 for new agents', () => {
    assert.strictEqual(getKFactor(0), 32);
    assert.strictEqual(getKFactor(29), 32);
  });

  it('getKFactor returns 24 for intermediate agents', () => {
    assert.strictEqual(getKFactor(30), 24);
    assert.strictEqual(getKFactor(99), 24);
  });

  it('getKFactor returns 16 for established agents', () => {
    assert.strictEqual(getKFactor(100), 16);
    assert.strictEqual(getKFactor(1000), 16);
  });

  it('getEffectiveK returns base K when no amount', () => {
    assert.strictEqual(getEffectiveK(32, 0), 32);
    assert.strictEqual(getEffectiveK(32, null), 32);
  });

  it('getEffectiveK increases K for higher amounts', () => {
    const baseK = 32;
    const withAmount = getEffectiveK(baseK, 100);
    assert.ok(withAmount > baseK);
  });

  it('getEffectiveK caps multiplier at 3x', () => {
    const baseK = 32;
    const massive = getEffectiveK(baseK, 1000000);
    assert.ok(massive <= baseK * 3);
  });

  it('calculateCompletionGain gives more for higher-rated counterparty', () => {
    const gainFromHigher = calculateCompletionGain(1200, 1400, 32);
    const gainFromLower = calculateCompletionGain(1200, 1000, 32);
    assert.ok(gainFromHigher > gainFromLower);
  });

  it('calculateCompletionGain minimum is 1', () => {
    const gain = calculateCompletionGain(2000, 800, 16);
    assert.ok(gain >= 1);
  });

  it('calculateDisputeLoss returns negative value', () => {
    const loss = calculateDisputeLoss(1200, 1200, 32);
    assert.ok(loss < 0);
  });

  it('calculateDisputeLoss is larger when expected to succeed', () => {
    const lossWhenFavored = calculateDisputeLoss(1400, 1200, 32);
    const lossWhenUnderdog = calculateDisputeLoss(1000, 1200, 32);
    // Favored player loses more (more negative)
    assert.ok(lossWhenFavored < lossWhenUnderdog);
  });
});

describe('ReputationStore', () => {
  let store;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    try {
      await fs.unlink(TEST_RATINGS_PATH);
    } catch {
      // File doesn't exist
    }
    store = new ReputationStore(TEST_RATINGS_PATH);
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('getRating returns default for new agent', async () => {
    const rating = await store.getRating('@newagent');
    assert.strictEqual(rating.rating, DEFAULT_RATING);
    assert.strictEqual(rating.transactions, 0);
    assert.strictEqual(rating.isNew, true);
  });

  it('getRating normalizes agent ID', async () => {
    const withAt = await store.getRating('@agent1');
    const withoutAt = await store.getRating('agent1');
    assert.strictEqual(withAt.agentId, withoutAt.agentId);
  });

  it('processCompletion increases both ratings', async () => {
    const receipt = {
      type: 'COMPLETE',
      proposal: {
        from: '@agent1',
        to: '@agent2',
        amount: 10
      }
    };

    const changes = await store.processCompletion(receipt);

    assert.ok(changes['@agent1'].change > 0);
    assert.ok(changes['@agent2'].change > 0);
    assert.strictEqual(changes['@agent1'].newRating, DEFAULT_RATING + changes['@agent1'].change);
    assert.strictEqual(changes['@agent2'].newRating, DEFAULT_RATING + changes['@agent2'].change);
  });

  it('processCompletion increments transaction count', async () => {
    const receipt = {
      type: 'COMPLETE',
      proposal: { from: '@agent1', to: '@agent2' }
    };

    await store.processCompletion(receipt);

    const rating1 = await store.getRating('@agent1');
    const rating2 = await store.getRating('@agent2');

    assert.strictEqual(rating1.transactions, 1);
    assert.strictEqual(rating2.transactions, 1);
  });

  it('processDispute with disputed_by penalizes counterparty', async () => {
    const receipt = {
      type: 'DISPUTE',
      proposal: { from: '@agent1', to: '@agent2' },
      disputed_by: '@agent1' // agent1 disputed, so agent2 is at fault
    };

    const changes = await store.processDispute(receipt);

    // Agent2 (at fault) should lose rating
    assert.ok(changes['@agent2'].change < 0);
    // Agent1 (winner) should gain some
    assert.ok(changes['@agent1'].change > 0);
  });

  it('processDispute without disputed_by penalizes both', async () => {
    const receipt = {
      type: 'DISPUTE',
      proposal: { from: '@agent1', to: '@agent2' }
      // No disputed_by = mutual fault
    };

    const changes = await store.processDispute(receipt);

    assert.ok(changes['@agent1'].change < 0);
    assert.ok(changes['@agent2'].change < 0);
  });

  it('updateRatings routes to correct handler', async () => {
    const completeReceipt = {
      type: 'COMPLETE',
      proposal: { from: '@agent1', to: '@agent2' }
    };

    const disputeReceipt = {
      type: 'DISPUTE',
      proposal: { from: '@agent3', to: '@agent4' }
    };

    const completeChanges = await store.updateRatings(completeReceipt);
    const disputeChanges = await store.updateRatings(disputeReceipt);

    assert.ok(completeChanges['@agent1'].change > 0); // Completion = gain
    assert.ok(disputeChanges['@agent3'].change < 0);  // Dispute = loss
  });

  it('getLeaderboard returns sorted results', async () => {
    // Create some ratings
    await store.processCompletion({
      type: 'COMPLETE',
      proposal: { from: '@agent1', to: '@agent2', amount: 100 }
    });
    await store.processCompletion({
      type: 'COMPLETE',
      proposal: { from: '@agent1', to: '@agent3', amount: 100 }
    });

    const leaderboard = await store.getLeaderboard(10);

    assert.ok(leaderboard.length > 0);
    // Should be sorted descending
    for (let i = 1; i < leaderboard.length; i++) {
      assert.ok(leaderboard[i - 1].rating >= leaderboard[i].rating);
    }
  });

  it('recalculateFromReceipts rebuilds ratings', async () => {
    const receipts = [
      { type: 'COMPLETE', proposal: { from: '@a', to: '@b' }, completed_at: 1000 },
      { type: 'COMPLETE', proposal: { from: '@b', to: '@c' }, completed_at: 2000 },
      { type: 'COMPLETE', proposal: { from: '@a', to: '@c' }, completed_at: 3000 }
    ];

    await store.recalculateFromReceipts(receipts);

    const ratingA = await store.getRating('@a');
    const ratingB = await store.getRating('@b');
    const ratingC = await store.getRating('@c');

    assert.strictEqual(ratingA.transactions, 2);
    assert.strictEqual(ratingB.transactions, 2);
    assert.strictEqual(ratingC.transactions, 2);
  });

  it('getStats returns correct statistics', async () => {
    await store.processCompletion({
      type: 'COMPLETE',
      proposal: { from: '@agent1', to: '@agent2' }
    });

    const stats = await store.getStats();

    assert.strictEqual(stats.totalAgents, 2);
    assert.strictEqual(stats.totalTransactions, 2); // Each agent gets 1 transaction
    assert.ok(stats.averageRating >= DEFAULT_RATING); // Both gained
  });

  it('rating floor is 100', async () => {
    // Give an agent a very low rating by losing many disputes
    for (let i = 0; i < 50; i++) {
      await store.processDispute({
        type: 'DISPUTE',
        proposal: { from: '@loser', to: `@winner${i}` },
        disputed_by: `@winner${i}`
      });
    }

    const rating = await store.getRating('@loser');
    assert.ok(rating.rating >= 100);
  });
});

describe('K-factor transitions', () => {
  let store;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    try {
      await fs.unlink(TEST_RATINGS_PATH);
    } catch {
      // File doesn't exist
    }
    store = new ReputationStore(TEST_RATINGS_PATH);
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('agent K-factor decreases as transactions increase', async () => {
    const k1 = await store.getAgentKFactor('@newagent');
    assert.strictEqual(k1, 32);

    // Simulate 30+ transactions
    for (let i = 0; i < 35; i++) {
      await store.processCompletion({
        type: 'COMPLETE',
        proposal: { from: '@newagent', to: `@other${i}` }
      });
    }

    const k2 = await store.getAgentKFactor('@newagent');
    assert.strictEqual(k2, 24);
  });
});
