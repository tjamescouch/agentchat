/**
 * Jitter utility unit tests
 * Run with: node --test test/jitter.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { addJitter, exponentialBackoffWithJitter } from '../dist/lib/jitter.js';

describe('addJitter', () => {
  test('returns value within jitter range', () => {
    const baseMs = 10000;
    const jitterPercent = 0.2;

    // Run multiple times to test randomness
    for (let i = 0; i < 100; i++) {
      const result = addJitter(baseMs, jitterPercent);
      const minExpected = baseMs * (1 - jitterPercent); // 8000
      const maxExpected = baseMs * (1 + jitterPercent); // 12000

      assert.ok(result >= minExpected, `Result ${result} should be >= ${minExpected}`);
      assert.ok(result <= maxExpected, `Result ${result} should be <= ${maxExpected}`);
    }
  });

  test('enforces minimum of 100ms', () => {
    // Even with a tiny base and high jitter, should never go below 100ms
    for (let i = 0; i < 50; i++) {
      const result = addJitter(50, 0.9);
      assert.ok(result >= 100, `Result ${result} should be >= 100ms minimum`);
    }
  });

  test('returns integers', () => {
    for (let i = 0; i < 20; i++) {
      const result = addJitter(1234, 0.15);
      assert.ok(Number.isInteger(result), `Result ${result} should be an integer`);
    }
  });

  test('default jitter is 20%', () => {
    const baseMs = 10000;
    // Run multiple times - with default 20% jitter, should vary
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      results.add(addJitter(baseMs));
    }
    // Should have multiple different values due to jitter
    assert.ok(results.size > 1, 'Should have variation with default jitter');

    // All values should be within 20% range
    for (const result of results) {
      assert.ok(result >= 8000 && result <= 12000, `Result ${result} within 20% range`);
    }
  });

  test('zero jitter returns base value', () => {
    const baseMs = 5000;
    const result = addJitter(baseMs, 0);
    assert.equal(result, baseMs);
  });

  test('clamps jitter percent to valid range', () => {
    const baseMs = 10000;

    // Negative jitter should be treated as 0
    const resultNegative = addJitter(baseMs, -0.5);
    assert.equal(resultNegative, baseMs);

    // Jitter > 1 should be clamped to 1
    for (let i = 0; i < 20; i++) {
      const result = addJitter(baseMs, 2.0);
      assert.ok(result >= 0 && result <= 20000, `Clamped jitter result ${result} in range`);
    }
  });

  test('produces variation (not always same value)', () => {
    const baseMs = 60000;
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(addJitter(baseMs, 0.2));
    }

    const uniqueValues = new Set(results);
    // With 20% jitter on 60s, we should see multiple different values
    assert.ok(uniqueValues.size > 3, `Should have variation, got ${uniqueValues.size} unique values`);
  });
});

describe('exponentialBackoffWithJitter', () => {
  test('increases delay with each attempt', () => {
    const attempt0 = exponentialBackoffWithJitter(0, 1000, 60000, 0); // No jitter for predictability
    const attempt1 = exponentialBackoffWithJitter(1, 1000, 60000, 0);
    const attempt2 = exponentialBackoffWithJitter(2, 1000, 60000, 0);
    const attempt3 = exponentialBackoffWithJitter(3, 1000, 60000, 0);

    assert.equal(attempt0, 1000);
    assert.equal(attempt1, 2000);
    assert.equal(attempt2, 4000);
    assert.equal(attempt3, 8000);
  });

  test('caps at maxMs', () => {
    const maxMs = 30000;
    // Attempt 10 would be 1000 * 2^10 = 1024000, but capped at 30000
    const result = exponentialBackoffWithJitter(10, 1000, maxMs, 0);
    assert.equal(result, maxMs);
  });

  test('applies jitter to backoff', () => {
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(exponentialBackoffWithJitter(3, 1000, 60000, 0.2));
    }

    // Base would be 8000, with 20% jitter should vary between 6400-9600
    const uniqueValues = new Set(results);
    assert.ok(uniqueValues.size > 1, 'Should have variation from jitter');

    for (const result of results) {
      assert.ok(result >= 6400 && result <= 9600, `Result ${result} within jittered range`);
    }
  });

  test('default values work', () => {
    // Just verify it doesn't throw with defaults
    const result = exponentialBackoffWithJitter(0);
    assert.ok(typeof result === 'number');
    assert.ok(result >= 100); // Minimum enforced by addJitter
  });
});
