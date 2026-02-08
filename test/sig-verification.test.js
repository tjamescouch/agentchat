/**
 * Proposal Signature Verification Integration Tests
 * Tests that the server correctly verifies Ed25519 signatures on all
 * proposal lifecycle message types (PROPOSAL, ACCEPT, REJECT, COMPLETE, DISPUTE)
 * and rejects messages with invalid signatures.
 *
 * Note: Dispute-specific types (DISPUTE_INTENT, DISPUTE_REVEAL, EVIDENCE,
 * ARBITER_ACCEPT, ARBITER_VOTE) are covered in dispute-sig-verification.test.js.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
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
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_PORT = 16690 + Math.floor(Math.random() * 100);
const TEST_SERVER = `ws://localhost:${TEST_PORT}`;

/**
 * Wait for a specific message type from the server via raw WebSocket.
 */
function waitForMessage(client, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.ws?.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeout);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          client.ws?.removeListener('message', handler);
          clearTimeout(timer);
          resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    };
    client.ws?.on('message', handler);
  });
}

describe('Proposal Signature Verification', () => {
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
    server?.stop();
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  // ============ PROPOSAL ============

  it('accepts proposal with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Test sig verification',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      });

      assert.ok(proposal.id, 'Proposal should have been created with valid signature');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects proposal with tampered signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposalData = {
        to: bob.agentId,
        task: 'Tampered sig test',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      };

      const sigContent = getProposalSigningContent(proposalData);
      const validSig = aliceIdentity.sign(sigContent);
      const tamperedSig = validSig.slice(0, -4) + 'XXXX';

      const errorPromise = waitForMessage(alice, 'ERROR');
      alice.sendRaw({
        type: 'PROPOSAL',
        ...proposalData,
        sig: tamperedSig,
      });

      const error = await errorPromise;
      assert.strictEqual(error.code, 'VERIFICATION_FAILED');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  // ============ ACCEPT ============

  it('accepts accept with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
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

      assert.strictEqual(accept.proposal_id, proposal.id);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects accept with wrong signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Wrong sig accept test',
        amount: 5,
        currency: 'TEST',
        expires: 300,
      });

      const wrongSigContent = getAcceptSigningContent('wrong_proposal_id', '', '');
      const wrongSig = bobIdentity.sign(wrongSigContent);

      const errorPromise = waitForMessage(bob, 'ERROR');
      bob.sendRaw({
        type: 'ACCEPT',
        proposal_id: proposal.id,
        sig: wrongSig,
      });

      const error = await errorPromise;
      assert.strictEqual(error.code, 'VERIFICATION_FAILED');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  // ============ REJECT ============

  it('accepts reject with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Reject sig test',
        amount: 5,
        currency: 'TEST',
        expires: 300,
      });

      const rejectPromise = waitForMessage(alice, 'REJECT');
      await bob.reject(proposal.id, 'Not interested');
      const reject = await rejectPromise;

      assert.strictEqual(reject.proposal_id, proposal.id);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects reject with wrong signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Wrong sig reject test',
        amount: 5,
        currency: 'TEST',
        expires: 300,
      });

      const wrongSigContent = getRejectSigningContent('wrong_proposal_id', 'wrong reason');
      const wrongSig = bobIdentity.sign(wrongSigContent);

      const errorPromise = waitForMessage(bob, 'ERROR');
      bob.sendRaw({
        type: 'REJECT',
        proposal_id: proposal.id,
        reason: 'Actual reason',
        sig: wrongSig,
      });

      const error = await errorPromise;
      assert.strictEqual(error.code, 'VERIFICATION_FAILED');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  // ============ COMPLETE ============

  it('accepts complete with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Complete sig test',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      });
      const acceptPromise = waitForMessage(alice, 'ACCEPT');
      await bob.accept(proposal.id);
      await acceptPromise;

      const completePromise = waitForMessage(alice, 'COMPLETE');
      await bob.complete(proposal.id, 'https://example.com/proof');
      const complete = await completePromise;

      assert.strictEqual(complete.proposal_id, proposal.id);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects complete with wrong signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Wrong sig complete test',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      });
      const acceptPromise = waitForMessage(alice, 'ACCEPT');
      await bob.accept(proposal.id);
      await acceptPromise;

      const wrongSigContent = getCompleteSigningContent('wrong_proposal_id', 'wrong proof');
      const wrongSig = bobIdentity.sign(wrongSigContent);

      const errorPromise = waitForMessage(bob, 'ERROR');
      bob.sendRaw({
        type: 'COMPLETE',
        proposal_id: proposal.id,
        proof: 'https://example.com/proof',
        sig: wrongSig,
      });

      const error = await errorPromise;
      assert.strictEqual(error.code, 'VERIFICATION_FAILED');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  // ============ DISPUTE (old-style) ============

  it('accepts dispute with valid signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Dispute sig test',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      });
      const acceptPromise = waitForMessage(alice, 'ACCEPT');
      await bob.accept(proposal.id);
      await acceptPromise;

      const disputePromise = waitForMessage(bob, 'DISPUTE');
      await alice.dispute(proposal.id, 'Work not delivered');
      const dispute = await disputePromise;

      assert.strictEqual(dispute.proposal_id, proposal.id);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects dispute with wrong signature', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const proposal = await alice.propose(bob.agentId, {
        task: 'Wrong sig dispute test',
        amount: 10,
        currency: 'TEST',
        expires: 300,
      });
      const acceptPromise = waitForMessage(alice, 'ACCEPT');
      await bob.accept(proposal.id);
      await acceptPromise;

      const wrongSigContent = getDisputeSigningContent('wrong_proposal_id', 'wrong reason');
      const wrongSig = aliceIdentity.sign(wrongSigContent);

      const errorPromise = waitForMessage(alice, 'ERROR');
      alice.sendRaw({
        type: 'DISPUTE',
        proposal_id: proposal.id,
        reason: 'Work not delivered',
        sig: wrongSig,
      });

      const error = await errorPromise;
      assert.strictEqual(error.code, 'VERIFICATION_FAILED');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });
});
