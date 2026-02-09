/**
 * FILE_CHUNK Integration Tests
 * Tests file chunk relay between agents, size limits, rate limiting,
 * and DM-only restriction.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_PORT = 16695 + Math.floor(Math.random() * 100);
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

describe('FILE_CHUNK', () => {
  let server;
  let tmpDir;
  let aliceIdentityPath;
  let bobIdentityPath;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `agentchat-filechunk-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    aliceIdentityPath = path.join(tmpDir, 'alice.json');
    bobIdentityPath = path.join(tmpDir, 'bob.json');

    const alice = Identity.generate('alice');
    await alice.save(aliceIdentityPath);
    const bob = Identity.generate('bob');
    await bob.save(bobIdentityPath);

    server = new AgentChatServer({ port: TEST_PORT, logMessages: false });
    server.start();
  });

  after(async () => {
    server?.stop();
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  it('relays FILE_CHUNK between two agents', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      const chunkData = JSON.stringify({ _ft: 'chunk', tid: 'test-123', idx: 0, total: 1, data: 'hello world' });

      const chunkPromise = waitForMessage(bob, 'FILE_CHUNK');
      alice.sendFileChunk(bob.agentId, chunkData);
      const received = await chunkPromise;

      assert.strictEqual(received.type, 'FILE_CHUNK');
      assert.strictEqual(received.content, chunkData);
      assert.strictEqual(received.to, bob.agentId);
      assert.ok(received.from);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('supports content larger than 4096 chars (MSG limit)', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      // Create a 100KB payload (well over 4096 char MSG limit)
      const largeData = 'x'.repeat(100 * 1024);
      const chunkData = JSON.stringify({ _ft: 'chunk', tid: 'big-1', idx: 0, total: 1, data: largeData });

      const chunkPromise = waitForMessage(bob, 'FILE_CHUNK');
      alice.sendFileChunk(bob.agentId, chunkData);
      const received = await chunkPromise;

      assert.strictEqual(received.type, 'FILE_CHUNK');
      const parsed = JSON.parse(received.content);
      assert.strictEqual(parsed.data.length, 100 * 1024);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('rejects FILE_CHUNK to channel target', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    try {
      await alice.connect();
      await alice.join('#general');

      const errorPromise = waitForMessage(alice, 'ERROR');
      alice.sendRaw({ type: 'FILE_CHUNK', to: '#general', content: 'test' });
      const error = await errorPromise;

      assert.strictEqual(error.code, 'INVALID_MSG');
      assert.ok(error.message.includes('DM targets'));
    } finally {
      alice.disconnect();
    }
  });

  it('rejects FILE_CHUNK to nonexistent agent', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    try {
      await alice.connect();

      const errorPromise = waitForMessage(alice, 'ERROR');
      alice.sendFileChunk('@nonexistent1234', 'test data');
      const error = await errorPromise;

      assert.strictEqual(error.code, 'AGENT_NOT_FOUND');
    } finally {
      alice.disconnect();
    }
  });

  it('rejects FILE_CHUNK larger than 2MB (WS closes connection)', async () => {
    const alice = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    const bob = new AgentChatClient({ server: TEST_SERVER, identity: bobIdentityPath });
    try {
      await alice.connect();
      await bob.connect();

      // 2MB + 1 byte exceeds maxPayload — WS library closes the connection
      const hugeContent = 'x'.repeat(2 * 1024 * 1024 + 1);

      const closePromise = new Promise((resolve) => {
        alice.ws?.on('close', () => resolve(true));
      });
      alice.sendFileChunk(bob.agentId, hugeContent);
      const closed = await closePromise;

      assert.ok(closed, 'Connection should be closed when payload exceeds maxPayload');
    } finally {
      try { alice.disconnect(); } catch { /* may already be closed */ }
      bob.disconnect();
    }
  });
});
