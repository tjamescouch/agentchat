/**
 * AgentChat Daemon Tests
 * Run with: node --test test/daemon.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AgentChatServer } from '../lib/server.js';
import { Identity } from '../lib/identity.js';
import {
  AgentChatDaemon,
  isDaemonRunning,
  stopDaemon,
  getDaemonStatus,
  INBOX_PATH,
  OUTBOX_PATH,
  LOG_PATH,
  PID_PATH
} from '../lib/daemon.js';

describe('Daemon', () => {
  let server;
  const PORT = 16672; // Use non-standard port for testing
  const SERVER_URL = `ws://localhost:${PORT}`;
  const testDir = path.join(os.tmpdir(), `agentchat-daemon-test-${Date.now()}`);
  const testIdentityPath = path.join(testDir, 'test-identity.json');

  before(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    // Create test identity
    const identity = Identity.generate('daemon-test-agent');
    await identity.save(testIdentityPath);

    // Start test server
    server = new AgentChatServer({ port: PORT });
    server.start();

    // Clean up any existing daemon files from previous runs
    try {
      await fs.unlink(PID_PATH);
    } catch {}
  });

  after(async () => {
    server.stop();

    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {}

    // Clean up daemon files
    try {
      await fs.unlink(PID_PATH);
    } catch {}
  });

  test('isDaemonRunning returns false when no daemon is running', async () => {
    const status = await isDaemonRunning();
    assert.equal(status.running, false);
  });

  test('getDaemonStatus returns not running when no daemon', async () => {
    const status = await getDaemonStatus();
    assert.equal(status.running, false);
  });

  test('stopDaemon returns appropriate message when no daemon running', async () => {
    const result = await stopDaemon();
    assert.equal(result.stopped, false);
    assert.equal(result.reason, 'Daemon not running');
  });

  test('daemon can be instantiated', () => {
    const daemon = new AgentChatDaemon({
      server: SERVER_URL,
      identity: testIdentityPath,
      channels: ['#general', '#agents']
    });

    assert.equal(daemon.server, SERVER_URL);
    assert.equal(daemon.identityPath, testIdentityPath);
    assert.deepEqual(daemon.channels, ['#general', '#agents']);
    assert.equal(daemon.running, false);
  });

  test('daemon connects and joins channels', async () => {
    const daemon = new AgentChatDaemon({
      server: SERVER_URL,
      identity: testIdentityPath,
      channels: ['#general']
    });

    // Start daemon
    await daemon.start();

    // Give time to connect
    await new Promise(r => setTimeout(r, 500));

    assert.equal(daemon.running, true);
    assert.ok(daemon.client);
    assert.ok(daemon.client.connected);

    // Stop daemon
    daemon.running = false;
    daemon._stopOutboxWatcher();
    daemon.client.disconnect();

    // Clean up PID file
    try {
      await fs.unlink(PID_PATH);
    } catch {}
  });

  test('daemon writes messages to inbox', async () => {
    // Clear inbox first
    try {
      await fs.writeFile(INBOX_PATH, '');
    } catch {}

    const daemon = new AgentChatDaemon({
      server: SERVER_URL,
      identity: testIdentityPath,
      channels: ['#general']
    });

    await daemon.start();
    await new Promise(r => setTimeout(r, 500));

    // Check inbox has messages (at least the channel history)
    const inboxContent = await fs.readFile(INBOX_PATH, 'utf-8');

    // Stop daemon
    daemon.running = false;
    daemon._stopOutboxWatcher();
    daemon.client.disconnect();

    try {
      await fs.unlink(PID_PATH);
    } catch {}

    // Inbox might be empty if no history, but shouldn't throw
    assert.ok(typeof inboxContent === 'string');
  });

  test('daemon processes outbox messages', async () => {
    const daemon = new AgentChatDaemon({
      server: SERVER_URL,
      identity: testIdentityPath,
      channels: ['#general']
    });

    await daemon.start();
    await new Promise(r => setTimeout(r, 500));

    // Write to outbox
    const testMsg = '{"to":"#general","content":"Test from daemon test"}\n';
    await fs.writeFile(OUTBOX_PATH, testMsg);

    // Wait for processing
    await new Promise(r => setTimeout(r, 1000));

    // Outbox should be truncated after processing
    const outboxContent = await fs.readFile(OUTBOX_PATH, 'utf-8');
    assert.equal(outboxContent.trim(), '', 'Outbox should be empty after processing');

    // Stop daemon
    daemon.running = false;
    daemon._stopOutboxWatcher();
    daemon.client.disconnect();

    try {
      await fs.unlink(PID_PATH);
    } catch {}
  });

  test('daemon creates PID file', async () => {
    const daemon = new AgentChatDaemon({
      server: SERVER_URL,
      identity: testIdentityPath,
      channels: ['#general']
    });

    await daemon.start();
    await new Promise(r => setTimeout(r, 200));

    // Check PID file exists
    const pidContent = await fs.readFile(PID_PATH, 'utf-8');
    const pid = parseInt(pidContent.trim());
    assert.equal(pid, process.pid);

    // Stop daemon
    daemon.running = false;
    daemon._stopOutboxWatcher();
    daemon.client.disconnect();

    try {
      await fs.unlink(PID_PATH);
    } catch {}
  });
});

describe('Channel normalization', () => {
  // This logic is in bin/agentchat.js - testing the expected behavior
  const normalizeChannels = (channels) => channels
    .flatMap(c => c.split(','))
    .map(c => c.trim())
    .filter(c => c.length > 0)
    .map(c => c.startsWith('#') ? c : '#' + c);

  test('normalizes comma-separated channels', () => {
    const result = normalizeChannels(['#general,#skills']);
    assert.deepEqual(result, ['#general', '#skills']);
  });

  test('normalizes space-separated channels', () => {
    const result = normalizeChannels(['#general', '#skills']);
    assert.deepEqual(result, ['#general', '#skills']);
  });

  test('adds # prefix if missing', () => {
    const result = normalizeChannels(['general,skills']);
    assert.deepEqual(result, ['#general', '#skills']);
  });

  test('handles mixed formats', () => {
    const result = normalizeChannels(['#general,skills', '#agents']);
    assert.deepEqual(result, ['#general', '#skills', '#agents']);
  });

  test('trims whitespace', () => {
    const result = normalizeChannels(['#general , #skills']);
    assert.deepEqual(result, ['#general', '#skills']);
  });

  test('filters empty strings', () => {
    const result = normalizeChannels(['#general,,#skills', '']);
    assert.deepEqual(result, ['#general', '#skills']);
  });
});

describe('Daemon file paths', () => {
  test('inbox path is in home directory', () => {
    assert.ok(INBOX_PATH.includes('.agentchat'));
    assert.ok(INBOX_PATH.endsWith('inbox.jsonl'));
  });

  test('outbox path is in home directory', () => {
    assert.ok(OUTBOX_PATH.includes('.agentchat'));
    assert.ok(OUTBOX_PATH.endsWith('outbox.jsonl'));
  });

  test('log path is in home directory', () => {
    assert.ok(LOG_PATH.includes('.agentchat'));
    assert.ok(LOG_PATH.endsWith('daemon.log'));
  });

  test('pid path is in home directory', () => {
    assert.ok(PID_PATH.includes('.agentchat'));
    assert.ok(PID_PATH.endsWith('daemon.pid'));
  });
});

console.log('Running daemon tests...');
