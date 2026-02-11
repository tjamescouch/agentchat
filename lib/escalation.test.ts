/**
 * Tests for EscalationEngine
 * Progressive moderation: warn -> throttle -> timeout -> kick
 *
 * Run with: npx tsx lib/escalation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EscalationEngine, EscalationLevel } from './escalation.js';

describe('EscalationEngine', () => {
  function makeEngine() {
    return new EscalationEngine({
      warnAfterViolations: 3,
      throttleAfterViolations: 6,
      timeoutAfterViolations: 10,
      kickAfterTimeouts: 3,
      throttleDurationMs: 5000,
      timeoutDurationMs: 60000,
      violationWindowMs: 60000,
      cooldownMs: 300000,
    });
  }

  describe('basic escalation ladder', () => {
    it('allows first few violations silently', () => {
      const engine = makeEngine();
      const r1 = engine.recordViolation('conn1');
      const r2 = engine.recordViolation('conn1');
      assert.equal(r1.type, 'allow');
      assert.equal(r2.type, 'allow');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);
    });

    it('warns after threshold violations', () => {
      const engine = makeEngine();
      engine.recordViolation('conn1');
      engine.recordViolation('conn1');
      const r3 = engine.recordViolation('conn1');
      assert.equal(r3.type, 'warn');
      assert.ok(r3.message.includes('Warning'));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.WARNED);
    });

    it('throttles after more violations', () => {
      const engine = makeEngine();
      for (let i = 0; i < 5; i++) engine.recordViolation('conn1');
      const r6 = engine.recordViolation('conn1');
      assert.equal(r6.type, 'throttle');
      assert.equal(r6.throttleMs, 5000);
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);
    });

    it('times out after continued violations', () => {
      const engine = makeEngine();
      for (let i = 0; i < 9; i++) engine.recordViolation('conn1');
      const r10 = engine.recordViolation('conn1');
      assert.equal(r10.type, 'timeout');
      assert.equal(r10.timeoutMs, 60000);
      assert.ok(r10.message.includes('Timed out'));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.TIMED_OUT);
    });

    it('kicks after repeated timeouts', async () => {
      // Use a very short timeout so we can wait it out
      const engine = new EscalationEngine({
        warnAfterViolations: 3,
        throttleAfterViolations: 6,
        timeoutAfterViolations: 10,
        kickAfterTimeouts: 3,
        throttleDurationMs: 5000,
        timeoutDurationMs: 50, // 50ms timeout
        violationWindowMs: 60000,
        cooldownMs: 300000,
      });

      let lastAction;
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 10; i++) {
          lastAction = engine.recordViolation('conn1');
        }
        // Wait for the timeout to expire before next round
        if (round < 2) {
          await new Promise(r => setTimeout(r, 60));
        }
      }
      assert.equal(lastAction!.type, 'kick');
      const state = engine.getState('conn1');
      assert.equal(state!.level, EscalationLevel.KICKED);
    });
  });

  describe('timeout behavior', () => {
    it('reports timed out when checking during timeout period', () => {
      const engine = makeEngine();
      for (let i = 0; i < 10; i++) engine.recordViolation('conn1');
      assert.equal(engine.isTimedOut('conn1'), true);
    });

    it('returns false for non-existent connections', () => {
      const engine = makeEngine();
      assert.equal(engine.isTimedOut('nonexistent'), false);
    });
  });

  describe('throttle delay', () => {
    it('returns 0 for untracked connections', () => {
      const engine = makeEngine();
      assert.equal(engine.getThrottleDelay('unknown'), 0);
    });

    it('returns throttle duration when throttled', () => {
      const engine = makeEngine();
      for (let i = 0; i < 6; i++) engine.recordViolation('conn1');
      assert.equal(engine.getThrottleDelay('conn1'), 5000);
    });

    it('returns 0 when not yet throttled', () => {
      const engine = makeEngine();
      engine.recordViolation('conn1');
      assert.equal(engine.getThrottleDelay('conn1'), 0);
    });
  });

  describe('isolation between connections', () => {
    it('tracks connections independently', () => {
      const engine = makeEngine();
      for (let i = 0; i < 3; i++) engine.recordViolation('conn1');
      engine.recordViolation('conn2');

      assert.equal(engine.getLevel('conn1'), EscalationLevel.WARNED);
      assert.equal(engine.getLevel('conn2'), EscalationLevel.NONE);
    });
  });

  describe('cleanup and removal', () => {
    it('removes connection state', () => {
      const engine = makeEngine();
      engine.recordViolation('conn1');
      engine.remove('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);
    });

    it('resets connection state', () => {
      const engine = makeEngine();
      for (let i = 0; i < 6; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);
      engine.reset('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);
    });
  });

  describe('stats', () => {
    it('reports correct counts', () => {
      const engine = makeEngine();
      for (let i = 0; i < 3; i++) engine.recordViolation('conn1');
      for (let i = 0; i < 6; i++) engine.recordViolation('conn2');
      for (let i = 0; i < 10; i++) engine.recordViolation('conn3');

      const stats = engine.stats();
      assert.equal(stats.tracked, 3);
      assert.equal(stats.warned, 1);
      assert.equal(stats.throttled, 1);
      assert.equal(stats.timedOut, 1);
    });
  });

  describe('logging', () => {
    it('calls logger on escalation events', () => {
      const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
      const engine = new EscalationEngine(
        { warnAfterViolations: 2 },
        (event, data) => logs.push({ event, data }),
      );

      engine.recordViolation('conn1');
      engine.recordViolation('conn1');

      assert.equal(logs.length, 1);
      assert.equal(logs[0].event, 'escalation_warn');
    });
  });

  describe('gradual decay', () => {
    it('decays one level per cooldown period', async () => {
      // Use very short cooldown so we can actually wait it out
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        timeoutAfterViolations: 6,
        kickAfterTimeouts: 3,
        throttleDurationMs: 5000,
        timeoutDurationMs: 30,  // very short so timeout expires quickly
        violationWindowMs: 60000,
        cooldownMs: 50,  // 50ms cooldown
      });

      // Escalate to THROTTLED
      for (let i = 0; i < 4; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);

      // Wait one cooldown period — should decay to WARNED
      await new Promise(r => setTimeout(r, 60));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.WARNED);

      // Wait another cooldown period — should decay to NONE
      await new Promise(r => setTimeout(r, 60));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);
    });

    it('decays multiple levels when enough time passes', async () => {
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        timeoutAfterViolations: 6,
        kickAfterTimeouts: 3,
        throttleDurationMs: 5000,
        timeoutDurationMs: 30,
        violationWindowMs: 60000,
        cooldownMs: 50,
      });

      // Escalate to THROTTLED (level 2)
      for (let i = 0; i < 4; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);

      // Wait 2 cooldown periods — should decay straight to NONE
      await new Promise(r => setTimeout(r, 120));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);
    });

    it('does not decay during active violations', () => {
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        cooldownMs: 50,
      });

      // Rapid violations — no time for decay
      for (let i = 0; i < 4; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);
    });

    it('re-escalates after partial decay', async () => {
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        cooldownMs: 50,
        violationWindowMs: 200,
      });

      // Escalate to THROTTLED
      for (let i = 0; i < 4; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);

      // Wait for decay to WARNED
      await new Promise(r => setTimeout(r, 60));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.WARNED);

      // New violations should re-escalate
      for (let i = 0; i < 4; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.THROTTLED);
    });

    it('timeoutCount survives level decay (patient attacker defense)', async () => {
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        timeoutAfterViolations: 6,
        kickAfterTimeouts: 2,
        throttleDurationMs: 5000,
        timeoutDurationMs: 30,   // very short timeout
        violationWindowMs: 200,
        cooldownMs: 50,          // fast decay
        timeoutMemoryMs: 500,    // timeout history lasts 500ms (much longer than cooldown)
      });

      // Round 1: escalate to timeout
      for (let i = 0; i < 6; i++) engine.recordViolation('conn1');
      assert.equal(engine.getLevel('conn1'), EscalationLevel.TIMED_OUT);
      const state1 = engine.getState('conn1');
      assert.equal(state1!.timeoutCount, 1);

      // Wait for timeout to expire + full level decay to NONE
      // cooldown=50ms, 3 levels (TIMED_OUT→THROTTLED→WARNED→NONE) = 150ms
      await new Promise(r => setTimeout(r, 200));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);

      // timeoutCount should STILL be 1 (timeoutMemoryMs=500 hasn't elapsed)
      const state2 = engine.getState('conn1');
      assert.equal(state2!.timeoutCount, 1);

      // Round 2: re-spam. One more timeout should trigger kick (2/2)
      for (let i = 0; i < 6; i++) engine.recordViolation('conn1');
      const state3 = engine.getState('conn1');
      assert.equal(state3!.level, EscalationLevel.KICKED);
    });

    it('timeoutCount resets after timeoutMemoryMs expires', async () => {
      const engine = new EscalationEngine({
        warnAfterViolations: 2,
        throttleAfterViolations: 4,
        timeoutAfterViolations: 6,
        kickAfterTimeouts: 2,
        throttleDurationMs: 5000,
        timeoutDurationMs: 30,
        violationWindowMs: 200,
        cooldownMs: 50,
        timeoutMemoryMs: 100,   // short memory for testing
      });

      // Escalate to timeout
      for (let i = 0; i < 6; i++) engine.recordViolation('conn1');
      assert.equal(engine.getState('conn1')!.timeoutCount, 1);

      // Wait for full decay AND timeout memory expiry
      await new Promise(r => setTimeout(r, 200));
      assert.equal(engine.getLevel('conn1'), EscalationLevel.NONE);

      // timeoutCount should now be 0 (memory expired)
      assert.equal(engine.getState('conn1')!.timeoutCount, 0);
    });
  });

  describe('identity invariants', () => {
    it('persistent identity preserves escalation across reconnections', () => {
      const engine = makeEngine();

      // Agent with persistent ID escalates to warned
      const persistentId = 'ed25519:abc123def456';
      for (let i = 0; i < 3; i++) engine.recordViolation(persistentId);
      assert.equal(engine.getLevel(persistentId), EscalationLevel.WARNED);

      // Simulate disconnect (don't remove state — this is intentional)
      // Reconnect with same persistent ID
      // State should still be warned
      assert.equal(engine.getLevel(persistentId), EscalationLevel.WARNED);

      // Further violations continue from existing state
      for (let i = 0; i < 3; i++) engine.recordViolation(persistentId);
      assert.equal(engine.getLevel(persistentId), EscalationLevel.THROTTLED);
    });

    it('ephemeral agents get fresh state with new IDs', () => {
      const engine = makeEngine();

      // Ephemeral agent escalates
      const ephemeralId1 = 'anon_abc123';
      for (let i = 0; i < 3; i++) engine.recordViolation(ephemeralId1);
      assert.equal(engine.getLevel(ephemeralId1), EscalationLevel.WARNED);

      // Ephemeral agent disconnects and reconnects with new random ID
      const ephemeralId2 = 'anon_xyz789';
      // New ID has no state — starts fresh
      assert.equal(engine.getLevel(ephemeralId2), EscalationLevel.NONE);
      const result = engine.recordViolation(ephemeralId2);
      assert.equal(result.type, 'allow'); // first violation, no escalation
    });

    it('old ephemeral state does not leak to new connections', () => {
      const engine = makeEngine();

      // Escalate an ephemeral agent to throttled
      const oldId = 'anon_old';
      for (let i = 0; i < 6; i++) engine.recordViolation(oldId);
      assert.equal(engine.getLevel(oldId), EscalationLevel.THROTTLED);

      // A completely different ephemeral agent should not be affected
      const newId = 'anon_new';
      assert.equal(engine.getLevel(newId), EscalationLevel.NONE);
      assert.equal(engine.getThrottleDelay(newId), 0);
      assert.equal(engine.isTimedOut(newId), false);
    });
  });

  describe('default options', () => {
    it('works with default configuration', () => {
      const engine = new EscalationEngine();
      const result = engine.recordViolation('conn1');
      assert.equal(result.type, 'allow');
    });
  });
});
