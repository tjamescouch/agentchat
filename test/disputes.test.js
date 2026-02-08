/**
 * Agentcourt Dispute Resolution Tests
 * Tests the DisputeStore and dispute lifecycle
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { DisputeStore, DISPUTE_CONSTANTS, calculateDisputeSettlement } from '../dist/lib/disputes.js';

describe('DisputeStore', () => {
  test('fileIntent creates a dispute in reveal_pending phase', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'work not done', commitment);

    assert.ok(dispute.id.startsWith('disp_'));
    assert.equal(dispute.proposal_id, 'prop_1');
    assert.equal(dispute.disputant, '@agent1');
    assert.equal(dispute.respondent, '@agent2');
    assert.equal(dispute.phase, 'reveal_pending');
    assert.equal(dispute.commitment, commitment);
    assert.ok(dispute.server_nonce);
    assert.equal(dispute.filing_fee_escrowed, true);
    store.close();
  });

  test('reveal validates commitment and transitions to panel_selection', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    const revealed = store.reveal(dispute.id, nonce);

    assert.ok(revealed);
    assert.equal(revealed.phase, 'panel_selection');
    assert.equal(revealed.nonce, nonce);
    assert.ok(revealed.seed);
    store.close();
  });

  test('reveal rejects wrong nonce', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    const revealed = store.reveal(dispute.id, 'wrong_nonce');

    assert.equal(revealed, null);
    assert.equal(store.get(dispute.id).phase, 'reveal_pending');
    store.close();
  });

  test('selectPanel picks 3 arbiters from pool', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store.reveal(dispute.id, nonce);

    const pool = ['@arb1', '@arb2', '@arb3', '@arb4', '@arb5'];
    const selected = store.selectPanel(dispute.id, pool);

    assert.ok(selected);
    assert.equal(selected.length, 3);
    assert.equal(store.get(dispute.id).phase, 'arbiter_response');
    assert.equal(store.get(dispute.id).arbiters.length, 3);
    store.close();
  });

  test('selectPanel falls back when pool too small', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store.reveal(dispute.id, nonce);

    const selected = store.selectPanel(dispute.id, ['@arb1', '@arb2']);
    assert.equal(selected, null);
    assert.equal(store.get(dispute.id).phase, 'fallback');
    store.close();
  });

  test('selectPanel is deterministic with same seed', () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');
    const pool = ['@arb1', '@arb2', '@arb3', '@arb4', '@arb5'];

    // Run twice with same inputs
    const store1 = new DisputeStore();
    const d1 = store1.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store1.reveal(d1.id, nonce);
    // Patch server_nonce to be the same
    const serverNonce = store1.get(d1.id).server_nonce;

    const store2 = new DisputeStore();
    const d2 = store2.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    // Manually set same server nonce for determinism test
    const d2obj = store2.get(d2.id);
    d2obj.server_nonce = serverNonce;
    store2.reveal(d2.id, nonce);

    const s1 = store1.selectPanel(d1.id, pool);
    const s2 = store2.selectPanel(d2.id, pool);

    assert.deepEqual(s1, s2);
    store1.close();
    store2.close();
  });

  test('arbiterAccept transitions to evidence when all accept', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    const pool = ['@arb1', '@arb2', '@arb3', '@arb4', '@arb5'];
    const selected = store.selectPanel(dispute.id, pool);

    for (const arb of selected) {
      store.arbiterAccept(dispute.id, arb);
    }

    const d = store.get(dispute.id);
    assert.equal(d.phase, 'evidence');
    assert.ok(d.evidence_deadline);
    store.close();
  });

  test('arbiterDecline triggers replacement', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    const pool = ['@arb1', '@arb2', '@arb3', '@arb4', '@arb5'];
    const selected = store.selectPanel(dispute.id, pool);

    // First arbiter declines
    const replacement = store.arbiterDecline(dispute.id, selected[0], pool);
    assert.ok(replacement);
    assert.ok(!selected.includes(replacement));

    const d = store.get(dispute.id);
    assert.equal(d.phase, 'arbiter_response'); // still waiting
    assert.equal(d.arbiters.length, 4); // 3 original + 1 replacement
    store.close();
  });

  test('submitEvidence stores evidence for disputant and respondent', () => {
    const store = _createEvidencePhaseDispute();

    const items = [
      { kind: 'commit', label: 'My commit', value: 'abc123' },
    ];

    assert.ok(store.dispute.submitEvidence(store.disputeId, '@agent1', items, 'I did the work', 'sig1'));
    assert.ok(store.dispute.submitEvidence(store.disputeId, '@agent2', items, 'No they did not', 'sig2'));

    const d = store.dispute.get(store.disputeId);
    assert.ok(d.disputant_evidence);
    assert.ok(d.respondent_evidence);
    assert.equal(d.disputant_evidence.items[0].hash !== undefined, true);
    store.dispute.close();
  });

  test('submitEvidence rejects non-parties', () => {
    const store = _createEvidencePhaseDispute();

    const result = store.dispute.submitEvidence(store.disputeId, '@random', [], 'lol', 'sig');
    assert.equal(result, false);
    store.dispute.close();
  });

  test('submitEvidence rejects too many items', () => {
    const store = _createEvidencePhaseDispute();

    const items = Array.from({ length: 11 }, (_, i) => ({
      kind: 'other',
      label: `item ${i}`,
      value: `val ${i}`,
    }));

    const result = store.dispute.submitEvidence(store.disputeId, '@agent1', items, 'too many', 'sig');
    assert.equal(result, false);
    store.dispute.close();
  });

  test('castVote records vote and resolves on majority', () => {
    const store = _createDeliberationPhaseDispute();

    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'disputant', 'clear evidence', 'sig1');
    store.dispute.castVote(store.disputeId, activeArbiters[1].agent_id, 'disputant', 'agreed', 'sig2');

    // After 2 of 3 vote the same, should NOT yet be resolved (need all to vote)
    // Actually per spec, we wait for all votes then compute majority
    store.dispute.castVote(store.disputeId, activeArbiters[2].agent_id, 'respondent', 'disagree', 'sig3');

    const resolved = store.dispute.get(store.disputeId);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'disputant'); // 2 vs 1
    store.dispute.close();
  });

  test('castVote resolves mutual when all different', () => {
    const store = _createDeliberationPhaseDispute();

    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'disputant', 'a', 'sig1');
    store.dispute.castVote(store.disputeId, activeArbiters[1].agent_id, 'respondent', 'b', 'sig2');
    store.dispute.castVote(store.disputeId, activeArbiters[2].agent_id, 'mutual', 'c', 'sig3');

    const resolved = store.dispute.get(store.disputeId);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'mutual');
    store.dispute.close();
  });

  test('forceResolve marks non-voters as forfeited', () => {
    const store = _createDeliberationPhaseDispute();

    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    // Only one votes
    store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'disputant', 'voted', 'sig1');
    store.dispute.forceResolve(store.disputeId);

    const resolved = store.dispute.get(store.disputeId);
    assert.equal(resolved.phase, 'resolved');
    // Only 1 vote, can't form majority → mutual
    assert.equal(resolved.verdict, 'mutual');

    const forfeited = resolved.arbiters.filter(a => a.status === 'forfeited');
    assert.equal(forfeited.length, 2);
    store.dispute.close();
  });

  test('getByProposal returns dispute for proposal', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const dispute = store.fileIntent('prop_abc', '@agent1', '@agent2', 'reason', commitment);
    const found = store.getByProposal('prop_abc');

    assert.ok(found);
    assert.equal(found.id, dispute.id);
    store.close();
  });

  test('listByAgent returns disputes for an agent', () => {
    const store = new DisputeStore();
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
    store.fileIntent('prop_2', '@agent1', '@agent3', 'reason2', commitment);

    const list = store.listByAgent('@agent1');
    assert.equal(list.length, 2);
    store.close();
  });

  test('submitEvidence rejects duplicate from same party', () => {
    const store = _createEvidencePhaseDispute();

    const items = [{ kind: 'commit', label: 'First', value: 'abc' }];
    assert.ok(store.dispute.submitEvidence(store.disputeId, '@agent1', items, 'first', 'sig1'));
    assert.equal(store.dispute.submitEvidence(store.disputeId, '@agent1', items, 'duplicate', 'sig2'), false);
    store.dispute.close();
  });

  test('castVote rejects vote from non-panel agent', () => {
    const store = _createDeliberationPhaseDispute();

    const result = store.dispute.castVote(store.disputeId, '@random', 'disputant', 'reason', 'sig');
    assert.equal(result, false);
    store.dispute.close();
  });

  test('castVote rejects duplicate vote', () => {
    const store = _createDeliberationPhaseDispute();
    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    assert.ok(store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'disputant', 'reason', 'sig'));
    assert.equal(store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'respondent', 'changed mind', 'sig2'), false);
    store.dispute.close();
  });

  test('castVote resolves respondent verdict on 2/3 majority', () => {
    const store = _createDeliberationPhaseDispute();
    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'respondent', 'a', 'sig1');
    store.dispute.castVote(store.disputeId, activeArbiters[1].agent_id, 'respondent', 'b', 'sig2');
    store.dispute.castVote(store.disputeId, activeArbiters[2].agent_id, 'disputant', 'c', 'sig3');

    const resolved = store.dispute.get(store.disputeId);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'respondent');
    store.dispute.close();
  });
});

describe('calculateDisputeSettlement', () => {
  test('disputant wins: respondent loses, disputant gains half', () => {
    const store = _createResolvedDispute('disputant');
    const ratings = {
      '@agent1': { rating: 1200, transactions: 20 },
      '@agent2': { rating: 1200, transactions: 20 },
    };
    // Add arbiter ratings
    const d = store.dispute.get(store.disputeId);
    for (const slot of d.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(d, ratings);

    assert.ok(changes['@agent1'].change > 0); // disputant gains
    assert.ok(changes['@agent2'].change < 0); // respondent loses
    assert.ok(changes['@agent1'].change <= Math.abs(changes['@agent2'].change)); // gain <= loss (halved)
    store.dispute.close();
  });

  test('respondent wins: disputant loses, respondent gains half', () => {
    const store = _createResolvedDispute('respondent');
    const ratings = {
      '@agent1': { rating: 1200, transactions: 20 },
      '@agent2': { rating: 1200, transactions: 20 },
    };
    const d = store.dispute.get(store.disputeId);
    for (const slot of d.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(d, ratings);

    assert.ok(changes['@agent1'].change < 0); // disputant loses
    assert.ok(changes['@agent2'].change > 0); // respondent gains
    store.dispute.close();
  });

  test('mutual fault: both parties lose', () => {
    const store = _createResolvedDispute('mutual');
    const ratings = {
      '@agent1': { rating: 1200, transactions: 20 },
      '@agent2': { rating: 1200, transactions: 20 },
    };
    const d = store.dispute.get(store.disputeId);
    for (const slot of d.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(d, ratings);

    assert.ok(changes['@agent1'].change < 0); // disputant loses
    assert.ok(changes['@agent2'].change < 0); // respondent loses
    store.dispute.close();
  });

  test('majority arbiters gain reward, dissenters get zero', () => {
    const store = _createResolvedDispute('disputant');
    const d = store.dispute.get(store.disputeId);
    const ratings = {
      '@agent1': { rating: 1200, transactions: 20 },
      '@agent2': { rating: 1200, transactions: 20 },
    };
    for (const slot of d.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(d, ratings);

    // Find who voted what
    const voters = d.arbiters.filter(a => a.status === 'voted');
    for (const v of voters) {
      if (v.vote.verdict === 'disputant') {
        assert.equal(changes[v.agent_id].change, DISPUTE_CONSTANTS.ARBITER_REWARD);
      } else {
        assert.equal(changes[v.agent_id].change, 0);
      }
    }
    store.dispute.close();
  });

  test('forfeited arbiters lose stake', () => {
    const store = _createDeliberationPhaseDispute();
    const d = store.dispute.get(store.disputeId);
    const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

    // Only one votes
    store.dispute.castVote(store.disputeId, activeArbiters[0].agent_id, 'disputant', 'voted', 'sig1');
    store.dispute.forceResolve(store.disputeId);

    const resolved = store.dispute.get(store.disputeId);
    const ratings = {
      '@agent1': { rating: 1200, transactions: 20 },
      '@agent2': { rating: 1200, transactions: 20 },
    };
    for (const slot of resolved.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(resolved, ratings);

    const forfeited = resolved.arbiters.filter(a => a.status === 'forfeited');
    for (const f of forfeited) {
      assert.equal(changes[f.agent_id].change, -DISPUTE_CONSTANTS.ARBITER_STAKE);
    }
    store.dispute.close();
  });

  test('preserves oldRating and newRating', () => {
    const store = _createResolvedDispute('disputant');
    const d = store.dispute.get(store.disputeId);
    const ratings = {
      '@agent1': { rating: 1400, transactions: 20 },
      '@agent2': { rating: 1100, transactions: 20 },
    };
    for (const slot of d.arbiters) {
      ratings[slot.agent_id] = { rating: 1300, transactions: 15 };
    }

    const changes = calculateDisputeSettlement(d, ratings);

    assert.equal(changes['@agent1'].oldRating, 1400);
    assert.equal(changes['@agent1'].newRating, 1400 + changes['@agent1'].change);
    assert.equal(changes['@agent2'].oldRating, 1100);
    assert.equal(changes['@agent2'].newRating, 1100 + changes['@agent2'].change);
    store.dispute.close();
  });

  test('accounts for rating differential in ELO calculation', () => {
    const store1 = _createResolvedDispute('disputant');
    const d1 = store1.dispute.get(store1.disputeId);

    // Equal ratings
    const ratings1 = { '@agent1': { rating: 1200, transactions: 20 }, '@agent2': { rating: 1200, transactions: 20 } };
    for (const slot of d1.arbiters) ratings1[slot.agent_id] = { rating: 1300, transactions: 15 };
    const changes1 = calculateDisputeSettlement(d1, ratings1);

    const store2 = _createResolvedDispute('disputant');
    const d2 = store2.dispute.get(store2.disputeId);

    // Unequal ratings (underdog wins)
    const ratings2 = { '@agent1': { rating: 1000, transactions: 20 }, '@agent2': { rating: 1400, transactions: 20 } };
    for (const slot of d2.arbiters) ratings2[slot.agent_id] = { rating: 1300, transactions: 15 };
    const changes2 = calculateDisputeSettlement(d2, ratings2);

    // When an underdog (lower rating) wins, the loser should lose more
    // because the expected outcome was for the higher-rated to win
    assert.ok(Math.abs(changes2['@agent2'].change) >= Math.abs(changes1['@agent2'].change));
    store1.dispute.close();
    store2.dispute.close();
  });
});

describe('DisputeStore.withLock', () => {
  test('serializes concurrent async operations on the same dispute', async () => {
    const store = new DisputeStore();
    const order = [];

    // Launch two concurrent locked operations on the same dispute ID
    const op1 = store.withLock('disp_1', async () => {
      order.push('op1_start');
      await new Promise(r => setTimeout(r, 50));
      order.push('op1_end');
      return 'result1';
    });

    const op2 = store.withLock('disp_1', async () => {
      order.push('op2_start');
      await new Promise(r => setTimeout(r, 10));
      order.push('op2_end');
      return 'result2';
    });

    const [r1, r2] = await Promise.all([op1, op2]);

    // op1 should fully complete before op2 starts
    assert.deepEqual(order, ['op1_start', 'op1_end', 'op2_start', 'op2_end']);
    assert.equal(r1, 'result1');
    assert.equal(r2, 'result2');
    store.close();
  });

  test('allows concurrent operations on different disputes', async () => {
    const store = new DisputeStore();
    const order = [];

    const op1 = store.withLock('disp_1', async () => {
      order.push('disp1_start');
      await new Promise(r => setTimeout(r, 50));
      order.push('disp1_end');
    });

    const op2 = store.withLock('disp_2', async () => {
      order.push('disp2_start');
      await new Promise(r => setTimeout(r, 10));
      order.push('disp2_end');
    });

    await Promise.all([op1, op2]);

    // Both should start before either finishes (parallel execution)
    assert.equal(order[0], 'disp1_start');
    assert.equal(order[1], 'disp2_start');
    // disp2 finishes first (shorter delay)
    assert.equal(order[2], 'disp2_end');
    assert.equal(order[3], 'disp1_end');
    store.close();
  });

  test('releases lock even if operation throws', async () => {
    const store = new DisputeStore();

    // First operation throws
    await assert.rejects(
      store.withLock('disp_1', async () => { throw new Error('boom'); }),
      { message: 'boom' },
    );

    // Second operation should still be able to acquire the lock
    const result = await store.withLock('disp_1', async () => 'ok');
    assert.equal(result, 'ok');
    store.close();
  });
});

// ============ Helpers ============

function _createEvidencePhaseDispute() {
  const store = new DisputeStore();
  const nonce = crypto.randomBytes(16).toString('hex');
  const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

  const dispute = store.fileIntent('prop_1', '@agent1', '@agent2', 'reason', commitment);
  store.reveal(dispute.id, nonce);
  const pool = ['@arb1', '@arb2', '@arb3', '@arb4', '@arb5'];
  const selected = store.selectPanel(dispute.id, pool);

  for (const arb of selected) {
    store.arbiterAccept(dispute.id, arb);
  }

  return { dispute: store, disputeId: dispute.id, arbiters: selected };
}

function _createDeliberationPhaseDispute() {
  const result = _createEvidencePhaseDispute();
  result.dispute.closeEvidence(result.disputeId);
  return result;
}

function _createResolvedDispute(verdict) {
  const result = _createDeliberationPhaseDispute();
  const d = result.dispute.get(result.disputeId);
  const activeArbiters = d.arbiters.filter(a => a.status === 'accepted');

  if (verdict === 'disputant') {
    result.dispute.castVote(result.disputeId, activeArbiters[0].agent_id, 'disputant', 'agreed', 'sig1');
    result.dispute.castVote(result.disputeId, activeArbiters[1].agent_id, 'disputant', 'agreed', 'sig2');
    result.dispute.castVote(result.disputeId, activeArbiters[2].agent_id, 'respondent', 'disagree', 'sig3');
  } else if (verdict === 'respondent') {
    result.dispute.castVote(result.disputeId, activeArbiters[0].agent_id, 'respondent', 'agreed', 'sig1');
    result.dispute.castVote(result.disputeId, activeArbiters[1].agent_id, 'respondent', 'agreed', 'sig2');
    result.dispute.castVote(result.disputeId, activeArbiters[2].agent_id, 'disputant', 'disagree', 'sig3');
  } else {
    result.dispute.castVote(result.disputeId, activeArbiters[0].agent_id, 'disputant', 'a', 'sig1');
    result.dispute.castVote(result.disputeId, activeArbiters[1].agent_id, 'respondent', 'b', 'sig2');
    result.dispute.castVote(result.disputeId, activeArbiters[2].agent_id, 'mutual', 'c', 'sig3');
  }

  return result;
}
