/**
 * Tests for the Callback Engine
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseCallbacks, CallbackQueue } from '../dist/lib/callback-engine.js';

describe('parseCallbacks', () => {
  it('returns unchanged content when no callbacks present', () => {
    const result = parseCallbacks('hello world', 'agent1');
    assert.equal(result.cleanContent, 'hello world');
    assert.equal(result.callbacks.length, 0);
  });

  it('parses a simple callback marker', () => {
    const result = parseCallbacks('@@cb:5s@@{"csma":"check"}', 'agent1');
    assert.equal(result.callbacks.length, 1);
    assert.equal(result.callbacks[0].from, 'agent1');
    assert.equal(result.callbacks[0].target, '@agent1'); // DM to self
    assert.equal(result.callbacks[0].payload, '{"csma":"check"}');
    assert.ok(result.callbacks[0].fireAt > Date.now());
    assert.ok(result.callbacks[0].fireAt <= Date.now() + 6000);
    assert.equal(result.cleanContent, '');
  });

  it('parses channel-targeted callback', () => {
    const result = parseCallbacks('@@cb:10s#general@@reminder', 'agent1');
    assert.equal(result.callbacks.length, 1);
    assert.equal(result.callbacks[0].target, '#general');
    assert.equal(result.callbacks[0].payload, 'reminder');
  });

  it('strips callback markers from content', () => {
    // Note: @@cb:5s@@ping world — "ping world" is the entire payload
    // since there's no next @@cb: marker to terminate it
    const result = parseCallbacks('hello @@cb:5s@@ping world', 'agent1');
    assert.equal(result.cleanContent, 'hello');
    assert.equal(result.callbacks.length, 1);
    assert.equal(result.callbacks[0].payload, 'ping world');
  });

  it('handles multiple callbacks in one message', () => {
    const result = parseCallbacks('@@cb:3s@@first@@cb:8s@@second', 'agent1');
    assert.equal(result.callbacks.length, 2);
    assert.equal(result.callbacks[0].payload, 'first');
    assert.equal(result.callbacks[1].payload, 'second');
  });

  it('clamps oversized duration to max', () => {
    const result = parseCallbacks('@@cb:999999s@@late', 'agent1');
    assert.equal(result.callbacks.length, 1);
    // Max is 3600s by default
    const maxDelay = 3600 * 1000;
    const actualDelay = result.callbacks[0].fireAt - Date.now();
    assert.ok(actualDelay <= maxDelay + 100); // small tolerance
  });

  it('skips oversized payloads', () => {
    const bigPayload = 'x'.repeat(600); // > 500 byte limit
    const result = parseCallbacks(`@@cb:5s@@${bigPayload}`, 'agent1');
    assert.equal(result.callbacks.length, 0);
  });

  it('handles decimal seconds', () => {
    const result = parseCallbacks('@@cb:2.5s@@half', 'agent1');
    assert.equal(result.callbacks.length, 1);
    const delay = result.callbacks[0].fireAt - Date.now();
    assert.ok(delay > 2000 && delay <= 3000);
  });
});

describe('CallbackQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new CallbackQueue();
  });

  afterEach(() => {
    queue.stop();
  });

  it('enqueues and tracks count', () => {
    const entry = {
      id: 'cb_1',
      fireAt: Date.now() + 5000,
      from: 'agent1',
      target: '@agent1',
      payload: 'test',
      createdAt: Date.now(),
    };
    assert.ok(queue.enqueue(entry));
    assert.equal(queue.size, 1);
    assert.equal(queue.pendingCount('agent1'), 1);
  });

  it('removes agent callbacks on disconnect', () => {
    const entry = {
      id: 'cb_1',
      fireAt: Date.now() + 5000,
      from: 'agent1',
      target: '@agent1',
      payload: 'test',
      createdAt: Date.now(),
    };
    queue.enqueue(entry);
    queue.removeAgent('agent1');
    assert.equal(queue.size, 0);
    assert.equal(queue.pendingCount('agent1'), 0);
  });

  it('fires callbacks when time arrives', (t, done) => {
    const fired = [];
    queue.start(
      (entry) => fired.push(entry),
      () => true
    );

    queue.enqueue({
      id: 'cb_fast',
      fireAt: Date.now() + 100, // fire in 100ms
      from: 'agent1',
      target: '@agent1',
      payload: 'fast',
      createdAt: Date.now(),
    });

    setTimeout(() => {
      assert.equal(fired.length, 1);
      assert.equal(fired[0].payload, 'fast');
      assert.equal(queue.size, 0);
      done();
    }, 2000); // wait for poll tick
  });

  it('respects per-agent limit', () => {
    // Default limit is 50
    for (let i = 0; i < 50; i++) {
      assert.ok(queue.enqueue({
        id: `cb_${i}`,
        fireAt: Date.now() + 60000,
        from: 'agent1',
        target: '@agent1',
        payload: `test${i}`,
        createdAt: Date.now(),
      }));
    }
    // 51st should fail
    assert.ok(!queue.enqueue({
      id: 'cb_over',
      fireAt: Date.now() + 60000,
      from: 'agent1',
      target: '@agent1',
      payload: 'over',
      createdAt: Date.now(),
    }));
  });

  it('fires in correct order (min-heap)', (t, done) => {
    const fired = [];
    queue.start(
      (entry) => fired.push(entry.payload),
      () => true
    );

    const now = Date.now();
    queue.enqueue({ id: 'cb_3', fireAt: now + 300, from: 'a', target: '@a', payload: 'third', createdAt: now });
    queue.enqueue({ id: 'cb_1', fireAt: now + 100, from: 'a', target: '@a', payload: 'first', createdAt: now });
    queue.enqueue({ id: 'cb_2', fireAt: now + 200, from: 'a', target: '@a', payload: 'second', createdAt: now });

    setTimeout(() => {
      assert.deepEqual(fired, ['first', 'second', 'third']);
      done();
    }, 2000);
  });
});
