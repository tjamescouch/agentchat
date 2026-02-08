/**
 * Redactor Tests
 * Tests the secret redaction module (vendored from agentseenoevil)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Redactor, BUILTIN_PATTERNS } from '../dist/lib/redactor.js';

describe('Redactor', () => {
  test('detects and redacts Anthropic API keys', () => {
    const r = new Redactor();
    const input = 'My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const result = r.redact(input);

    assert.ok(result.count > 0);
    assert.ok(!result.text.includes('sk-ant-'));
    assert.ok(result.text.includes('[REDACTED]'));
    assert.ok(result.matched.includes('anthropic_api_key'));
  });

  test('detects and redacts OpenAI API keys', () => {
    const r = new Redactor();
    const input = 'export OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = r.redact(input);

    assert.ok(result.count > 0);
    assert.ok(!result.text.includes('sk-abcdefghij'));
  });

  test('detects and redacts GitHub PATs', () => {
    const r = new Redactor();
    const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const result = r.redact(input);

    assert.ok(result.count > 0);
    assert.ok(!result.text.includes('ghp_'));
  });

  test('detects and redacts AWS access keys', () => {
    const r = new Redactor();
    const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const result = r.redact(input);

    assert.ok(result.count > 0);
    assert.ok(!result.text.includes('AKIAIOSFODNN'));
  });

  test('does not redact normal text', () => {
    const r = new Redactor();
    const input = 'Hello world, this is a normal message about code review';
    const result = r.redact(input);

    assert.equal(result.count, 0);
    assert.equal(result.text, input);
    assert.deepEqual(result.matched, []);
  });

  test('handles multiple secrets in one message', () => {
    const r = new Redactor();
    const input = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz with ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const result = r.redact(input);

    assert.ok(result.count >= 2);
    assert.ok(!result.text.includes('sk-ant-'));
    assert.ok(!result.text.includes('ghp_'));
  });

  test('clean() returns just the text', () => {
    const r = new Redactor();
    const cleaned = r.clean('key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz');

    assert.ok(typeof cleaned === 'string');
    assert.ok(!cleaned.includes('sk-ant-'));
  });

  test('hasSecrets() returns boolean', () => {
    const r = new Redactor();

    assert.equal(r.hasSecrets('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
    assert.equal(r.hasSecrets('Hello world'), false);
  });

  test('labelRedactions includes pattern name', () => {
    const r = new Redactor({ labelRedactions: true });
    const result = r.redact('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');

    assert.ok(result.text.includes('[REDACTED:anthropic_api_key]'));
  });

  test('custom patterns are applied', () => {
    const r = new Redactor({
      patterns: [{ name: 'custom_key', pattern: /CUSTOM-[A-Z]{10,}/ }],
    });
    const result = r.redact('My key is CUSTOM-ABCDEFGHIJKLMNOP');

    assert.ok(result.count > 0);
    assert.ok(result.matched.includes('custom_key'));
  });

  test('empty string returns unchanged', () => {
    const r = new Redactor();
    const result = r.redact('');

    assert.equal(result.text, '');
    assert.equal(result.count, 0);
  });

  test('JWT tokens are detected', () => {
    const r = new Redactor();
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = r.redact(`Bearer ${jwt}`);

    assert.ok(result.count > 0);
    assert.ok(!result.text.includes('eyJhbG'));
  });
});
