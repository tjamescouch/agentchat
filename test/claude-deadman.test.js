/**
 * Tests for claude-deadman prompt detection logic.
 * Tests the regex patterns and deny-list matching without spawning processes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Extracted prompt detection logic (mirrors claude-deadman.mjs)
const PROMPT_PATTERNS = [
  /\[Y\/n\]/,
  /Allow .+\?/i,
  /Do you want to (allow|proceed)/i,
  /\(y\/n\)/i,
];

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function isPrompt(text) {
  return PROMPT_PATTERNS.some(p => p.test(stripAnsi(text)));
}

function matchesDenyList(text, denyPatterns) {
  return denyPatterns.some(p => p.test(stripAnsi(text)));
}

describe('claude-deadman prompt detection', () => {
  it('detects [Y/n] prompt', () => {
    assert.ok(isPrompt('Allow Bash tool? [Y/n]'));
  });

  it('detects Allow...? prompt', () => {
    assert.ok(isPrompt('Allow Read tool to read /etc/passwd?'));
  });

  it('detects Do you want to allow prompt', () => {
    assert.ok(isPrompt('Do you want to allow this operation?'));
  });

  it('detects (y/n) prompt', () => {
    assert.ok(isPrompt('Continue? (y/n)'));
  });

  it('does not false-positive on regular output', () => {
    assert.ok(!isPrompt('Building project... done.'));
    assert.ok(!isPrompt('const allowed = true;'));
    assert.ok(!isPrompt('// This allows the user to proceed'));
    assert.ok(!isPrompt('Running tests: 26/26 passed'));
  });

  it('does not false-positive on code containing Y/n in strings', () => {
    // This is a known edge case — code output with [Y/n] in a string literal
    // The prompt detector WILL match this, which is acceptable (conservative)
    // since it just starts a timer that can be cancelled
    assert.ok(isPrompt('const prompt = "[Y/n]"'));
  });

  it('detects prompts with ANSI escape codes', () => {
    assert.ok(isPrompt('\x1b[1m\x1b[33mAllow Bash tool?\x1b[0m [Y/n]'));
    assert.ok(isPrompt('\x1b[36mDo you want to allow\x1b[0m this?'));
  });

  it('handles prompt split across ANSI sequences', () => {
    assert.ok(isPrompt('\x1b[1mAllow\x1b[0m \x1b[33mRead tool?\x1b[0m'));
  });
});

describe('claude-deadman deny list', () => {
  it('matches deny pattern', () => {
    const deny = [/rm\s+-rf/, /DROP\s+TABLE/i];
    assert.ok(matchesDenyList('Allow Bash: rm -rf /tmp/foo? [Y/n]', deny));
    assert.ok(matchesDenyList('Allow SQL: DROP TABLE users? [Y/n]', deny));
  });

  it('does not match safe commands', () => {
    const deny = [/rm\s+-rf/, /DROP\s+TABLE/i];
    assert.ok(!matchesDenyList('Allow Bash: git status? [Y/n]', deny));
    assert.ok(!matchesDenyList('Allow Read: /home/agent/file.txt? [Y/n]', deny));
  });

  it('empty deny list matches nothing', () => {
    assert.ok(!matchesDenyList('Allow anything? [Y/n]', []));
  });
});
