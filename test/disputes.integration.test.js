/**
 * Agentcourt Dispute Resolution — Integration Tests
 * Tests the full dispute lifecycle through the DisputeStore.
 *
 * Covers: intent → reveal → panel selection → arbiter accept →
 *         evidence submission → voting → verdict resolution
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { DisputeStore, DISPUTE_CONSTANTS, calculateDisputeSettlement } from '../dist/lib/disputes.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function makeCommitment(nonce) {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

function buildPool(count, { prefix = '@arb' } = {}) {
  const pool = [];
  for (let i = 0; i < count; i++) {
    pool.push(`${prefix}${i}`);
  }
  return pool;
}

/**
 * Run a dispute through the full lifecycle up to resolution.
 * Returns the resolved dispute from the store.
 */
function runFullLifecycle(store, { proposalId, disputant, respondent, reason, verdict, poolSize = 5 }) {
  const nonce = makeNonce();
  const commitment = makeCommitment(nonce);
  const pool = buildPool(poolSize);

  const dispute = store.fileIntent(proposalId, disputant, respondent, reason, commitment);
  store.reveal(dispute.id, nonce);
  store.selectPanel(dispute.id, pool);

  const d = store.get(dispute.id);
  for (const slot of d.arbiters) {
    store.arbiterAccept(dispute.id, slot.agent_id);
  }

  store.submitEvidence(dispute.id, disputant, [{ kind: 'other', label: 'claim', value: 'data' }], 'My case.', 'sig_d');
  store.submitEvidence(dispute.id, respondent, [{ kind: 'other', label: 'defense', value: 'data' }], 'My defense.', 'sig_r');
  store.closeEvidence(dispute.id);

  const afterEvidence = store.get(dispute.id);
  const arbiterIds = afterEvidence.arbiters.map(a => a.agent_id);

  // Cast votes according to desired verdict
  if (verdict === 'disputant') {
    store.castVote(dispute.id, arbiterIds[0], 'disputant', 'reason', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'disputant', 'reason', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'respondent', 'reason', 'sig2');
  } else if (verdict === 'respondent') {
    store.castVote(dispute.id, arbiterIds[0], 'respondent', 'reason', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'respondent', 'reason', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'disputant', 'reason', 'sig2');
  } else {
    store.castVote(dispute.id, arbiterIds[0], 'mutual', 'reason', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'mutual', 'reason', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'mutual', 'reason', 'sig2');
  }

  return store.get(dispute.id);
}

// ── Full Lifecycle Tests ────────────────────────────────────────────────

describe('Dispute Lifecycle Integration', () => {

  test('full lifecycle: intent → reveal → panel → accept → evidence → vote → verdict (disputant wins)', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    // Phase 1: Intent
    const dispute = store.fileIntent('prop_1', '@disputant', '@respondent', 'work not delivered', commitment);
    assert.equal(dispute.phase, 'reveal_pending');
    assert.equal(dispute.filing_fee_escrowed, true);

    // Phase 2: Reveal
    const revealed = store.reveal(dispute.id, nonce);
    assert.ok(revealed);
    assert.equal(revealed.phase, 'panel_selection');
    assert.ok(revealed.seed);

    // Phase 3: Panel selection
    const selected = store.selectPanel(dispute.id, pool);
    assert.ok(selected);
    assert.equal(selected.length, DISPUTE_CONSTANTS.PANEL_SIZE);

    const d = store.get(dispute.id);
    assert.equal(d.phase, 'arbiter_response');
    assert.equal(d.arbiters.length, DISPUTE_CONSTANTS.PANEL_SIZE);

    // Phase 4: All arbiters accept
    for (const slot of d.arbiters) {
      const accepted = store.arbiterAccept(dispute.id, slot.agent_id);
      assert.ok(accepted, `arbiter ${slot.agent_id} should accept`);
    }

    const afterAccept = store.get(dispute.id);
    assert.equal(afterAccept.phase, 'evidence');
    assert.ok(afterAccept.evidence_deadline);

    // Phase 5: Both parties submit evidence (separate args)
    const dEvidence = store.submitEvidence(dispute.id, '@disputant',
      [
        { kind: 'commit', label: 'Missing deliverable', value: 'abc123' },
        { kind: 'message_log', label: 'Agreement chat', value: 'We agreed on X' },
      ],
      'Work was not delivered as agreed.',
      'disputant_sig',
    );
    assert.equal(dEvidence, true);

    const rEvidence = store.submitEvidence(dispute.id, '@respondent',
      [
        { kind: 'commit', label: 'Partial delivery', value: 'def456' },
      ],
      'I delivered partial work, rest was blocked.',
      'respondent_sig',
    );
    assert.equal(rEvidence, true);

    // Evidence must be explicitly closed
    store.closeEvidence(dispute.id);

    const afterEvidence = store.get(dispute.id);
    assert.equal(afterEvidence.phase, 'deliberation');
    assert.ok(afterEvidence.vote_deadline);

    // Phase 6: Arbiter votes — 2 for disputant, 1 for respondent (majority wins)
    const arbiterIds = afterEvidence.arbiters.map(a => a.agent_id);

    store.castVote(dispute.id, arbiterIds[0], 'disputant', 'Work clearly not delivered', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'disputant', 'Agreement was clear', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'respondent', 'Partial work counts', 'sig2');

    // Verdict should be rendered
    const resolved = store.get(dispute.id);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'disputant');
    assert.equal(resolved.votes.length, 3);

    store.close();
  });

  test('full lifecycle: respondent wins', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_2', '@d', '@r', 'dispute reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    store.submitEvidence(dispute.id, '@d',
      [{ kind: 'other', label: 'claim', value: 'my claim' }],
      'They did wrong.',
      'sig_d',
    );
    store.submitEvidence(dispute.id, '@r',
      [{ kind: 'commit', label: 'proof', value: 'hash' }],
      'I did the work.',
      'sig_r',
    );
    store.closeEvidence(dispute.id);

    const afterEvidence = store.get(dispute.id);
    const arbiterIds = afterEvidence.arbiters.map(a => a.agent_id);

    // 2 for respondent, 1 for disputant
    store.castVote(dispute.id, arbiterIds[0], 'respondent', 'work was done', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'respondent', 'evidence supports respondent', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'disputant', 'work was incomplete', 'sig2');

    const resolved = store.get(dispute.id);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'respondent');

    store.close();
  });

  test('full lifecycle: mutual fault verdict', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_3', '@d', '@r', 'both at fault', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    store.submitEvidence(dispute.id, '@d', [], 'Both messed up.', 'sig_d');
    store.submitEvidence(dispute.id, '@r', [], 'Both share blame.', 'sig_r');
    store.closeEvidence(dispute.id);

    const afterEvidence = store.get(dispute.id);
    const arbiterIds = afterEvidence.arbiters.map(a => a.agent_id);

    // All vote mutual
    store.castVote(dispute.id, arbiterIds[0], 'mutual', 'both at fault', 'sig0');
    store.castVote(dispute.id, arbiterIds[1], 'mutual', 'shared responsibility', 'sig1');
    store.castVote(dispute.id, arbiterIds[2], 'mutual', 'agree', 'sig2');

    const resolved = store.get(dispute.id);
    assert.equal(resolved.phase, 'resolved');
    assert.equal(resolved.verdict, 'mutual');

    store.close();
  });

  test('arbiter decline triggers replacement from pool', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(8); // Extra agents for replacement

    const dispute = store.fileIntent('prop_4', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    const originalArbiter = d.arbiters[0].agent_id;
    // Capture original IDs before mutation (store.get returns a reference)
    const originalIds = d.arbiters.map(a => a.agent_id);

    // First arbiter declines
    const replacement = store.arbiterDecline(dispute.id, originalArbiter, pool);

    // Should get a replacement since pool has extras
    assert.ok(replacement, 'should find a replacement from pool');

    const afterDecline = store.get(dispute.id);
    const declinedSlot = afterDecline.arbiters.find(a => a.agent_id === originalArbiter);
    // Status transitions: declined → replaced when replacement is found
    assert.equal(declinedSlot.status, 'replaced');

    // Replacement should be different from all original arbiters
    assert.ok(!originalIds.includes(replacement), 'replacement should not be an original arbiter');

    // Replacement should be added to the panel
    const replacementSlot = afterDecline.arbiters.find(a => a.agent_id === replacement);
    assert.ok(replacementSlot, 'replacement should be in arbiters list');
    assert.equal(replacementSlot.status, 'pending');

    store.close();
  });

  test('wrong nonce in reveal is rejected', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);

    const dispute = store.fileIntent('prop_5', '@d', '@r', 'reason', commitment);
    const result = store.reveal(dispute.id, 'totally_wrong_nonce');

    assert.equal(result, null);
    assert.equal(store.get(dispute.id).phase, 'reveal_pending');

    store.close();
  });

  test('duplicate evidence submission is rejected', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_6', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    // First submission succeeds
    const first = store.submitEvidence(dispute.id, '@d',
      [{ kind: 'other', label: 'proof', value: 'data' }],
      'My case.',
      'sig1',
    );
    assert.equal(first, true);

    // Second submission from same party should fail
    const second = store.submitEvidence(dispute.id, '@d',
      [{ kind: 'other', label: 'more proof', value: 'more data' }],
      'Updated case.',
      'sig2',
    );
    assert.equal(second, false);

    store.close();
  });

  test('non-arbiter cannot vote', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_7', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    store.submitEvidence(dispute.id, '@d', [], 'case', 's');
    store.submitEvidence(dispute.id, '@r', [], 'case', 's');
    store.closeEvidence(dispute.id);

    // Random agent tries to vote
    const result = store.castVote(dispute.id, '@random_agent', 'disputant', 'i say so', 'sig');
    assert.equal(result, false);

    store.close();
  });

  test('duplicate vote from same arbiter is rejected', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_8', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    store.submitEvidence(dispute.id, '@d', [], 'x', 's');
    store.submitEvidence(dispute.id, '@r', [], 'x', 's');
    store.closeEvidence(dispute.id);

    const arbiter = store.get(dispute.id).arbiters[0].agent_id;

    // First vote succeeds
    const first = store.castVote(dispute.id, arbiter, 'disputant', 'reason', 'sig1');
    assert.equal(first, true);

    // Second vote from same arbiter should fail (status is now 'voted', not 'accepted')
    const second = store.castVote(dispute.id, arbiter, 'respondent', 'changed mind', 'sig2');
    assert.equal(second, false);

    store.close();
  });

  test('evidence hashes are computed for each item', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const pool = buildPool(5);

    const dispute = store.fileIntent('prop_9', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);
    store.selectPanel(dispute.id, pool);

    const d = store.get(dispute.id);
    for (const slot of d.arbiters) {
      store.arbiterAccept(dispute.id, slot.agent_id);
    }

    store.submitEvidence(dispute.id, '@d',
      [
        { kind: 'commit', label: 'commit ref', value: 'abc123' },
        { kind: 'message_log', label: 'chat log', value: 'conversation text' },
      ],
      'Evidence submitted.',
      'sig',
    );

    const afterEvidence = store.get(dispute.id);
    const items = afterEvidence.disputant_evidence.items;
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.ok(item.hash, `item "${item.label}" should have a hash`);
      assert.equal(item.hash.length, 64); // SHA256 hex
    }

    store.close();
  });

  test('seed is deterministic from proposal_id + nonce + server_nonce', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);

    const dispute = store.fileIntent('prop_10', '@d', '@r', 'reason', commitment);
    store.reveal(dispute.id, nonce);

    const d = store.get(dispute.id);
    const expectedSeed = crypto.createHash('sha256')
      .update('prop_10' + nonce + d.server_nonce)
      .digest('hex');

    assert.equal(d.seed, expectedSeed);

    store.close();
  });

  test('lookups: getByProposal and listByAgent', () => {
    const store = new DisputeStore();
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);

    const dispute = store.fileIntent('prop_11', '@alice', '@bob', 'reason', commitment);

    // Lookup by proposal
    const byProp = store.getByProposal('prop_11');
    assert.ok(byProp);
    assert.equal(byProp.id, dispute.id);

    // Lookup by agent
    const aliceDisputes = store.listByAgent('@alice');
    assert.equal(aliceDisputes.length, 1);
    assert.equal(aliceDisputes[0].id, dispute.id);

    const bobDisputes = store.listByAgent('@bob');
    assert.equal(bobDisputes.length, 1);

    store.close();
  });
});

describe('calculateDisputeSettlement', () => {
  test('disputant wins: disputant gains, respondent loses', () => {
    if (!calculateDisputeSettlement) return;

    const store = new DisputeStore();
    const resolved = runFullLifecycle(store, {
      proposalId: 'settle_1',
      disputant: '@d',
      respondent: '@r',
      reason: 'test settlement',
      verdict: 'disputant',
    });

    const ratings = {
      '@d': { rating: 1200, transactions: 10 },
      '@r': { rating: 1200, transactions: 10 },
    };

    const changes = calculateDisputeSettlement(resolved, ratings);

    assert.ok(changes);
    assert.ok(changes['@d'].change > 0, 'disputant should gain rating');
    assert.ok(changes['@r'].change < 0, 'respondent should lose rating');

    store.close();
  });

  test('respondent wins: respondent gains, disputant loses', () => {
    if (!calculateDisputeSettlement) return;

    const store = new DisputeStore();
    const resolved = runFullLifecycle(store, {
      proposalId: 'settle_2',
      disputant: '@d',
      respondent: '@r',
      reason: 'test settlement',
      verdict: 'respondent',
    });

    const ratings = {
      '@d': { rating: 1200, transactions: 10 },
      '@r': { rating: 1200, transactions: 10 },
    };

    const changes = calculateDisputeSettlement(resolved, ratings);

    assert.ok(changes);
    assert.ok(changes['@r'].change > 0, 'respondent should gain rating');
    assert.ok(changes['@d'].change < 0, 'disputant should lose rating');

    store.close();
  });

  test('mutual fault: both lose', () => {
    if (!calculateDisputeSettlement) return;

    const store = new DisputeStore();
    const resolved = runFullLifecycle(store, {
      proposalId: 'settle_3',
      disputant: '@d',
      respondent: '@r',
      reason: 'test settlement',
      verdict: 'mutual',
    });

    const ratings = {
      '@d': { rating: 1200, transactions: 10 },
      '@r': { rating: 1200, transactions: 10 },
    };

    const changes = calculateDisputeSettlement(resolved, ratings);

    assert.ok(changes);
    assert.ok(changes['@d'].change < 0, 'disputant should lose rating');
    assert.ok(changes['@r'].change < 0, 'respondent should lose rating');

    store.close();
  });

  test('settlement includes arbiter rewards for majority voters', () => {
    if (!calculateDisputeSettlement) return;

    const store = new DisputeStore();
    const resolved = runFullLifecycle(store, {
      proposalId: 'settle_4',
      disputant: '@d',
      respondent: '@r',
      reason: 'test arbiter rewards',
      verdict: 'disputant',
    });

    const ratings = {
      '@d': { rating: 1200, transactions: 10 },
      '@r': { rating: 1200, transactions: 10 },
    };
    // Add arbiter ratings
    for (const slot of resolved.arbiters) {
      ratings[slot.agent_id] = { rating: 1400, transactions: 20 };
    }

    const changes = calculateDisputeSettlement(resolved, ratings);

    // Arbiters who voted with the majority (disputant) should get ARBITER_REWARD
    const majorityVoters = resolved.arbiters.filter(
      a => a.vote && a.vote.verdict === 'disputant'
    );
    for (const voter of majorityVoters) {
      assert.equal(changes[voter.agent_id].change, DISPUTE_CONSTANTS.ARBITER_REWARD,
        `majority voter ${voter.agent_id} should get ARBITER_REWARD`);
    }

    // Dissenter should get 0
    const dissenters = resolved.arbiters.filter(
      a => a.vote && a.vote.verdict !== 'disputant'
    );
    for (const dissenter of dissenters) {
      assert.equal(changes[dissenter.agent_id].change, 0,
        `dissenter ${dissenter.agent_id} should get 0 change`);
    }

    store.close();
  });
});
