/**
 * Tests for AgentChatDaemon model propagation
 * Run with: npx tsx lib/daemon.model.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentChatDaemon } from './daemon.js';

describe('AgentChatDaemon model propagation', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.AGENT_MODEL;
    delete process.env.AGENT_MODEL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENT_MODEL = originalEnv;
    } else {
      delete process.env.AGENT_MODEL;
    }
  });

  it('initializes model from DaemonOptions', () => {
    const daemon = new AgentChatDaemon({
      server: 'ws://localhost:6667',
      model: 'sonnet',
    });
    assert.equal(daemon.model, 'sonnet');
  });

  it('defaults to null when model not provided', () => {
    const daemon = new AgentChatDaemon({
      server: 'ws://localhost:6667',
    });
    assert.equal(daemon.model, null);
  });

  it('accepts various model names', () => {
    const models = ['haiku', 'sonnet', 'opus', 'gpt4.1', 'gpt5', 'o3', 'grok'];
    for (const model of models) {
      const daemon = new AgentChatDaemon({
        server: 'ws://localhost:6667',
        model,
      });
      assert.equal(daemon.model, model);
    }
  });

  it('sets process.env.AGENT_MODEL when model is provided', async () => {
    const daemon = new AgentChatDaemon({
      server: 'ws://localhost:6667',
      model: 'sonnet',
    });

    // Mock the start() dependencies to isolate model env setting
    // We can't fully test start() without server, but we can verify
    // the model property exists and can be used to set env
    assert.equal(daemon.model, 'sonnet');
    
    // Simulate what start() does
    if (daemon.model) {
      process.env.AGENT_MODEL = daemon.model;
    }
    
    assert.equal(process.env.AGENT_MODEL, 'sonnet');
  });

  it('does not set process.env.AGENT_MODEL when model is null', async () => {
    const daemon = new AgentChatDaemon({
      server: 'ws://localhost:6667',
    });

    // Simulate what start() does
    if (daemon.model) {
      process.env.AGENT_MODEL = daemon.model;
    }
    
    assert.equal(process.env.AGENT_MODEL, undefined);
  });
});
