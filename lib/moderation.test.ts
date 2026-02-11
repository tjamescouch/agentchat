/**
 * Tests for Moderation Pipeline and Plugins
 *
 * Run with: npx tsx lib/moderation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModerationPipeline, ModerationActionType, type ModerationPlugin, type ModerationEvent } from './moderation.js';
import { EscalationPlugin } from './moderation-plugins/escalation-plugin.js';
import { LinkDetectorPlugin } from './moderation-plugins/link-detector-plugin.js';

function makeEvent(overrides: Partial<ModerationEvent> = {}): ModerationEvent {
  return {
    messageType: 'MSG',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ModerationPipeline', () => {
  it('allows messages when no plugins registered', async () => {
    const pipeline = new ModerationPipeline();
    const result = await pipeline.check(makeEvent());
    assert.equal(result.action.type, ModerationActionType.ALLOW);
  });

  it('applies admin bypass', async () => {
    const pipeline = new ModerationPipeline();

    // Register a plugin that always blocks
    const blockerPlugin: ModerationPlugin = {
      name: 'always-block',
      check: () => ({
        type: ModerationActionType.BLOCK,
        reason: 'Blocked',
        plugin: 'always-block',
      }),
    };
    pipeline.register(blockerPlugin);

    // Admin should bypass
    const result = await pipeline.check(makeEvent({ isAdmin: true }));
    assert.equal(result.adminBypassed, true);
    assert.equal(result.action.type, ModerationActionType.ALLOW);
  });

  it('strictest action wins', async () => {
    const pipeline = new ModerationPipeline();

    const warnPlugin: ModerationPlugin = {
      name: 'warn-plugin',
      check: () => ({ type: ModerationActionType.WARN, reason: 'Warning', plugin: 'warn-plugin' }),
    };

    const blockPlugin: ModerationPlugin = {
      name: 'block-plugin',
      check: () => ({ type: ModerationActionType.BLOCK, reason: 'Blocked', plugin: 'block-plugin' }),
    };

    pipeline.register(warnPlugin);
    pipeline.register(blockPlugin);

    const result = await pipeline.check(makeEvent());
    assert.equal(result.action.type, ModerationActionType.BLOCK);
    assert.equal(result.action.plugin, 'block-plugin');
    assert.equal(result.allActions.length, 2);
  });

  it('supports per-channel plugins', async () => {
    const pipeline = new ModerationPipeline();

    const strictPlugin: ModerationPlugin = {
      name: 'strict',
      check: () => ({ type: ModerationActionType.BLOCK, reason: 'Strict', plugin: 'strict' }),
    };

    pipeline.registerForChannel('#moderated', strictPlugin);

    // Message to #moderated gets blocked
    const r1 = await pipeline.check(makeEvent({ channel: '#moderated' }));
    assert.equal(r1.action.type, ModerationActionType.BLOCK);

    // Message to #general is fine
    const r2 = await pipeline.check(makeEvent({ channel: '#general' }));
    assert.equal(r2.action.type, ModerationActionType.ALLOW);
  });

  it('combines global and channel plugins', async () => {
    const pipeline = new ModerationPipeline();

    const globalWarn: ModerationPlugin = {
      name: 'global-warn',
      check: () => ({ type: ModerationActionType.WARN, reason: 'Global warning', plugin: 'global-warn' }),
    };

    const channelBlock: ModerationPlugin = {
      name: 'channel-block',
      check: () => ({ type: ModerationActionType.BLOCK, reason: 'Channel blocked', plugin: 'channel-block' }),
    };

    pipeline.register(globalWarn);
    pipeline.registerForChannel('#strict', channelBlock);

    // #strict gets the stricter action
    const r1 = await pipeline.check(makeEvent({ channel: '#strict' }));
    assert.equal(r1.action.type, ModerationActionType.BLOCK);
    assert.equal(r1.allActions.length, 2);

    // Other channels only get the warn
    const r2 = await pipeline.check(makeEvent({ channel: '#general' }));
    assert.equal(r2.action.type, ModerationActionType.WARN);
  });

  it('unregisters plugins', async () => {
    const pipeline = new ModerationPipeline();

    const plugin: ModerationPlugin = {
      name: 'removable',
      check: () => ({ type: ModerationActionType.BLOCK, reason: 'Block', plugin: 'removable' }),
    };

    pipeline.register(plugin);
    assert.equal((await pipeline.check(makeEvent())).action.type, ModerationActionType.BLOCK);

    pipeline.unregister('removable');
    assert.equal((await pipeline.check(makeEvent())).action.type, ModerationActionType.ALLOW);
  });

  it('lists registered plugins', () => {
    const pipeline = new ModerationPipeline();
    const p1: ModerationPlugin = { name: 'a', check: () => ({ type: ModerationActionType.ALLOW, reason: '', plugin: 'a' }) };
    const p2: ModerationPlugin = { name: 'b', check: () => ({ type: ModerationActionType.ALLOW, reason: '', plugin: 'b' }) };

    pipeline.register(p1);
    pipeline.registerForChannel('#test', p2);

    const list = pipeline.listPlugins();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'a');
    assert.equal(list[0].scope, 'global');
    assert.equal(list[1].name, 'b');
    assert.equal(list[1].scope, 'channel');
    assert.equal(list[1].channel, '#test');
  });

  it('calls onDisconnect on all plugins', () => {
    const pipeline = new ModerationPipeline();
    const disconnected: string[] = [];

    const plugin: ModerationPlugin = {
      name: 'tracker',
      check: () => ({ type: ModerationActionType.ALLOW, reason: '', plugin: 'tracker' }),
      onDisconnect: (id) => disconnected.push(id),
    };

    pipeline.register(plugin);
    pipeline.onDisconnect('agent123');

    assert.equal(disconnected.length, 1);
    assert.equal(disconnected[0], 'agent123');
  });

  it('supports async plugins', async () => {
    const pipeline = new ModerationPipeline();

    const asyncPlugin: ModerationPlugin = {
      name: 'async-blocker',
      check: async (_event) => {
        // Simulate async lookup
        await new Promise(r => setTimeout(r, 10));
        return { type: ModerationActionType.BLOCK, reason: 'Async block', plugin: 'async-blocker' };
      },
    };

    pipeline.register(asyncPlugin);

    const result = await pipeline.check(makeEvent());
    assert.equal(result.action.type, ModerationActionType.BLOCK);
    assert.equal(result.action.plugin, 'async-blocker');
  });

  it('fail-open plugin error allows message through', async () => {
    const pipeline = new ModerationPipeline();

    const brokenPlugin: ModerationPlugin = {
      name: 'broken-open',
      failBehavior: 'open',
      check: () => { throw new Error('Plugin crashed'); },
    };

    pipeline.register(brokenPlugin);

    const result = await pipeline.check(makeEvent());
    // fail-open: message goes through
    assert.equal(result.action.type, ModerationActionType.ALLOW);
  });

  it('fail-closed plugin error blocks message', async () => {
    const pipeline = new ModerationPipeline();

    const brokenPlugin: ModerationPlugin = {
      name: 'broken-closed',
      failBehavior: 'closed',
      check: () => { throw new Error('Plugin crashed'); },
    };

    pipeline.register(brokenPlugin);

    const result = await pipeline.check(makeEvent());
    // fail-closed: message is blocked
    assert.equal(result.action.type, ModerationActionType.BLOCK);
    assert.ok(result.action.reason.includes('fail-closed'));
  });

  it('defaults to fail-open when failBehavior not specified', async () => {
    const pipeline = new ModerationPipeline();

    const brokenPlugin: ModerationPlugin = {
      name: 'broken-default',
      // no failBehavior set
      check: () => { throw new Error('Plugin crashed'); },
    };

    pipeline.register(brokenPlugin);

    const result = await pipeline.check(makeEvent());
    assert.equal(result.action.type, ModerationActionType.ALLOW);
  });
});

describe('LinkDetectorPlugin', () => {
  it('allows messages without URLs', () => {
    const plugin = new LinkDetectorPlugin();
    const action = plugin.check(makeEvent({ content: 'Hello everyone' }));
    assert.equal(action.type, ModerationActionType.ALLOW);
  });

  it('warns new connections posting URLs', () => {
    const plugin = new LinkDetectorPlugin({ minConnectionAgeMs: 300000 });
    const action = plugin.check(makeEvent({
      content: 'Check out https://example.com',
      connectionAgeMs: 5000, // 5 seconds old
    }));
    assert.equal(action.type, ModerationActionType.WARN);
    assert.ok(action.reason.includes('New connection'));
  });

  it('allows old connections to post URLs', () => {
    const plugin = new LinkDetectorPlugin({ minConnectionAgeMs: 300000 });
    const action = plugin.check(makeEvent({
      content: 'Check out https://example.com',
      connectionAgeMs: 600000, // 10 minutes old
    }));
    assert.equal(action.type, ModerationActionType.ALLOW);
  });

  it('allows verified agents to post URLs', () => {
    const plugin = new LinkDetectorPlugin({ minConnectionAgeMs: 300000 });
    const action = plugin.check(makeEvent({
      content: 'Check out https://example.com',
      connectionAgeMs: 1000, // very new
      verified: true,
    }));
    assert.equal(action.type, ModerationActionType.ALLOW);
  });

  it('blocks URLs matching blocked patterns', () => {
    const plugin = new LinkDetectorPlugin({
      blockedPatterns: ['botsforpeace\\.ai'],
    });
    const action = plugin.check(makeEvent({
      content: 'Join us at https://botsforpeace.ai',
      connectionAgeMs: 600000,
      verified: true,
    }));
    assert.equal(action.type, ModerationActionType.BLOCK);
    assert.ok(action.reason.includes('Blocked URL'));
  });

  it('skips non-MSG events', () => {
    const plugin = new LinkDetectorPlugin();
    const action = plugin.check(makeEvent({
      messageType: 'JOIN',
      content: 'https://example.com',
    }));
    assert.equal(action.type, ModerationActionType.ALLOW);
  });

  it('configurable untrusted action', () => {
    const plugin = new LinkDetectorPlugin({
      untrustedAction: ModerationActionType.BLOCK,
      minConnectionAgeMs: 300000,
    });
    const action = plugin.check(makeEvent({
      content: 'https://spam.example.com',
      connectionAgeMs: 1000,
    }));
    assert.equal(action.type, ModerationActionType.BLOCK);
  });
});

describe('EscalationPlugin', () => {
  it('allows by default', () => {
    const plugin = new EscalationPlugin();
    const action = plugin.check(makeEvent({ agentId: 'test' }));
    assert.equal(action.type, ModerationActionType.ALLOW);
  });

  it('warns after repeated violations', () => {
    const plugin = new EscalationPlugin({ warnAfterViolations: 2 });
    plugin.recordViolation('test');
    const action = plugin.recordViolation('test');
    assert.equal(action.type, ModerationActionType.WARN);
  });

  it('reports throttle state via check()', () => {
    const plugin = new EscalationPlugin({ warnAfterViolations: 2, throttleAfterViolations: 4 });
    for (let i = 0; i < 4; i++) plugin.recordViolation('test');

    // Now check() should report throttled
    const action = plugin.check(makeEvent({ agentId: 'test' }));
    assert.equal(action.type, ModerationActionType.THROTTLE);
  });

  it('exposes stats', () => {
    const plugin = new EscalationPlugin({ warnAfterViolations: 2 });
    plugin.recordViolation('a');
    plugin.recordViolation('a');

    const stats = plugin.stats();
    assert.equal(stats.tracked, 1);
    assert.equal(stats.warned, 1);
  });
});
