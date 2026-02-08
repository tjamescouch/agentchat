/**
 * Agentcourt Dispute Resolution Tests
 * Tests the DisputeStore and dispute lifecycle
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { DisputeStore, DISPUTE_CONSTANTS } from '../dist/lib/disputes.js';

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
