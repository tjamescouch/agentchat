/**
 * Dispute Signature Verification Tests
 *
 * Tests that all signed agentcourt dispute messages are cryptographically
 * verified before processing (issue #27).
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

/**
 * Wait for a raw WebSocket message of a given type.
 * The raw WS handler fires for every message, including agentcourt types
 * that the client doesn't emit events for.
 */
function waitForRawType(client, type, timeoutMs = 3000) {
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

/**
 * Collect the next ERROR from the client.
 * Returns null if no error within timeout (meaning the operation succeeded).
 */
function expectError(client, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = (err) => {
      clearTimeout(timer);
      resolve(err);
    };
    // Use once — errors are emitted as 'error' events
    client.once('error', handler);
  });
}

/**
 * Create a fake accepted proposal.
 */
function createFakeAcceptedProposal(server, fromId, toId) {
  const proposal = server.proposals.create({
    from: fromId,
    to: toId,
    task: 'Test task',
    amount: 1,
    currency: 'TEST',
    sig: 'test-sig',
  });
  server.proposals.accept(proposal.id, toId, 'accept-sig');
  return proposal.id;
}

describe('Dispute Signature Verification', () => {
  let server;
  let testPort;
  let testServer;
  let tempDir;
  let identity1, identity2, identity3, identity4, identity5;
  let client1, client2, client3, client4, client5;
  let wrongIdentity;

  before(async () => {
    testPort = 17600 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;
    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-dispute-sig-test-'));

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
    wrongIdentity = Identity.generate('wrong-agent');

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

    // Add permanent error handlers to prevent ERR_UNHANDLED_ERROR crashes.
    // These are no-ops — actual error checking is done via expectError().
    for (const c of [client1, client2, client3, client4, client5]) {
      c.on('error', () => {});
    }

    // Seed arbiter reputation
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

  // ── DISPUTE_INTENT ──────────────────────────────────────────────

  it('DISPUTE_INTENT with valid signature succeeds', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);

    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const reason = 'Work not delivered';
    const content = getDisputeIntentSigningContent(proposalId, reason, commitment);
    const sig = identity1.sign(content);

    const ackPromise = waitForRawType(client1, 'DISPUTE_INTENT_ACK');
    client1.sendRaw({
      type: 'DISPUTE_INTENT',
      proposal_id: proposalId,
      reason,
      commitment,
      sig,
    });

    const ack = await ackPromise;
    assert.ok(ack.dispute_id, 'Should receive dispute_id');
    assert.strictEqual(ack.proposal_id, proposalId);
  });

  it('DISPUTE_INTENT with invalid signature is rejected', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);

    const errPromise = waitForRawType(client1, 'ERROR');
    client1.sendRaw({
      type: 'DISPUTE_INTENT',
      proposal_id: proposalId,
      reason: 'Work not delivered',
      commitment: makeCommitment(makeNonce()),
      sig: 'invalid-base64-signature',
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  it('DISPUTE_INTENT signed by wrong key is rejected', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);

    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const reason = 'Work not delivered';
    const content = getDisputeIntentSigningContent(proposalId, reason, commitment);
    const sig = wrongIdentity.sign(content);

    const errPromise = waitForRawType(client1, 'ERROR');
    client1.sendRaw({
      type: 'DISPUTE_INTENT',
      proposal_id: proposalId,
      reason,
      commitment,
      sig,
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  // ── DISPUTE_REVEAL ──────────────────────────────────────────────

  it('DISPUTE_REVEAL with valid signature succeeds', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);
    const nonce = makeNonce();
    await fileDisputeIntent(client1, identity1, proposalId, nonce);

    const revealContent = getDisputeRevealSigningContent(proposalId, nonce);
    const sig = identity1.sign(revealContent);

    // Expect DISPUTE_REVEALED (success with enough arbiters) or DISPUTE_FALLBACK
    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 3000);
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
      sig,
    });

    const result = await resultPromise;
    assert.ok(result.type === 'DISPUTE_REVEALED' || result.type === 'DISPUTE_FALLBACK');
  });

  it('DISPUTE_REVEAL with invalid signature is rejected', async () => {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);
    const nonce = makeNonce();
    await fileDisputeIntent(client1, identity1, proposalId, nonce);

    const errPromise = waitForRawType(client1, 'ERROR');
    client1.sendRaw({
      type: 'DISPUTE_REVEAL',
      proposal_id: proposalId,
      nonce,
      sig: 'bad-signature',
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  // ── EVIDENCE ────────────────────────────────────────────────────

  it('EVIDENCE with valid signature succeeds', async () => {
    const disputeId = setupDisputeInEvidencePhase();

    const items = [{ kind: 'other', label: 'claim', value: 'data' }];
    const itemsJson = JSON.stringify(items);
    const evidenceContent = getEvidenceSigningContent(disputeId, itemsJson);
    const sig = identity1.sign(evidenceContent);

    const ackPromise = waitForRawType(client1, 'EVIDENCE_RECEIVED');
    client1.sendRaw({
      type: 'EVIDENCE',
      dispute_id: disputeId,
      items,
      statement: 'My case.',
      sig,
    });

    const ack = await ackPromise;
    assert.strictEqual(ack.dispute_id, disputeId);
  });

  it('EVIDENCE with invalid signature is rejected', async () => {
    const disputeId = setupDisputeInEvidencePhase();

    const errPromise = waitForRawType(client1, 'ERROR');
    client1.sendRaw({
      type: 'EVIDENCE',
      dispute_id: disputeId,
      items: [{ kind: 'other', label: 'evidence', value: 'data' }],
      statement: 'My case.',
      sig: 'bad-signature',
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  // ── ARBITER_ACCEPT ──────────────────────────────────────────────

  it('ARBITER_ACCEPT with valid signature succeeds', async () => {
    const { disputeId, arbiterSlot } = setupDisputeInArbiterResponse();
    const arbiterClient = getClientForAgent(arbiterSlot.agent_id);
    const arbiterIdent = getIdentityForAgent(arbiterSlot.agent_id);

    const acceptContent = getArbiterAcceptSigningContent(disputeId);
    const sig = arbiterIdent.sign(acceptContent);

    const errPromise = expectError(arbiterClient, 500);
    arbiterClient.sendRaw({
      type: 'ARBITER_ACCEPT',
      dispute_id: disputeId,
      sig,
    });

    const err = await errPromise;
    assert.strictEqual(err, null, 'Should not receive an error');
  });

  it('ARBITER_ACCEPT with invalid signature is rejected', async () => {
    const { disputeId, arbiterSlot } = setupDisputeInArbiterResponse();
    const arbiterClient = getClientForAgent(arbiterSlot.agent_id);

    const errPromise = waitForRawType(arbiterClient, 'ERROR');
    arbiterClient.sendRaw({
      type: 'ARBITER_ACCEPT',
      dispute_id: disputeId,
      sig: 'bad-signature',
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  // ── ARBITER_VOTE ────────────────────────────────────────────────

  it('ARBITER_VOTE with valid signature succeeds', async () => {
    const { disputeId, arbiterSlot } = setupDisputeInDeliberation();
    const arbiterClient = getClientForAgent(arbiterSlot.agent_id);
    const arbiterIdent = getIdentityForAgent(arbiterSlot.agent_id);

    const voteContent = getVoteSigningContent(disputeId, 'disputant');
    const sig = arbiterIdent.sign(voteContent);

    const errPromise = expectError(arbiterClient, 500);
    arbiterClient.sendRaw({
      type: 'ARBITER_VOTE',
      dispute_id: disputeId,
      verdict: 'disputant',
      reasoning: 'Evidence supports disputant',
      sig,
    });

    const err = await errPromise;
    assert.strictEqual(err, null, 'Should not receive an error');
  });

  it('ARBITER_VOTE with invalid signature is rejected', async () => {
    const { disputeId, arbiterSlot } = setupDisputeInDeliberation();
    const arbiterClient = getClientForAgent(arbiterSlot.agent_id);

    const errPromise = waitForRawType(arbiterClient, 'ERROR');
    arbiterClient.sendRaw({
      type: 'ARBITER_VOTE',
      dispute_id: disputeId,
      verdict: 'disputant',
      reasoning: 'Evidence supports disputant',
      sig: 'bad-signature',
    });

    const err = await errPromise;
    assert.strictEqual(err.code, 'VERIFICATION_FAILED');
  });

  // ── Helpers ─────────────────────────────────────────────────────

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

  async function fileDisputeIntent(client, identity, proposalId, nonce) {
    const commitment = makeCommitment(nonce);
    const reason = 'Work not delivered';
    const content = getDisputeIntentSigningContent(proposalId, reason, commitment);
    const sig = identity.sign(content);

    const ackPromise = waitForRawType(client, 'DISPUTE_INTENT_ACK');
    client.sendRaw({
      type: 'DISPUTE_INTENT',
      proposal_id: proposalId,
      reason,
      commitment,
      sig,
    });

    const ack = await ackPromise;
    return { disputeId: ack.dispute_id, serverNonce: ack.server_nonce };
  }

  function setupDisputeInEvidencePhase() {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const dispute = server.disputes.fileIntent(proposalId, disputantId, respondentId, 'test reason', commitment);
    server.disputes.reveal(dispute.id, nonce);
    const arbiterIds = [`@${identity3.getAgentId()}`, `@${identity4.getAgentId()}`, `@${identity5.getAgentId()}`];
    server.disputes.selectPanel(dispute.id, arbiterIds);
    for (const aid of arbiterIds) server.disputes.arbiterAccept(dispute.id, aid);
    return dispute.id;
  }

  function setupDisputeInArbiterResponse() {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const dispute = server.disputes.fileIntent(proposalId, disputantId, respondentId, 'test reason', commitment);
    server.disputes.reveal(dispute.id, nonce);
    const arbiterIds = [`@${identity3.getAgentId()}`, `@${identity4.getAgentId()}`, `@${identity5.getAgentId()}`];
    server.disputes.selectPanel(dispute.id, arbiterIds);
    return { disputeId: dispute.id, arbiterSlot: server.disputes.get(dispute.id).arbiters[0] };
  }

  function setupDisputeInDeliberation() {
    const disputantId = `@${identity1.getAgentId()}`;
    const respondentId = `@${identity2.getAgentId()}`;
    const proposalId = createFakeAcceptedProposal(server, disputantId, respondentId);
    const nonce = makeNonce();
    const commitment = makeCommitment(nonce);
    const dispute = server.disputes.fileIntent(proposalId, disputantId, respondentId, 'test reason', commitment);
    server.disputes.reveal(dispute.id, nonce);
    const arbiterIds = [`@${identity3.getAgentId()}`, `@${identity4.getAgentId()}`, `@${identity5.getAgentId()}`];
    server.disputes.selectPanel(dispute.id, arbiterIds);
    for (const aid of arbiterIds) server.disputes.arbiterAccept(dispute.id, aid);
    server.disputes.submitEvidence(dispute.id, disputantId, [{ kind: 'other', label: 'a', value: 'b' }], 'case', 'sig');
    server.disputes.submitEvidence(dispute.id, respondentId, [{ kind: 'other', label: 'c', value: 'd' }], 'defense', 'sig');
    server.disputes.closeEvidence(dispute.id);
    return { disputeId: dispute.id, arbiterSlot: server.disputes.get(dispute.id).arbiters[0] };
  }
});
