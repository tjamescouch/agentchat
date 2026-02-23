/**
 * Tests for allowlist module and admin handlers
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import WebSocket from 'ws';
import { Allowlist } from '../dist/lib/allowlist.js';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';

const TEST_ADMIN_KEY = 'test-admin-key-32chars-minimum!!';

// Each test gets its own temp file to avoid cross-contamination
function tempFile() {
  return path.join(os.tmpdir(), `allowlist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('Allowlist', () => {
  test('disabled by default - allows everything', () => {
    const al = new Allowlist({ filePath: tempFile() });
    assert.deepStrictEqual(al.check('any-pubkey'), { allowed: true, reason: 'allowlist disabled' });
    assert.deepStrictEqual(al.check(null), { allowed: true, reason: 'allowlist disabled' });
  });

  test('enabled non-strict - tracks unknown pubkeys (allowed)', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    const result = al.check(identity.pubkey);
    assert.strictEqual(result.allowed, true);
    assert.match(result.reason, /tracked/);
  });

  test('enabled strict - rejects unknown pubkeys', () => {
    const al = new Allowlist({ enabled: true, strict: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    const result = al.check(identity.pubkey);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'pubkey not in allowlist');
  });

  test('enabled - allows approved pubkeys', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    const approveResult = al.approve(identity.pubkey, TEST_ADMIN_KEY, 'test agent');
    assert.strictEqual(approveResult.success, true);

    const checkResult = al.check(identity.pubkey);
    assert.strictEqual(checkResult.allowed, true);
    assert.strictEqual(checkResult.reason, 'pubkey approved');
  });

  test('enabled non-strict - allows ephemeral connections', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = al.check(null);
    assert.strictEqual(result.allowed, true);
    assert.match(result.reason, /ephemeral/);
  });

  test('enabled strict - blocks ephemeral connections', () => {
    const al = new Allowlist({ enabled: true, strict: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const result = al.check(null);
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /strict/);
  });

  test('approve requires valid admin key', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    const result = al.approve(identity.pubkey, 'wrong-key');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'invalid admin key');
  });

  test('revoke removes entry (strict mode verifies rejection)', () => {
    const al = new Allowlist({ enabled: true, strict: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    al.approve(identity.pubkey, TEST_ADMIN_KEY);
    assert.strictEqual(al.check(identity.pubkey).allowed, true);

    const revokeResult = al.revoke(identity.pubkey, TEST_ADMIN_KEY);
    assert.strictEqual(revokeResult.success, true);
    assert.strictEqual(al.check(identity.pubkey).allowed, false);
  });

  test('revoke by agentId (strict mode verifies rejection)', () => {
    const al = new Allowlist({ enabled: true, strict: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    const { agentId } = al.approve(identity.pubkey, TEST_ADMIN_KEY);

    const revokeResult = al.revoke(agentId, TEST_ADMIN_KEY);
    assert.strictEqual(revokeResult.success, true);
    assert.strictEqual(al.check(identity.pubkey).allowed, false);
  });

  test('revoke requires valid admin key', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const identity = Identity.generate('test');
    al.approve(identity.pubkey, TEST_ADMIN_KEY);

    const result = al.revoke(identity.pubkey, 'wrong-key');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'invalid admin key');
  });

  test('list returns all entries', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    const id1 = Identity.generate('one');
    const id2 = Identity.generate('two');
    al.approve(id1.pubkey, TEST_ADMIN_KEY, 'agent one');
    al.approve(id2.pubkey, TEST_ADMIN_KEY, 'agent two');

    const entries = al.list();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].note, 'agent one');
    assert.strictEqual(entries[1].note, 'agent two');
  });

  test('persists to file and loads', () => {
    const fp = tempFile();
    const identity = Identity.generate('test');

    const al1 = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: fp });
    al1.approve(identity.pubkey, TEST_ADMIN_KEY, 'persist test');

    const al2 = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: fp });
    assert.strictEqual(al2.check(identity.pubkey).allowed, true);
    assert.strictEqual(al2.list().length, 1);
    assert.strictEqual(al2.list()[0].note, 'persist test');

    try { fs.unlinkSync(fp); } catch {}
  });

  test('timing-safe comparison rejects mismatched lengths', () => {
    const al = new Allowlist({ enabled: true, adminKey: TEST_ADMIN_KEY, filePath: tempFile() });
    assert.strictEqual(al._validateAdminKey('short'), false);
    assert.strictEqual(al._validateAdminKey(''), false);
    assert.strictEqual(al._validateAdminKey(null), false);
    assert.strictEqual(al._validateAdminKey(undefined), false);
  });
});

describe('Allowlist Integration (non-strict)', () => {
  let server;
  let tempDir;
  let identityPath;
  let identity;
  const port = 17200;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-allowlist-test-'));
    identity = Identity.generate('test-agent');
    identityPath = path.join(tempDir, 'test-agent.json');
    await identity.save(identityPath);

    server = new AgentChatServer({
      port,
      allowlistEnabled: true,
      allowlistStrict: false,
      allowlistAdminKey: TEST_ADMIN_KEY,
      allowlistFilePath: path.join(tempDir, 'allowlist.json'),
    });
    server.start();
  });

  after(() => {
    server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('tracks unapproved pubkey (allows in non-strict)', async () => {
    // In non-strict mode, unapproved pubkeys are allowed but tracked
    const client = new AgentChatClient({
      server: `ws://localhost:${port}`,
      identity: identityPath,
    });
    let welcomed = false;
    client.on('welcome', () => { welcomed = true; });

    await client.connect();
    await new Promise(r => setTimeout(r, 500));

    assert.strictEqual(welcomed, true, 'Unapproved pubkey should be allowed in non-strict mode');
    client.disconnect();
  });

  test('allows approved pubkey', async () => {
    server.allowlist.approve(identity.pubkey, TEST_ADMIN_KEY, 'test');

    const client = new AgentChatClient({
      server: `ws://localhost:${port}`,
      identity: identityPath,
    });
    let welcomed = false;
    client.on('welcome', () => { welcomed = true; });

    await client.connect();
    await new Promise(r => setTimeout(r, 500));

    assert.strictEqual(welcomed, true, 'Should receive welcome after approval');
    server.allowlist.revoke(identity.pubkey, TEST_ADMIN_KEY);
    client.disconnect();
  });

});

describe('Allowlist Strict Mode', () => {
  let server;
  let tempDir;
  let identityPath;
  let identity;
  const port = 17201;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-strict-test-'));
    identity = Identity.generate('test-agent');
    identityPath = path.join(tempDir, 'test-agent.json');
    await identity.save(identityPath);

    server = new AgentChatServer({
      port,
      allowlistEnabled: true,
      allowlistStrict: true,
      allowlistAdminKey: TEST_ADMIN_KEY,
      allowlistFilePath: path.join(tempDir, 'allowlist.json'),
    });
    server.start();
  });

  after(() => {
    server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('rejects unapproved pubkey in strict mode', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages = [];

    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'IDENTIFY',
          name: 'test-agent',
          pubkey: identity.pubkey,
        }));
        resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        resolve();
      });
      setTimeout(resolve, 1000);
    });

    ws.close();
    const notAllowed = messages.find(m => m.code === 'NOT_ALLOWED');
    assert.ok(notAllowed, `Should receive NOT_ALLOWED for unapproved pubkey in strict mode, got: ${JSON.stringify(messages)}`);
  });

  test('rejects ephemeral in strict mode', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages = [];

    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'IDENTIFY', name: 'ephemeral-agent' }));
        resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });

    await new Promise((resolve) => {
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        resolve();
      });
      setTimeout(resolve, 1000);
    });

    ws.close();
    const notAllowed = messages.find(m => m.code === 'NOT_ALLOWED');
    assert.ok(notAllowed, `Should receive NOT_ALLOWED for ephemeral in strict mode, got: ${JSON.stringify(messages)}`);
  });

  test('allows approved pubkey in strict mode', async () => {
    server.allowlist.approve(identity.pubkey, TEST_ADMIN_KEY, 'strict test');

    const client = new AgentChatClient({
      server: `ws://localhost:${port}`,
      identity: identityPath,
    });
    let welcomed = false;
    client.on('welcome', () => { welcomed = true; });

    await client.connect();
    await new Promise(r => setTimeout(r, 500));

    assert.strictEqual(welcomed, true, 'Approved pubkey should be welcomed in strict mode');
    server.allowlist.revoke(identity.pubkey, TEST_ADMIN_KEY);
    client.disconnect();
  });
});
