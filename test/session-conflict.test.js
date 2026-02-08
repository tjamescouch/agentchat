/**
 * Session Conflict Detection Tests
 * Tests that displaced connections receive SESSION_DISPLACED before being closed
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_PORT = 16685;
const TEST_SERVER = `ws://localhost:${TEST_PORT}`;

/**
 * Helper: wait for a specific message type on the raw websocket
 */
function waitForRawType(client, type, timeout = 5000) {
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

describe('Session Conflict Detection', () => {
  let server;
  let tmpDir;
  let aliceIdentityPath;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `agentchat-session-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    aliceIdentityPath = path.join(tmpDir, 'alice.json');
    const alice = Identity.generate('alice');
    await alice.save(aliceIdentityPath);

    server = new AgentChatServer({ port: TEST_PORT, logMessages: false });
    server.start();
  });

  after(async () => {
    server.stop();
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  });

  it('sends SESSION_DISPLACED to old connection when identity is taken over', async () => {
    // Connect first instance
    const alice1 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice1.on('error', () => {}); // prevent ERR_UNHANDLED_ERROR
    await alice1.connect();

    // Listen for SESSION_DISPLACED on first connection
    const displacedPromise = waitForRawType(alice1, 'SESSION_DISPLACED');

    // Connect second instance with same identity — should displace first
    const alice2 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice2.on('error', () => {});
    await alice2.connect();

    const displaced = await displacedPromise;
    assert.equal(displaced.type, 'SESSION_DISPLACED');
    assert.ok(displaced.reason, 'Should include a reason');
    assert.ok(displaced.reason.includes('Another connection'), `Reason should explain the conflict: ${displaced.reason}`);

    alice2.disconnect();
  });

  it('includes new_ip field in SESSION_DISPLACED message', async () => {
    const alice1 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice1.on('error', () => {});
    await alice1.connect();

    const displacedPromise = waitForRawType(alice1, 'SESSION_DISPLACED');

    const alice2 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice2.on('error', () => {});
    await alice2.connect();

    const displaced = await displacedPromise;
    assert.ok(displaced.new_ip !== undefined, 'Should include new_ip field');

    alice2.disconnect();
  });

  it('closes the old connection after sending SESSION_DISPLACED', async () => {
    const alice1 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice1.on('error', () => {});
    await alice1.connect();

    const disconnectPromise = new Promise((resolve) => {
      alice1.on('disconnect', resolve);
    });

    const alice2 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice2.on('error', () => {});
    await alice2.connect();

    // Old connection should be disconnected
    await disconnectPromise;
    assert.equal(alice1.connected, false);

    // New connection should still be alive
    assert.equal(alice2.connected, true);

    alice2.disconnect();
  });

  it('new connection gets a valid WELCOME after displacing old one', async () => {
    const alice1 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice1.on('error', () => {});
    const welcome1 = await alice1.connect();

    const alice2 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice2.on('error', () => {});
    const welcome2 = await alice2.connect();

    // Both should have gotten the same agent_id (derived from pubkey)
    assert.equal(welcome1.agent_id, welcome2.agent_id);

    alice2.disconnect();
  });

  it('client emits session_displaced event', async () => {
    const alice1 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice1.on('error', () => {});
    await alice1.connect();

    const eventPromise = new Promise((resolve) => {
      alice1.on('session_displaced', resolve);
    });

    const alice2 = new AgentChatClient({ server: TEST_SERVER, identity: aliceIdentityPath });
    alice2.on('error', () => {});
    await alice2.connect();

    const event = await eventPromise;
    assert.equal(event.type, 'SESSION_DISPLACED');
    assert.ok(event.reason);

    alice2.disconnect();
  });

  it('ephemeral agents are not affected by session conflict', async () => {
    // Ephemeral agents get unique IDs, so two ephemeral connections with same name should coexist
    const eph1 = new AgentChatClient({ server: TEST_SERVER, name: 'test-ephemeral' });
    eph1.on('error', () => {});
    const welcome1 = await eph1.connect();

    const eph2 = new AgentChatClient({ server: TEST_SERVER, name: 'test-ephemeral' });
    eph2.on('error', () => {});
    const welcome2 = await eph2.connect();

    // Should get different agent IDs
    assert.notEqual(welcome1.agent_id, welcome2.agent_id);

    // Both should still be connected
    assert.equal(eph1.connected, true);
    assert.equal(eph2.connected, true);

    eph1.disconnect();
    eph2.disconnect();
  });
});
