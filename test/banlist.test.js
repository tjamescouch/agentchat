/**
 * Tests for banlist module and kick/ban handlers
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import WebSocket from 'ws';
import { Banlist } from '../dist/lib/banlist.js';
import { AgentChatServer } from '../dist/lib/server.js';
import { Identity } from '../dist/lib/identity.js';

const TEST_ADMIN_KEY = 'test-admin-key-32chars-minimum!!';

function tempFile() {
  return path.join(os.tmpdir(), `banlist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('Banlist', () => {
  test('check returns not banned for unknown agent', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = bl.check('unknown-agent');
    assert.strictEqual(result.banned, false);
    assert.strictEqual(result.reason, undefined);
  });

  test('ban adds agent to banlist', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = bl.ban('bad-agent', TEST_ADMIN_KEY, 'spamming');
    assert.strictEqual(result.success, true);

    const check = bl.check('bad-agent');
    assert.strictEqual(check.banned, true);
    assert.strictEqual(check.reason, 'spamming');
  });

  test('ban requires valid admin key', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = bl.ban('agent', 'wrong-key', 'reason');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'invalid admin key');
  });

  test('unban removes agent from banlist', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    bl.ban('bad-agent', TEST_ADMIN_KEY, 'spamming');
    assert.strictEqual(bl.check('bad-agent').banned, true);

    const result = bl.unban('bad-agent', TEST_ADMIN_KEY);
    assert.strictEqual(result.success, true);
    assert.strictEqual(bl.check('bad-agent').banned, false);
  });

  test('unban requires valid admin key', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    bl.ban('agent', TEST_ADMIN_KEY);
    const result = bl.unban('agent', 'wrong-key');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'invalid admin key');
  });

  test('unban returns error for non-banned agent', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = bl.unban('not-banned', TEST_ADMIN_KEY);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'agent not banned');
  });

  test('list returns all banned entries', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    bl.ban('agent1', TEST_ADMIN_KEY, 'reason1');
    bl.ban('agent2', TEST_ADMIN_KEY, 'reason2');

    const entries = bl.list();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].agentId, 'agent1');
    assert.strictEqual(entries[0].reason, 'reason1');
    assert.strictEqual(entries[1].agentId, 'agent2');
    assert.strictEqual(entries[1].reason, 'reason2');
  });

  test('persists to file and loads', () => {
    const fp = tempFile();

    const bl1 = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: fp });
    bl1.ban('persist-agent', TEST_ADMIN_KEY, 'persist test');

    const bl2 = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: fp });
    assert.strictEqual(bl2.check('persist-agent').banned, true);
    assert.strictEqual(bl2.list().length, 1);
    assert.strictEqual(bl2.list()[0].reason, 'persist test');

    try { fs.unlinkSync(fp); } catch {}
  });

  test('timing-safe comparison rejects invalid keys', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    assert.strictEqual(bl._validateAdminKey('short'), false);
    assert.strictEqual(bl._validateAdminKey(''), false);
    assert.strictEqual(bl._validateAdminKey(null), false);
    assert.strictEqual(bl._validateAdminKey(undefined), false);
  });

  test('ban with empty reason returns default reason on check', () => {
    const bl = new Banlist({ adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    bl.ban('agent', TEST_ADMIN_KEY);
    const check = bl.check('agent');
    assert.strictEqual(check.banned, true);
    assert.strictEqual(check.reason, 'banned');
  });
});

describe('Banlist Integration', () => {
  let server;
  let tempDir;
  let identity;
  let identityPath;
  const port = 17210;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-banlist-test-'));
    identity = Identity.generate('test-agent');
    identityPath = path.join(tempDir, 'test-agent.json');
    await identity.save(identityPath);

    server = new AgentChatServer({
      port,
      allowlistAdminKey: TEST_ADMIN_KEY,
    });
    server.start();
  });

  after(() => {
    server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('admin can kick an online agent', async () => {
    // Connect a target agent
    const targetWs = new WebSocket(`ws://localhost:${port}`);
    const targetMessages = [];

    await new Promise((resolve, reject) => {
      targetWs.on('open', () => {
        targetWs.send(JSON.stringify({ type: 'IDENTIFY', name: 'target-agent' }));
        resolve();
      });
      targetWs.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    // Wait for WELCOME
    await new Promise((resolve) => {
      targetWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        targetMessages.push(msg);
        if (msg.type === 'WELCOME') resolve();
      });
      setTimeout(resolve, 1000);
    });

    const welcome = targetMessages.find(m => m.type === 'WELCOME');
    assert.ok(welcome, 'Target should get WELCOME');
    const targetId = welcome.agent_id;

    // Connect an admin agent
    const adminWs = new WebSocket(`ws://localhost:${port}`);
    const adminMessages = [];

    await new Promise((resolve, reject) => {
      adminWs.on('open', () => {
        adminWs.send(JSON.stringify({ type: 'IDENTIFY', name: 'admin-agent' }));
        resolve();
      });
      adminWs.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        adminMessages.push(JSON.parse(data.toString()));
        if (adminMessages.find(m => m.type === 'WELCOME')) resolve();
      });
      setTimeout(resolve, 1000);
    });

    // Send ADMIN_KICK
    adminWs.send(JSON.stringify({
      type: 'ADMIN_KICK',
      agent_id: targetId,
      admin_key: TEST_ADMIN_KEY,
      reason: 'test kick',
    }));

    // Wait for ADMIN_RESULT
    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        adminMessages.push(msg);
        if (msg.type === 'ADMIN_RESULT') resolve();
      });
      setTimeout(resolve, 2000);
    });

    const result = adminMessages.find(m => m.type === 'ADMIN_RESULT' && m.action === 'kick');
    assert.ok(result, 'Admin should get ADMIN_RESULT for kick');
    assert.strictEqual(result.success, true);

    // Check target got KICKED
    await new Promise(r => setTimeout(r, 200));
    const kicked = targetMessages.find(m => m.type === 'KICKED');
    assert.ok(kicked, 'Target should receive KICKED message');

    adminWs.close();
  });

  test('admin can ban an agent', async () => {
    const adminWs = new WebSocket(`ws://localhost:${port}`);
    const adminMessages = [];

    await new Promise((resolve, reject) => {
      adminWs.on('open', () => {
        adminWs.send(JSON.stringify({ type: 'IDENTIFY', name: 'admin-agent' }));
        resolve();
      });
      adminWs.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        adminMessages.push(JSON.parse(data.toString()));
        if (adminMessages.find(m => m.type === 'WELCOME')) resolve();
      });
      setTimeout(resolve, 1000);
    });

    // Ban an offline agent
    adminWs.send(JSON.stringify({
      type: 'ADMIN_BAN',
      agent_id: 'offlineagent',
      admin_key: TEST_ADMIN_KEY,
      reason: 'test ban',
    }));

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        adminMessages.push(msg);
        if (msg.type === 'ADMIN_RESULT') resolve();
      });
      setTimeout(resolve, 2000);
    });

    const result = adminMessages.find(m => m.type === 'ADMIN_RESULT' && m.action === 'ban');
    assert.ok(result, 'Admin should get ADMIN_RESULT for ban');
    assert.strictEqual(result.success, true);

    // Verify banlist has the entry
    assert.strictEqual(server.banlist.check('offlineagent').banned, true);

    adminWs.close();
  });

  test('admin can unban an agent', async () => {
    // Ensure agent is banned first
    server.banlist.ban('unbanthis', TEST_ADMIN_KEY, 'temp ban');
    assert.strictEqual(server.banlist.check('unbanthis').banned, true);

    const adminWs = new WebSocket(`ws://localhost:${port}`);
    const adminMessages = [];

    await new Promise((resolve, reject) => {
      adminWs.on('open', () => {
        adminWs.send(JSON.stringify({ type: 'IDENTIFY', name: 'admin-agent' }));
        resolve();
      });
      adminWs.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        adminMessages.push(JSON.parse(data.toString()));
        if (adminMessages.find(m => m.type === 'WELCOME')) resolve();
      });
      setTimeout(resolve, 1000);
    });

    adminWs.send(JSON.stringify({
      type: 'ADMIN_UNBAN',
      agent_id: 'unbanthis',
      admin_key: TEST_ADMIN_KEY,
    }));

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        adminMessages.push(msg);
        if (msg.type === 'ADMIN_RESULT') resolve();
      });
      setTimeout(resolve, 2000);
    });

    const result = adminMessages.find(m => m.type === 'ADMIN_RESULT' && m.action === 'unban');
    assert.ok(result, 'Admin should get ADMIN_RESULT for unban');
    assert.strictEqual(result.success, true);
    assert.strictEqual(server.banlist.check('unbanthis').banned, false);

    adminWs.close();
  });

  test('kick with wrong admin key fails', async () => {
    const adminWs = new WebSocket(`ws://localhost:${port}`);
    const adminMessages = [];

    await new Promise((resolve, reject) => {
      adminWs.on('open', () => {
        adminWs.send(JSON.stringify({ type: 'IDENTIFY', name: 'bad-admin' }));
        resolve();
      });
      adminWs.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        adminMessages.push(JSON.parse(data.toString()));
        if (adminMessages.find(m => m.type === 'WELCOME')) resolve();
      });
      setTimeout(resolve, 1000);
    });

    adminWs.send(JSON.stringify({
      type: 'ADMIN_KICK',
      agent_id: '@someone',
      admin_key: 'wrong-key',
      reason: 'should fail',
    }));

    await new Promise((resolve) => {
      adminWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        adminMessages.push(msg);
        if (msg.type === 'ERROR') resolve();
      });
      setTimeout(resolve, 2000);
    });

    const error = adminMessages.find(m => m.type === 'ERROR' && m.code === 'AUTH_REQUIRED');
    assert.ok(error, 'Should get AUTH_REQUIRED error with wrong admin key');

    adminWs.close();
  });
});
