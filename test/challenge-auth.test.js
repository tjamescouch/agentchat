/**
 * Challenge-Response Authentication Tests
 *
 * Tests the IDENTIFY → CHALLENGE → VERIFY_IDENTITY → WELCOME flow
 * for pubkey agents, and the IDENTIFY → WELCOME flow for ephemeral agents.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import { generateAuthSigningContent } from '../dist/lib/protocol.js';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Challenge-Response Authentication', () => {
  let server;
  let testPort;
  let testServer;
  let tempDir;
  let identity1;
  let identity2;

  before(async () => {
    testPort = 17200 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;
    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.start();

    // Create temp directory for identity files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-challenge-test-'));

    // Create identities for testing
    identity1 = Identity.generate('agent-one');
    await identity1.save(path.join(tempDir, 'agent1.json'));

    identity2 = Identity.generate('agent-two');
    await identity2.save(path.join(tempDir, 'agent2.json'));
  });

  after(() => {
    server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('ephemeral agent gets WELCOME immediately (no challenge)', async () => {
    const client = new AgentChatClient({
      server: testServer,
      name: 'ephemeral-test'
    });

    const welcome = await client.connect();
    assert.ok(welcome.agent_id, 'Should receive agent_id');
    assert.ok(welcome.agent_id.startsWith('@'), 'Agent ID should start with @');
    assert.strictEqual(welcome.name, 'ephemeral-test');

    // Ephemeral agents should NOT be verified
    const agentState = server.agents.get(Array.from(server.agents.keys()).find(
      ws => server.agents.get(ws)?.id === welcome.agent_id.slice(1)
    ));
    assert.strictEqual(agentState?.verified, false, 'Ephemeral agent should not be verified');

    client.disconnect();
  });

  it('pubkey agent receives CHALLENGE then WELCOME after verification', async () => {
    const client = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent1.json')
    });

    const welcome = await client.connect();
    assert.ok(welcome.agent_id, 'Should receive agent_id');
    assert.ok(welcome.agent_id.startsWith('@'), 'Agent ID should start with @');
    assert.strictEqual(welcome.verified, true, 'Welcome should indicate verified status');

    // Check server state
    const agentState = server.agents.get(Array.from(server.agents.keys()).find(
      ws => server.agents.get(ws)?.id === welcome.agent_id.slice(1)
    ));
    assert.strictEqual(agentState?.verified, true, 'Agent should be verified on server');
    assert.ok(agentState?.pubkey, 'Agent should have pubkey');

    client.disconnect();
  });

  it('pubkey agent gets stable ID across reconnections', async () => {
    const client1 = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent1.json')
    });

    const welcome1 = await client1.connect();
    const id1 = welcome1.agent_id;
    client1.disconnect();

    // Wait for disconnect to be processed
    await new Promise(r => setTimeout(r, 100));

    const client2 = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent1.json')
    });

    const welcome2 = await client2.connect();
    const id2 = welcome2.agent_id;

    assert.strictEqual(id1, id2, 'Same identity should get same agent ID');

    client2.disconnect();
  });

  it('challenge-response flow works at raw websocket level', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Send IDENTIFY with pubkey
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'raw-test',
      pubkey: identity1.pubkey
    }));

    // Wait for CHALLENGE
    await new Promise(resolve => setTimeout(resolve, 200));

    const challenge = messages.find(m => m.type === 'CHALLENGE');
    assert.ok(challenge, 'Should receive CHALLENGE');
    assert.ok(challenge.challenge_id, 'Challenge should have challenge_id');
    assert.ok(challenge.nonce, 'Challenge should have nonce');
    assert.ok(challenge.expires_at, 'Challenge should have expires_at');
    assert.ok(challenge.challenge_id.startsWith('chal_'), 'Challenge ID should have chal_ prefix');

    // Sign and respond
    const timestamp = Date.now();
    const signingContent = generateAuthSigningContent(challenge.nonce, challenge.challenge_id, timestamp);
    const signature = identity1.sign(signingContent);

    ws.send(JSON.stringify({
      type: 'VERIFY_IDENTITY',
      challenge_id: challenge.challenge_id,
      signature,
      timestamp
    }));

    // Wait for WELCOME
    await new Promise(resolve => setTimeout(resolve, 200));

    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(welcome, 'Should receive WELCOME after verification');
    assert.ok(welcome.agent_id, 'Welcome should have agent_id');
    assert.strictEqual(welcome.verified, true, 'Welcome should indicate verified');

    ws.close();
  });

  it('rejects invalid signature in VERIFY_IDENTITY', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Send IDENTIFY with pubkey
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'bad-sig-test',
      pubkey: identity2.pubkey
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const challenge = messages.find(m => m.type === 'CHALLENGE');
    assert.ok(challenge, 'Should receive CHALLENGE');

    // Send invalid signature
    ws.send(JSON.stringify({
      type: 'VERIFY_IDENTITY',
      challenge_id: challenge.challenge_id,
      signature: 'totally-invalid-signature',
      timestamp: Date.now()
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const error = messages.find(m => m.type === 'ERROR' && m.code === 'VERIFICATION_FAILED');
    assert.ok(error, 'Should receive VERIFICATION_FAILED error');

    // Should NOT have received WELCOME
    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(!welcome, 'Should NOT receive WELCOME with invalid signature');

    ws.close();
  });

  it('rejects VERIFY_IDENTITY with wrong challenge_id', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Send IDENTIFY
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'wrong-id-test',
      pubkey: identity1.pubkey
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    // Send VERIFY_IDENTITY with non-existent challenge_id
    ws.send(JSON.stringify({
      type: 'VERIFY_IDENTITY',
      challenge_id: 'chal_nonexistent_12345678',
      signature: 'doesntmatter',
      timestamp: Date.now()
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const error = messages.find(m => m.type === 'ERROR' && m.code === 'VERIFICATION_EXPIRED');
    assert.ok(error, 'Should receive VERIFICATION_EXPIRED error');

    ws.close();
  });

  it('rejects duplicate IDENTIFY on same connection', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // First IDENTIFY (ephemeral)
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'dup-test'
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(welcome, 'First IDENTIFY should get WELCOME');

    // Second IDENTIFY should fail
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'dup-test-2'
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const error = messages.find(m => m.type === 'ERROR' && m.message === 'Already identified');
    assert.ok(error, 'Second IDENTIFY should return error');

    ws.close();
  });

  it('rejects duplicate IDENTIFY when challenge is pending', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // First IDENTIFY with pubkey (will get challenge)
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'pending-test',
      pubkey: identity1.pubkey
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const challenge = messages.find(m => m.type === 'CHALLENGE');
    assert.ok(challenge, 'Should get CHALLENGE');

    // Second IDENTIFY while challenge is pending
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'pending-test-2',
      pubkey: identity1.pubkey
    }));

    await new Promise(resolve => setTimeout(resolve, 200));

    const error = messages.find(m => m.type === 'ERROR' && m.message === 'Challenge already pending');
    assert.ok(error, 'Should reject second IDENTIFY while challenge pending');

    ws.close();
  });

  it('verified agent can join channels and send messages', async () => {
    const client = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent1.json')
    });

    const welcome = await client.connect();
    assert.strictEqual(welcome.verified, true);

    // Join channel
    const joined = await client.join('#general');
    assert.strictEqual(joined.channel, '#general');

    // Send message
    await client.send('#general', 'hello from verified agent');

    client.disconnect();
  });

  it('challenge expires and connection is closed', { timeout: 10000 }, async () => {
    // Create server with very short challenge timeout
    const shortPort = testPort + 200 + Math.floor(Math.random() * 100);
    const shortServer = new AgentChatServer({
      port: shortPort,
      logMessages: false,
      verificationTimeoutMs: 500 // 500ms
    });
    shortServer.start();

    const ws = new WebSocket(`ws://localhost:${shortPort}`);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    const closePromise = new Promise(resolve => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    // Send IDENTIFY with pubkey but don't respond to challenge
    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'timeout-test',
      pubkey: identity1.pubkey
    }));

    // Wait for challenge
    await new Promise(resolve => setTimeout(resolve, 200));
    const challenge = messages.find(m => m.type === 'CHALLENGE');
    assert.ok(challenge, 'Should receive CHALLENGE');

    // Wait for timeout + close
    const closeResult = await closePromise;
    assert.strictEqual(closeResult.code, 1000, 'Should close with normal code');

    shortServer.stop();
  });

  it('verified agent takes over existing connection', async () => {
    const client1 = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent2.json')
    });

    await client1.connect();

    const disconnectPromise = new Promise(resolve => {
      client1.on('disconnect', resolve);
    });

    // Second connection with same identity should take over
    const client2 = new AgentChatClient({
      server: testServer,
      identity: path.join(tempDir, 'agent2.json')
    });

    const welcome2 = await client2.connect();
    assert.strictEqual(welcome2.verified, true);

    // First connection should be disconnected
    await disconnectPromise;
    assert.strictEqual(client1.connected, false, 'First connection should be disconnected');

    client2.disconnect();
  });
});
