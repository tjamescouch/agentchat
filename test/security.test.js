/**
 * Tests for security module
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { checkDirectorySafety, enforceDirectorySafety } from '../dist/lib/security.js';

describe('checkDirectorySafety', () => {
  test('rejects root directory', () => {
    const result = checkDirectorySafety('/');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
    assert.ok(result.error.includes('system directory'));
  });

  test('rejects /Users', () => {
    const result = checkDirectorySafety('/Users');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
  });

  test('rejects /home', () => {
    const result = checkDirectorySafety('/home');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
  });

  test('rejects /etc', () => {
    const result = checkDirectorySafety('/etc');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
  });

  test('rejects /var', () => {
    const result = checkDirectorySafety('/var');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
  });

  test('rejects shallow paths (depth < 3)', () => {
    const result = checkDirectorySafety('/foo/bar');
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.level, 'error');
    assert.ok(result.error.includes('too close to the filesystem root'));
  });

  test('warns on home directory', () => {
    const result = checkDirectorySafety('/Users/testuser');
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.level, 'warning');
    assert.ok(result.warning.includes('home directory'));
  });

  test('warns on Linux home directory', () => {
    const result = checkDirectorySafety('/home/testuser');
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.level, 'warning');
    assert.ok(result.warning.includes('home directory'));
  });

  test('accepts project directory', () => {
    const result = checkDirectorySafety('/Users/testuser/projects/myapp');
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.level, 'ok');
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.warning, undefined);
  });

  test('accepts deep project directory', () => {
    const result = checkDirectorySafety('/home/user/dev/company/project/src');
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.level, 'ok');
  });
});

describe('enforceDirectorySafety', () => {
  test('throws on unsafe directory', () => {
    assert.throws(
      () => enforceDirectorySafety('/'),
      /system directory/
    );
  });

  test('throws on shallow directory', () => {
    assert.throws(
      () => enforceDirectorySafety('/foo'),
      /too close to the filesystem root/
    );
  });

  test('does not throw on safe directory', () => {
    assert.doesNotThrow(
      () => enforceDirectorySafety('/Users/testuser/projects/myapp')
    );
  });

  test('does not throw on warning with allowWarnings=true', () => {
    assert.doesNotThrow(
      () => enforceDirectorySafety('/Users/testuser', { allowWarnings: true, silent: true })
    );
  });

  test('throws on warning with allowWarnings=false', () => {
    assert.throws(
      () => enforceDirectorySafety('/Users/testuser', { allowWarnings: false, silent: true }),
      /home directory/
    );
  });
});
