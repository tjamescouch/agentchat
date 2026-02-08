/**
 * Agentcourt Dispute Integration Tests
 * Tests the full dispute flow through the server via WebSocket
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_PORT = 16680;
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

/**
 * Helper: create an accepted proposal between two clients
 */
async function createAcceptedProposal(alice, bob) {
  const proposal = await alice.propose(bob.agentId, {
    task: 'Test work for dispute',
    amount: 10,
    currency: 'TEST',
    payment_code: 'test-pay',
    expires: 300
  });

  // Bob accepts
  const acceptPromise = waitForMessage(alice, 'ACCEPT');
  await bob.accept(proposal.id);
  await acceptPromise;

  return proposal;
}

describe('Agentcourt Dispute Integration', () => {
  let server;
  let tmpDir;
  let aliceIdentityPath;
  let bobIdentityPath;
  let charlieIdentityPath;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `agentchat-dispute-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    aliceIdentityPath = path.join(tmpDir, 'alice.json');
    bobIdentityPath = path.join(tmpDir, 'bob.json');
    charlieIdentityPath = path.join(tmpDir, 'charlie.json');

    const alice = Identity.generate('alice');
    await alice.save(aliceIdentityPath);
    const bob = Identity.generate('bob');
    await bob.save(bobIdentityPath);
    const charlie = Identity.generate('charlie');
    await charlie.save(charlieIdentityPath);

    server = new AgentChatServer({ port: TEST_PORT, logMessages: false });
    server.start();
  });

  after(async () => {
    server.stop();
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  it('can file a dispute intent and receive ACK', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await createAcceptedProposal(alice, bob);

    // Create commitment
    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    // Listen for DISPUTE_INTENT_ACK
    const ackPromise = waitForMessage(alice, 'DISPUTE_INTENT_ACK');

    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Work not delivered',
      commitment,
      sig: 'test-sig'
    });

    const ack = await ackPromise;
    assert.ok(ack.dispute_id, 'ACK should have dispute_id');
    assert.equal(ack.proposal_id, proposal.id);
    assert.ok(ack.server_nonce, 'ACK should include server_nonce');

    alice.disconnect();
    bob.disconnect();
  });

  it('can reveal nonce after filing intent', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await createAcceptedProposal(alice, bob);

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const ackPromise = waitForMessage(alice, 'DISPUTE_INTENT_ACK');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Work not done',
      commitment,
      sig: 'test-sig'
    });
    const ack = await ackPromise;

    // Now reveal — should get PANEL_FORMED or DISPUTE_FALLBACK (fallback if no arbiters available)
    const responsePromise = Promise.race([
      waitForMessage(alice, 'PANEL_FORMED'),
      waitForMessage(alice, 'DISPUTE_FALLBACK'),
    ]);

    rawSend(alice, {
      type: 'DISPUTE_REVEAL',
      proposal_id: proposal.id,
      nonce,
      sig: 'test-sig'
    });

    const response = await responsePromise;
    assert.ok(
      response.type === 'PANEL_FORMED' || response.type === 'DISPUTE_FALLBACK',
      `Expected PANEL_FORMED or DISPUTE_FALLBACK, got ${response.type}`
    );

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects reveal with wrong nonce', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await createAcceptedProposal(alice, bob);

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const ackPromise = waitForMessage(alice, 'DISPUTE_INTENT_ACK');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Bad work',
      commitment,
      sig: 'test-sig'
    });
    await ackPromise;

    // Send wrong nonce
    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'DISPUTE_REVEAL',
      proposal_id: proposal.id,
      nonce: 'wrong-nonce-value',
      sig: 'test-sig'
    });

    const error = await errorPromise;
    assert.ok(error.message.includes('commitment') || error.message.includes('Nonce'),
      `Expected commitment mismatch error, got: ${error.message}`);

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects dispute on non-accepted proposal', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    // Create proposal but don't accept it
    const proposal = await alice.propose(bob.agentId, {
      task: 'Unaccepted work',
      amount: 5,
      currency: 'TEST',
      payment_code: 'test-pay',
      expires: 300
    });

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Test',
      commitment,
      sig: 'test-sig'
    });

    const error = await errorPromise;
    assert.ok(error.message.includes('accepted'),
      `Expected "accepted" error, got: ${error.message}`);

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects dispute from ephemeral agent (no pubkey)', async () => {
    const ephemeral = new AgentChatClient({ server: TEST_SERVER, name: 'ephemeral-test' });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await ephemeral.connect();
    await bob.connect();

    const nonce = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

    const errorPromise = waitForMessage(ephemeral, 'ERROR');
    rawSend(ephemeral, {
      type: 'DISPUTE_INTENT',
      proposal_id: 'fake_proposal',
      reason: 'Test',
      commitment,
      sig: 'test-sig'
    });

    const error = await errorPromise;
    assert.ok(error.message.includes('persistent') || error.message.includes('Signature'),
      `Expected persistent identity error, got: ${error.message}`);

    ephemeral.disconnect();
    bob.disconnect();
  });

  it('rejects duplicate dispute on same proposal', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });

    await alice.connect();
    await bob.connect();

    const proposal = await createAcceptedProposal(alice, bob);

    const nonce1 = crypto.randomBytes(16).toString('hex');
    const commitment1 = crypto.createHash('sha256').update(nonce1).digest('hex');

    // First dispute — should succeed
    const ackPromise = waitForMessage(alice, 'DISPUTE_INTENT_ACK');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'First dispute',
      commitment: commitment1,
      sig: 'test-sig'
    });
    await ackPromise;

    // Second dispute on same proposal — should fail
    const nonce2 = crypto.randomBytes(16).toString('hex');
    const commitment2 = crypto.createHash('sha256').update(nonce2).digest('hex');

    const errorPromise = waitForMessage(alice, 'ERROR');
    rawSend(alice, {
      type: 'DISPUTE_INTENT',
      proposal_id: proposal.id,
      reason: 'Second dispute',
      commitment: commitment2,
      sig: 'test-sig'
    });

    const error = await errorPromise;
    assert.ok(error.message.includes('already'),
      `Expected "already exists" error, got: ${error.message}`);

    alice.disconnect();
    bob.disconnect();
  });
});
