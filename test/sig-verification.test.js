/**
 * Signature Verification Integration Tests
 * Tests that the server correctly verifies Ed25519 signatures on all signed message types
 * and rejects messages with invalid signatures.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import {
  getProposalSigningContent,
  getAcceptSigningContent,
  getRejectSigningContent,
  getCompleteSigningContent,
  getDisputeSigningContent,
} from '../dist/lib/proposals.js';
import {
  getDisputeIntentSigningContent,
  getDisputeRevealSigningContent,
} from '../dist/lib/disputes.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_PORT = 16690;
const TEST_SERVER = `ws://localhost:${TEST_PORT}`;

/**
 * Helper: send a raw message via client's internal _send
 */
function rawSend(client, msg) {
  client._send(msg);
}

/**
 * Helper: wait for a specific message type from the server
 */
function waitForMessage(client, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          client.ws.removeListener('message', handler);
          clearTimeout(timer);
          resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    };
    client.ws.on('message', handler);
  });
}

describe('Signature Verification', () => {
  let server;
  let tmpDir;
  let aliceIdentityPath;
  let bobIdentityPath;
  let aliceIdentity;
  let bobIdentity;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `agentchat-sigtest-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    aliceIdentityPath = path.join(tmpDir, 'alice.json');
    bobIdentityPath = path.join(tmpDir, 'bob.json');

    aliceIdentity = Identity.generate('alice');
    await aliceIdentity.save(aliceIdentityPath);
    bobIdentity = Identity.generate('bob');
    await bobIdentity.save(bobIdentityPath);

    server = new AgentChatServer({ port: TEST_PORT, logMessages: false });
    server.start();
  });

  after(async () => {
    server.stop();
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  // ============ Positive tests: valid signatures accepted ============

  it('accepts proposal with valid signature (client signs correctly)', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    // Client.propose() handles signing internally
    const proposal = await alice.propose(bob.agentId, {
      task: 'Test sig verification',
      amount: 10,
      currency: 'TEST',
      expires: 300,
    });

    assert.ok(proposal.id, 'Proposal should have been created with valid signature');

    alice.disconnect();
    bob.disconnect();
  });

  it('accepts accept with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await alice.propose(bob.agentId, {
      task: 'Accept sig test',
      amount: 5,
      currency: 'TEST',
      expires: 300,
    });

    const acceptPromise = waitForMessage(alice, 'ACCEPT');
    await bob.accept(proposal.id);
    const accept = await acceptPromise;

    assert.equal(accept.proposal_id, proposal.id);

    alice.disconnect();
    bob.disconnect();
  });

  it('accepts dispute intent with valid manually-signed message', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    // Create accepted proposal
    const proposal = await alice.propose(bob.agentId, {
      task: 'Dispute sig test',
      amount: 10,
      currency: 'TEST',
      payment_code: 'test-pay',
      expires: 300,
    });
    const acceptPromise = waitForMessage(alice, 'ACCEPT');
    await bob.accept(proposal.id);
    await acceptPromise;

    // File dispute with manually-computed signature
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');
    const reason = 'Work not delivered';

    const sigContent = getDisputeIntentSigningContent(proposal.id, reason, commitment);
    const sig = aliceIdentity.sign(sigContent);

    const ackPromise = waitForMessage(alice, 'DISPUTE_INTENT_ACK');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason,
      commitment,
      sig,
    });

    const ack = await ackPromise;
    assert.ok(ack.dispute_id, 'Should receive ACK with dispute_id');

    alice.disconnect();
    bob.disconnect();
  });

  // ============ Negative tests: invalid signatures rejected ============

  it('rejects proposal with tampered signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    // Manually construct a proposal with a bad signature
    const proposalData = {
      to: bob.agentId,
      task: 'Tampered sig test',
      amount: 10,
      currency: 'TEST',
      expires: 300,
    };

    const sigContent = getProposalSigningContent(proposalData);
    // Sign with alice's key but then tamper the signature
    const validSig = aliceIdentity.sign(sigContent);
    const tamperedSig = validSig.slice(0, -4) + 'XXXX'; // Corrupt last bytes

    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'PROPOSAL',
      ...proposalData,
      sig: tamperedSig,
    });

    const error = await errorPromise;
    assert.ok(
      error.code === 'VERIFICATION_FAILED' || error.message.includes('signature') || error.message.includes('Invalid'),
      `Expected verification failure, got: ${error.code} ${error.message}`
    );

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects accept with wrong signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await alice.propose(bob.agentId, {
      task: 'Wrong sig accept test',
      amount: 5,
      currency: 'TEST',
      expires: 300,
    });

    // Send ACCEPT with a wrong signature (sign different content)
    const wrongSigContent = getAcceptSigningContent('wrong_proposal_id', '', '');
    const wrongSig = bobIdentity.sign(wrongSigContent);

    const errorPromise = waitForMessage(bob, 'ERROR');
    rawSend(bob, {
      type: 'ACCEPT',
      proposal_id: proposal.id,
      sig: wrongSig,
    });

    const error = await errorPromise;
    assert.ok(
      error.code === 'VERIFICATION_FAILED' || error.message.includes('signature') || error.message.includes('Invalid'),
      `Expected verification failure, got: ${error.code} ${error.message}`
    );

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects dispute intent with invalid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    // Create accepted proposal
    const proposal = await alice.propose(bob.agentId, {
      task: 'Bad sig dispute test',
      amount: 10,
      currency: 'TEST',
      payment_code: 'test-pay',
      expires: 300,
    });
    const acceptPromise = waitForMessage(alice, 'ACCEPT');
    await bob.accept(proposal.id);
    await acceptPromise;

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    // Use completely invalid signature
    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Test',
      commitment,
      sig: 'totally-invalid-signature',
    });

    const error = await errorPromise;
    assert.ok(
      error.code === 'VERIFICATION_FAILED' || error.message.includes('signature') || error.message.includes('Invalid'),
      `Expected verification failure, got: ${error.code} ${error.message}`
    );

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects dispute intent signed by wrong identity', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await alice.propose(bob.agentId, {
      task: 'Wrong identity sig test',
      amount: 10,
      currency: 'TEST',
      payment_code: 'test-pay',
      expires: 300,
    });
    const acceptPromise = waitForMessage(alice, 'ACCEPT');
    await bob.accept(proposal.id);
    await acceptPromise;

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');
    const reason = 'Test wrong identity';

    // Sign with bob's key but send as alice
    const sigContent = getDisputeIntentSigningContent(proposal.id, reason, commitment);
    const wrongIdentitySig = bobIdentity.sign(sigContent);

    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason,
      commitment,
      sig: wrongIdentitySig,
    });

    const error = await errorPromise;
    assert.ok(
      error.code === 'VERIFICATION_FAILED' || error.message.includes('signature') || error.message.includes('Invalid'),
      `Expected verification failure (wrong key), got: ${error.code} ${error.message}`
    );

    alice.disconnect();
    bob.disconnect();
  });
});
