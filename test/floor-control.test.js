import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FloorControl } from '../dist/lib/floor-control.js';

describe('FloorControl', () => {
  let fc;

  beforeEach(() => {
    fc = new FloorControl();
    fc.start();
  });

  afterEach(() => {
    fc.stop();
  });

  it('grants first claim on a msg_id', () => {
    const result = fc.claim('agent-a', '#general', 'msg-1', 1000);
    assert.equal(result.granted, true);
    assert.equal(result.holder, undefined);
  });

  it('rejects later claim with higher started_at', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const result = fc.claim('agent-b', '#general', 'msg-1', 1500);
    assert.equal(result.granted, false);
    assert.equal(result.holder.agentId, 'agent-a');
  });

  it('displaces earlier holder when new claim has lower started_at', () => {
    fc.claim('agent-a', '#general', 'msg-1', 2000);
    const result = fc.claim('agent-b', '#general', 'msg-1', 1000);
    assert.equal(result.granted, true);
    // holder contains the displaced agent's claim
    assert.equal(result.holder.agentId, 'agent-a');
  });

  it('uses lexicographic tiebreaker when started_at is equal', () => {
    fc.claim('agent-b', '#general', 'msg-1', 1000);
    const result = fc.claim('agent-a', '#general', 'msg-1', 1000);
    // agent-a < agent-b lexicographically, so agent-a wins
    assert.equal(result.granted, true);
    assert.equal(result.holder.agentId, 'agent-b');
  });

  it('same agent re-claiming returns denied (already holds)', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const result = fc.claim('agent-a', '#general', 'msg-1', 1000);
    // Same timestamp, same agent — falls through to deny since agentId === agentId
    assert.equal(result.granted, false);
    assert.equal(result.holder.agentId, 'agent-a');
  });

  it('tracks claims across different channels independently', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const result = fc.claim('agent-b', '#random', 'msg-1', 1500);
    // Different channel, so this is a separate claim
    assert.equal(result.granted, true);
  });

  it('tracks claims across different msg_ids independently', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const result = fc.claim('agent-b', '#general', 'msg-2', 1500);
    assert.equal(result.granted, true);
  });

  it('release removes agent claims from specific channel', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    fc.claim('agent-a', '#random', 'msg-2', 1000);
    fc.release('agent-a', '#general');

    // Now agent-b should be able to claim msg-1 on #general
    const result = fc.claim('agent-b', '#general', 'msg-1', 2000);
    assert.equal(result.granted, true);
    assert.equal(result.holder, undefined); // no displaced — slot was empty
  });

  it('release without channel removes all agent claims', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    fc.claim('agent-a', '#random', 'msg-2', 1000);
    fc.release('agent-a');

    // Both should be available now
    const r1 = fc.claim('agent-b', '#general', 'msg-1', 2000);
    const r2 = fc.claim('agent-c', '#random', 'msg-2', 2000);
    assert.equal(r1.granted, true);
    assert.equal(r2.granted, true);
  });

  it('holdsFloor returns the claim when agent has one', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const claim = fc.holdsFloor('agent-a', '#general');
    assert.ok(claim);
    assert.equal(claim.agentId, 'agent-a');
    assert.equal(claim.msgId, 'msg-1');
  });

  it('holdsFloor returns null when agent has no claim', () => {
    const claim = fc.holdsFloor('agent-a', '#general');
    assert.equal(claim, null);
  });

  it('getHolder returns current holder for a message', () => {
    fc.claim('agent-a', '#general', 'msg-1', 1000);
    const holder = fc.getHolder('#general', 'msg-1');
    assert.ok(holder);
    assert.equal(holder.agentId, 'agent-a');
  });

  it('stats reports correct counts', () => {
    assert.deepEqual(fc.stats, { channels: 0, totalClaims: 0 });

    fc.claim('agent-a', '#general', 'msg-1', 1000);
    fc.claim('agent-b', '#random', 'msg-2', 1000);
    assert.deepEqual(fc.stats, { channels: 2, totalClaims: 2 });
  });
});
