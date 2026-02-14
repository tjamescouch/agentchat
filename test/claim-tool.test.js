/**
 * Tests for the agentchat_claim MCP tool.
 * Validates frame shape, channel validation, and connection checks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the tool logic directly by importing and calling with a mock server
// Since the tool registers via server.tool(), we capture the handler and invoke it.

describe('agentchat_claim tool', () => {
  let handler;
  let sentFrames;
  let mockClient;

  beforeEach(async () => {
    sentFrames = [];
    mockClient = {
      connected: true,
      agentId: '@test-agent',
      ws: {
        send: (data) => sentFrames.push(JSON.parse(data)),
      },
    };

    // Mock the state module's client export
    // We import the module dynamically and override
    const stateModule = await import('../mcp-server/state.js');
    stateModule.setClient(mockClient);

    // Capture the handler by providing a mock server
    const { registerClaimTool } = await import('../mcp-server/tools/claim.js');
    const mockServer = {
      tool: (_name, _desc, _schema, fn) => { handler = fn; },
    };
    registerClaimTool(mockServer);
  });

  it('sends correct RESPONDING_TO frame', async () => {
    const before = Date.now();
    const result = await handler({ msg_id: 'msg-123', channel: '#general' });
    const after = Date.now();

    assert.equal(sentFrames.length, 1);
    const frame = sentFrames[0];
    assert.equal(frame.type, 'RESPONDING_TO');
    assert.equal(frame.msg_id, 'msg-123');
    assert.equal(frame.channel, '#general');
    assert.ok(frame.started_at >= before && frame.started_at <= after, 'started_at should be current timestamp');

    const body = JSON.parse(result.content[0].text);
    assert.equal(body.success, true);
    assert.equal(body.msg_id, 'msg-123');
    assert.equal(body.channel, '#general');
    assert.equal(body.agent_id, '@test-agent');
  });

  it('rejects non-channel targets', async () => {
    const result = await handler({ msg_id: 'msg-123', channel: '@someone' });

    assert.equal(sentFrames.length, 0);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('channels'));
  });

  it('rejects when not connected', async () => {
    mockClient.connected = false;
    const result = await handler({ msg_id: 'msg-123', channel: '#general' });

    assert.equal(sentFrames.length, 0);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Not connected'));
  });
});
