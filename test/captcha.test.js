/**
 * Reverse Captcha Tests
 *
 * Tests the captcha challenge system:
 * - Challenge generation and validation
 * - Full handshake with captcha enabled/disabled
 * - Pass, fail, timeout, and allowlist bypass flows
 * - Built-in client solver
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { AgentChatServer } from '../dist/lib/server.js';
import { AgentChatClient } from '../dist/lib/client.js';
import { Identity } from '../dist/lib/identity.js';
import { generateChallenge, validateAnswer, loadCaptchaConfig } from '../dist/lib/captcha.js';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============ Unit Tests: Challenge Generation ============

describe('Captcha Challenge Generation', () => {
  it('generates a challenge with question and answer', () => {
    const challenge = generateChallenge('easy');
    assert.ok(challenge.question, 'Challenge should have a question');
    assert.ok(challenge.answer !== undefined, 'Challenge should have an answer');
    assert.ok(typeof challenge.question === 'string');
    assert.ok(typeof challenge.answer === 'string');
  });

  it('generates different challenges on repeated calls', () => {
    const challenges = new Set();
    for (let i = 0; i < 20; i++) {
      challenges.add(generateChallenge('easy').question);
    }
    assert.ok(challenges.size > 1, 'Should generate varied challenges');
  });

  it('supports easy, medium, hard difficulty', () => {
    for (const diff of ['easy', 'medium', 'hard']) {
      const challenge = generateChallenge(diff);
      assert.ok(challenge.question, `${diff} should produce a question`);
      assert.ok(challenge.answer !== undefined, `${diff} should produce an answer`);
    }
  });
});

// ============ Unit Tests: Answer Validation ============

describe('Captcha Answer Validation', () => {
  it('accepts exact match', () => {
    assert.ok(validateAnswer('42', '42'));
  });

  it('accepts case-insensitive match', () => {
    assert.ok(validateAnswer('Cherry', 'cherry'));
    assert.ok(validateAnswer('YES', 'yes'));
  });

  it('accepts trimmed match', () => {
    assert.ok(validateAnswer('  42  ', '42'));
  });

  it('accepts numeric equivalence', () => {
    assert.ok(validateAnswer('10.0', '10'));
    assert.ok(validateAnswer('+10', '10'));
  });

  it('accepts alternates', () => {
    assert.ok(validateAnswer('hash', '#', ['hash', 'hashtag', 'pound']));
    assert.ok(validateAnswer('Hashtag', '#', ['hash', 'hashtag', 'pound']));
  });

  it('rejects wrong answer', () => {
    assert.ok(!validateAnswer('43', '42'));
    assert.ok(!validateAnswer('banana', 'cherry'));
  });

  it('rejects wrong answer with alternates', () => {
    assert.ok(!validateAnswer('dollar', '#', ['hash', 'hashtag', 'pound']));
  });
});

// ============ Unit Tests: Config Loading ============

describe('Captcha Config Loading', () => {
  it('loads defaults when no env vars set', () => {
    const config = loadCaptchaConfig({});
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.timeoutMs, 30000);
    assert.strictEqual(config.maxAttempts, 1);
    assert.strictEqual(config.difficulty, 'easy');
    assert.strictEqual(config.skipAllowlisted, true);
    assert.strictEqual(config.failAction, 'disconnect');
  });

  it('loads from env vars', () => {
    const config = loadCaptchaConfig({
      CAPTCHA_ENABLED: 'true',
      CAPTCHA_TIMEOUT_MS: '5000',
      CAPTCHA_MAX_ATTEMPTS: '3',
      CAPTCHA_DIFFICULTY: 'hard',
      CAPTCHA_SKIP_ALLOWLISTED: 'false',
      CAPTCHA_FAIL_ACTION: 'shadow_lurk',
    });
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.timeoutMs, 5000);
    assert.strictEqual(config.maxAttempts, 3);
    assert.strictEqual(config.difficulty, 'hard');
    assert.strictEqual(config.skipAllowlisted, false);
    assert.strictEqual(config.failAction, 'shadow_lurk');
  });
});

// ============ Integration Tests: Captcha Handshake ============

describe('Captcha Integration', () => {
  let server;
  let testPort;
  let testServer;
  let tempDir;
  let identity1;

  before(async () => {
    testPort = 18200 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;

    // Create server with captcha enabled
    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.captchaConfig = {
      enabled: true,
      timeoutMs: 5000,
      maxAttempts: 1,
      difficulty: 'easy',
      skipAllowlisted: true,
      failAction: 'disconnect',
    };
    server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentchat-captcha-test-'));
    identity1 = Identity.generate('captcha-agent');
    await identity1.save(path.join(tempDir, 'agent1.json'));
  });

  after(() => {
    server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('ephemeral agent receives CAPTCHA_CHALLENGE when captcha enabled', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'captcha-ephemeral'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE');
    assert.ok(captcha.captcha_id, 'Should have captcha_id');
    assert.ok(captcha.captcha_id.startsWith('captcha_'), 'Captcha ID should have captcha_ prefix');
    assert.ok(captcha.question, 'Should have a question');
    assert.ok(captcha.expires_at, 'Should have expires_at');

    // Should NOT have received WELCOME yet
    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(!welcome, 'Should NOT receive WELCOME before solving captcha');

    ws.close();
  });

  it('pubkey agent receives CAPTCHA_CHALLENGE after crypto auth', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'captcha-pubkey',
      pubkey: identity1.pubkey
    }));

    // Wait for CHALLENGE (crypto)
    await new Promise(resolve => setTimeout(resolve, 300));

    const challenge = messages.find(m => m.type === 'CHALLENGE');
    assert.ok(challenge, 'Should receive crypto CHALLENGE first');

    // Complete crypto auth
    const { generateAuthSigningContent } = await import('../dist/lib/protocol.js');
    const timestamp = Date.now();
    const sigContent = generateAuthSigningContent(challenge.nonce, challenge.challenge_id, timestamp);
    const signature = identity1.sign(sigContent);

    ws.send(JSON.stringify({
      type: 'VERIFY_IDENTITY',
      challenge_id: challenge.challenge_id,
      signature,
      timestamp
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE after crypto auth');
    assert.ok(captcha.captcha_id, 'Should have captcha_id');
    assert.ok(captcha.question, 'Should have question');

    // Should NOT have received WELCOME yet
    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(!welcome, 'Should NOT receive WELCOME before solving captcha');

    ws.close();
  });

  it('correct captcha answer results in WELCOME', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'captcha-solver'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE');

    // Find the answer from server state
    const pending = server.pendingCaptchas.get(captcha.captcha_id);
    assert.ok(pending, 'Server should have pending captcha');

    ws.send(JSON.stringify({
      type: 'CAPTCHA_RESPONSE',
      captcha_id: captcha.captcha_id,
      answer: pending.answer
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(welcome, 'Should receive WELCOME after correct answer');
    assert.ok(welcome.agent_id, 'WELCOME should have agent_id');

    ws.close();
  });

  it('wrong captcha answer results in disconnect', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    const closePromise = new Promise(resolve => {
      ws.on('close', (code) => resolve(code));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'captcha-fail'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE');

    ws.send(JSON.stringify({
      type: 'CAPTCHA_RESPONSE',
      captcha_id: captcha.captcha_id,
      answer: 'completely_wrong_answer_12345'
    }));

    const closeCode = await closePromise;
    assert.strictEqual(closeCode, 1000, 'Should close with normal code after failed captcha');

    // Should have received error
    const error = messages.find(m => m.type === 'ERROR' && m.code === 'CAPTCHA_FAILED');
    assert.ok(error, 'Should receive CAPTCHA_FAILED error');

    // Should NOT have received WELCOME
    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(!welcome, 'Should NOT receive WELCOME after failed captcha');
  });

  it('client built-in solver handles captcha automatically', async () => {
    const client = new AgentChatClient({
      server: testServer,
      name: 'auto-solver'
    });

    const welcome = await client.connect();
    assert.ok(welcome.agent_id, 'Should receive agent_id');
    assert.ok(welcome.agent_id.startsWith('@'), 'Agent ID should start with @');

    client.disconnect();
  });
});

// ============ Captcha Disabled Tests ============

describe('Captcha Disabled', () => {
  let server;
  let testPort;
  let testServer;

  before(() => {
    testPort = 18400 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;

    // Create server with captcha disabled (default)
    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.start();
  });

  after(() => {
    server.stop();
  });

  it('ephemeral agent gets WELCOME directly when captcha disabled', async () => {
    const client = new AgentChatClient({
      server: testServer,
      name: 'no-captcha'
    });

    const welcome = await client.connect();
    assert.ok(welcome.agent_id, 'Should receive agent_id directly');

    client.disconnect();
  });
});

// ============ Captcha Timeout Tests ============

describe('Captcha Timeout', { timeout: 15000 }, () => {
  let server;
  let testPort;
  let testServer;

  before(() => {
    testPort = 18500 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;

    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.captchaConfig = {
      enabled: true,
      timeoutMs: 1000, // 1 second for fast test
      maxAttempts: 1,
      difficulty: 'easy',
      skipAllowlisted: true,
      failAction: 'disconnect',
    };
    server.start();
  });

  after(() => {
    server.stop();
  });

  it('captcha expires after timeout', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    const closePromise = new Promise(resolve => {
      ws.on('close', (code) => resolve(code));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'timeout-captcha'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE');

    // Don't respond — wait for timeout
    const closeCode = await closePromise;
    assert.strictEqual(closeCode, 1000, 'Should close after captcha timeout');

    const error = messages.find(m => m.type === 'ERROR' && m.code === 'CAPTCHA_EXPIRED');
    assert.ok(error, 'Should receive CAPTCHA_EXPIRED error');
  });
});

// ============ Shadow Lurk Tests ============

describe('Captcha Shadow Lurk', () => {
  let server;
  let testPort;
  let testServer;

  before(() => {
    testPort = 18600 + Math.floor(Math.random() * 100);
    testServer = `ws://localhost:${testPort}`;

    server = new AgentChatServer({ port: testPort, logMessages: false });
    server.captchaConfig = {
      enabled: true,
      timeoutMs: 5000,
      maxAttempts: 1,
      difficulty: 'easy',
      skipAllowlisted: true,
      failAction: 'shadow_lurk',
    };
    server.start();
  });

  after(() => {
    server.stop();
  });

  it('wrong answer with shadow_lurk puts agent in lurk mode', async () => {
    const ws = new WebSocket(testServer);
    await new Promise(resolve => ws.on('open', resolve));

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({
      type: 'IDENTIFY',
      name: 'lurk-test'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    const captcha = messages.find(m => m.type === 'CAPTCHA_CHALLENGE');
    assert.ok(captcha, 'Should receive CAPTCHA_CHALLENGE');

    ws.send(JSON.stringify({
      type: 'CAPTCHA_RESPONSE',
      captcha_id: captcha.captcha_id,
      answer: 'wrong_answer_xyz'
    }));

    await new Promise(resolve => setTimeout(resolve, 300));

    // Should get WELCOME with lurk mode instead of disconnect
    const welcome = messages.find(m => m.type === 'WELCOME');
    assert.ok(welcome, 'Should receive WELCOME in lurk mode');
    assert.ok(welcome.lurk, 'Should be in lurk mode');

    ws.close();
  });
});
