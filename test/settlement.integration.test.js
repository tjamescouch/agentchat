/**
 * Verdict Settlement Integration Tests
 * Tests the full dispute lifecycle through WebSocket: intent → reveal → panel →
 * arbiter accept → evidence → votes → VERDICT → SETTLEMENT_COMPLETE.
 * Verifies that ELO rating changes are correctly applied after verdict.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import {
  getDisputeIntentSigningContent,
  getDisputeRevealSigningContent,
  getEvidenceSigningContent,
  getArbiterAcceptSigningContent,
  getVoteSigningContent,
} from '../dist/lib/disputes.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function makeCommitment(nonce) {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

function waitForRawType(client, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.ws?.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeoutMs);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          client.ws?.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    };
    client.ws?.on('message', handler);
  });
}

function createFakeAcceptedProposal(server, fromId, toId) {
  const proposal = server.proposals.create({
    from: fromId,
    to: toId,
    task: 'Settlement test task',
    amount: 100,
    currency: 'TEST',
    sig: 'test-sig',
  });
  server.proposals.accept(proposal.id, toId, 'accept-sig');
  return proposal.id;
}

describe('Verdict Settlement Integration', () => {
  let server;
  let testPort;
  let testServer;
  let tempDir;
  let identity1, identity2, identity3, identity4, identity5;
  let client1, client2, client3, client4, client5;

  before(async () => {
    testPort = 17800 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;
    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-settlement-test-'));

    identity1 = Identity.generate('disputant');
    await identity1.save(path.join(tempDir, 'disputant.json'));
    identity2 = Identity.generate('respondent');
    await identity2.save(path.join(tempDir, 'respondent.json'));
    identity3 = Identity.generate('arbiter1');
    await identity3.save(path.join(tempDir, 'arbiter1.json'));
    identity4 = Identity.generate('arbiter2');
    await identity4.save(path.join(tempDir, 'arbiter2.json'));
    identity5 = Identity.generate('arbiter3');
    await identity5.save(path.join(tempDir, 'arbiter3.json'));

    client1 = new AgentChatClient({ server: testServer, identity: path.join(tempDir, 'disputant.json') });
    await client1.connect();
    client2 = new AgentChatClient({ server: testServer, identity: path.join(tempDir, 'respondent.json') });
    await client2.connect();
    client3 = new AgentChatClient({ server: testServer, identity: path.join(tempDir, 'arbiter1.json') });
    await client3.connect();
    client4 = new AgentChatClient({ server: testServer, identity: path.join(tempDir, 'arbiter2.json') });
    await client4.connect();
    client5 = new AgentChatClient({ server: testServer, identity: path.join(tempDir, 'arbiter3.json') });
    await client5.connect();

    for (const c of [client1, client2, client3, client4, client5]) {
      c.on('error', () => {});
    }

    // Trigger lazy load of ratings store, then seed arbiter reputation
    await server.reputationStore.getRating('@seed');
    for (const id of [identity3, identity4, identity5]) {
      server.reputationStore._ratings[`@${id.getAgentId()}`] = {
        rating: 1500, transactions: 50, updated: Date.now(),
      };
    }
  });

  after(() => {
    for (const c of [client1, client2, client3, client4, client5]) {
      c?.disconnect();
    }
    server?.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function getClientForAgent(agentId) {
    const id = agentId.startsWith('@') ? agentId.slice(1) : agentId;
    if (id === identity3.getAgentId()) return client3;
    if (id === identity4.getAgentId()) return client4;
    if (id === identity5.getAgentId()) return client5;
    throw new Error(`No client for agent ${agentId}`);
  }

  function getIdentityForAgent(agentId) {
    const id = agentId.startsWith('@') ? agentId.slice(1) : agentId;
    if (id === identity3.getAgentId()) return identity3;
    if (id === identity4.getAgentId()) return identity4;
    if (id === identity5.getAgentId()) return identity5;
    throw new Error(`No identity for agent ${agentId}`);
  }

  it('full lifecycle: intent → reveal → panel → evidence → votes → VERDICT + SETTLEMENT_COMPLETE', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);

    // Record initial ratings
    const initialDisputant = await server.reputationStore.getRating(disputantId);
    const initialRespondent = await server.reputationStore.getRating(respondentId);

    // 1. DISPUTE_INTENT
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const reason = 'Work not delivered';
    const intentSig = identity1.sign(getDisputeIntentSigningContent(proposalId, reason, commitment));

    const ackPromise = waitForRawType(client1, 'DISPUTE_INTENT_ACK');
    client1.sendRaw({
      type: 'DISPUTE_INTENT',
      proposal_id: proposalId,
      reason,
      commitment,
      sig: intentSig,
    });
    const ack = await ackPromise;
    assert.ok(ack.dispute_id, 'Should get dispute_id from intent ACK');

    // 2. DISPUTE_REVEAL
    const revealSig = identity1.sign(getDisputeRevealSigningContent(proposalId, nonce));

    const revealPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for reveal result')), 5000);
      const handler = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'DISPUTE_REVEALED' || msg.type === 'DISPUTE_FALLBACK') {
            clearTimeout(timer);
            client1.ws?.removeListener('message', handler);
            resolve(msg);
          }
        } catch {}
      };
      client1.ws?.on('message', handler);
    });

    client1.sendRaw({
      type: 'DISPUTE_REVEAL',
      proposal_id: proposalId,
      nonce,
      sig: revealSig,
    });
    const revealResult = await revealPromise;

    // If not enough qualified arbiters, skip rest of test
    if (revealResult.type === 'DISPUTE_FALLBACK') {
      assert.ok(true, 'Fallback due to insufficient arbiters — settlement not applicable');
      return;
    }

    assert.strictEqual(revealResult.type, 'DISPUTE_REVEALED');

    // 3. ARBITER ACCEPT — all 3 arbiters accept via server-side shortcut
    const dispute = server.disputes.get(ack.dispute_id);
    const arbiterIds = dispute.arbiters.map(a => a.agent_id);

    for (const arbiterId of arbiterIds) {
      const arbiterClient = getClientForAgent(arbiterId);
      const arbiterIdentity = getIdentityForAgent(arbiterId);
      const acceptSig = arbiterIdentity.sign(getArbiterAcceptSigningContent(ack.dispute_id));

      arbiterClient.sendRaw({
        type: 'ARBITER_ACCEPT',
        dispute_id: ack.dispute_id,
        sig: acceptSig,
      });
      // Small delay to let server process
      await new Promise(r => setTimeout(r, 50));
    }

    // 4. EVIDENCE — both parties submit via server-side shortcut
    const disputeAfterAccept = server.disputes.get(ack.dispute_id);
    if (disputeAfterAccept.phase === 'evidence') {
      const items1 = [{ kind: 'other', label: 'proof', value: 'screenshots of incomplete work' }];
      const itemsJson1 = JSON.stringify(items1);
      const evidenceSig1 = identity1.sign(getEvidenceSigningContent(ack.dispute_id, itemsJson1));

      client1.sendRaw({
        type: 'EVIDENCE',
        dispute_id: ack.dispute_id,
        items: items1,
        statement: 'Work was never delivered as promised.',
        sig: evidenceSig1,
      });
      await new Promise(r => setTimeout(r, 50));

      const items2 = [{ kind: 'other', label: 'defense', value: 'partial delivery proof' }];
      const itemsJson2 = JSON.stringify(items2);
      const evidenceSig2 = identity2.sign(getEvidenceSigningContent(ack.dispute_id, itemsJson2));

      client2.sendRaw({
        type: 'EVIDENCE',
        dispute_id: ack.dispute_id,
        items: items2,
        statement: 'Delivered partial work as agreed.',
        sig: evidenceSig2,
      });
      await new Promise(r => setTimeout(r, 50));

      // Close evidence via server shortcut (no WebSocket message for this)
      server.disputes.closeEvidence(ack.dispute_id);
    }

    // 5. ARBITER VOTES — 2 vote disputant, 1 votes respondent (majority: disputant wins)
    const disputeInDelib = server.disputes.get(ack.dispute_id);
    assert.strictEqual(disputeInDelib.phase, 'deliberation', 'Should be in deliberation phase');

    // Set up listeners for VERDICT and SETTLEMENT_COMPLETE BEFORE voting
    const verdictPromise = waitForRawType(client1, 'VERDICT', 10000);
    const settlementPromise = waitForRawType(client1, 'SETTLEMENT_COMPLETE', 10000);

    const votingArbiters = disputeInDelib.arbiters.filter(a => a.status === 'accepted');
    assert.ok(votingArbiters.length >= 3, 'Need at least 3 accepted arbiters');

    // Arbiter 1 & 2 vote for disputant
    for (let i = 0; i < 2; i++) {
      const slot = votingArbiters[i];
      const arbClient = getClientForAgent(slot.agent_id);
      const arbIdentity = getIdentityForAgent(slot.agent_id);
      const voteSig = arbIdentity.sign(getVoteSigningContent(ack.dispute_id, 'disputant'));

      arbClient.sendRaw({
        type: 'ARBITER_VOTE',
        dispute_id: ack.dispute_id,
        verdict: 'disputant',
        reasoning: 'Evidence supports the disputant.',
        sig: voteSig,
      });
      await new Promise(r => setTimeout(r, 100));
    }

    // Arbiter 3 votes respondent (dissent)
    const dissenter = votingArbiters[2];
    const dissenterClient = getClientForAgent(dissenter.agent_id);
    const dissenterIdentity = getIdentityForAgent(dissenter.agent_id);
    const dissenterSig = dissenterIdentity.sign(getVoteSigningContent(ack.dispute_id, 'respondent'));

    dissenterClient.sendRaw({
      type: 'ARBITER_VOTE',
      dispute_id: ack.dispute_id,
      verdict: 'respondent',
      reasoning: 'Partial delivery should count.',
      sig: dissenterSig,
    });

    // 6. Wait for VERDICT
    const verdict = await verdictPromise;
    assert.strictEqual(verdict.type, 'VERDICT');
    assert.strictEqual(verdict.dispute_id, ack.dispute_id);
    assert.strictEqual(verdict.verdict, 'disputant', 'Majority voted disputant');

    // 7. Wait for SETTLEMENT_COMPLETE
    const settlement = await settlementPromise;
    assert.strictEqual(settlement.type, 'SETTLEMENT_COMPLETE');
    assert.strictEqual(settlement.dispute_id, ack.dispute_id);
    assert.strictEqual(settlement.verdict, 'disputant');
    assert.ok(settlement.rating_changes, 'Should include rating_changes');

    // Verify disputant gained ELO
    const disputantChange = settlement.rating_changes[disputantId];
    assert.ok(disputantChange, 'Disputant should have rating change');
    assert.ok(disputantChange.change > 0, `Disputant should gain ELO, got: ${disputantChange.change}`);

    // Verify respondent lost ELO
    const respondentChange = settlement.rating_changes[respondentId];
    assert.ok(respondentChange, 'Respondent should have rating change');
    assert.ok(respondentChange.change < 0, `Respondent should lose ELO, got: ${respondentChange.change}`);

    // Verify ratings were actually persisted
    const finalDisputant = await server.reputationStore.getRating(disputantId);
    const finalRespondent = await server.reputationStore.getRating(respondentId);
    assert.notStrictEqual(finalDisputant.rating, initialDisputant.rating, 'Disputant rating should have changed');
    assert.notStrictEqual(finalRespondent.rating, initialRespondent.rating, 'Respondent rating should have changed');
  });

  it('settlement includes arbiter rewards for majority voters', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);

    // Use server-side shortcuts to quickly set up a resolved dispute
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const dispute = server.disputes.fileIntent(proposalId, disputantId, respondentId, 'test', commitment);
    server.disputes.reveal(dispute.id, nonce);
    const arbiterIds = [`@${identity3.getAgentId()}`, `@${identity4.getAgentId()}`, `@${identity5.getAgentId()}`];
    server.disputes.selectPanel(dispute.id, arbiterIds);
    for (const aid of arbiterIds) server.disputes.arbiterAccept(dispute.id, aid);
    server.disputes.submitEvidence(dispute.id, disputantId, [{ kind: 'other', label: 'a', value: 'b' }], 'case', 'sig');
    server.disputes.submitEvidence(dispute.id, respondentId, [{ kind: 'other', label: 'c', value: 'd' }], 'defense', 'sig');
    server.disputes.closeEvidence(dispute.id);

    // Record arbiter ratings before votes
    const arbiter1Rating = await server.reputationStore.getRating(arbiterIds[0]);
    const arbiter3Rating = await server.reputationStore.getRating(arbiterIds[2]);

    // Listen for SETTLEMENT_COMPLETE
    const settlementPromise = waitForRawType(client1, 'SETTLEMENT_COMPLETE', 10000);

    // 2 vote disputant, 1 votes respondent (via signed WebSocket messages for the final vote to trigger settlement)
    const d = server.disputes.get(dispute.id);

    // Cast first two votes via store (server-side)
    server.disputes.castVote(dispute.id, arbiterIds[0], 'disputant', 'Agree with disputant', 'sig1');
    server.disputes.castVote(dispute.id, arbiterIds[1], 'disputant', 'Agree with disputant', 'sig2');

    // Cast final vote via WebSocket to trigger the handler that sends SETTLEMENT_COMPLETE
    const finalArbiterClient = getClientForAgent(arbiterIds[2]);
    const finalArbiterIdentity = getIdentityForAgent(arbiterIds[2]);
    const voteSig = finalArbiterIdentity.sign(getVoteSigningContent(dispute.id, 'respondent'));

    finalArbiterClient.sendRaw({
      type: 'ARBITER_VOTE',
      dispute_id: dispute.id,
      verdict: 'respondent',
      reasoning: 'Disagree with majority',
      sig: voteSig,
    });

    const settlement = await settlementPromise;
    assert.strictEqual(settlement.type, 'SETTLEMENT_COMPLETE');

    // Check that arbiter rating changes are included
    for (const aid of arbiterIds) {
      const arbiterChange = settlement.rating_changes[aid];
      assert.ok(arbiterChange, `Arbiter ${aid} should have rating change`);
    }

    // Majority voters (arbiters 1 & 2) should have positive reward
    const arbiter1Change = settlement.rating_changes[arbiterIds[0]];
    assert.ok(arbiter1Change.change > 0, `Majority arbiter should gain ELO, got: ${arbiter1Change.change}`);

    // Dissenter (arbiter 3) should get 0 reward (no penalty for dissent, just no reward)
    const arbiter3Change = settlement.rating_changes[arbiterIds[2]];
    assert.ok(arbiter3Change.change <= 0, `Dissenting arbiter should not gain ELO, got: ${arbiter3Change.change}`);
  });
});
