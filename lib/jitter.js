/**
 * Jitter utilities for preventing thundering herd and deadlock in distributed systems
 */

/**
 * Add jitter to a timeout value to prevent thundering herd / deadlock
 * When multiple agents use the same timeout, they all wake up at once.
 * Adding jitter spreads out the wakeups, breaking symmetry.
 *
 * @param {number} baseMs - Base timeout in milliseconds
 * @param {number} jitterPercent - Jitter percentage (0.0 to 1.0), default 0.2 (20%)
 * @returns {number} Jittered timeout value (minimum 100ms)
 *
 * @example
 * // With 20% jitter, a 10000ms timeout becomes 8000-12000ms
 * addJitter(10000, 0.2) // Returns value between 8000 and 12000
 *
 * @example
 * // Prevent deadlock in listen loops
 * const timeout = addJitter(60000, 0.2); // 48-72 seconds
 * setTimeout(checkForMessages, timeout);
 */
export function addJitter(baseMs, jitterPercent = 0.2) {
  // Clamp jitter percent to valid range
  const clampedJitter = Math.max(0, Math.min(1, jitterPercent));

  const jitterAmount = baseMs * clampedJitter;
  const jitter = (Math.random() - 0.5) * 2 * jitterAmount; // +/- jitterAmount

  return Math.max(100, Math.round(baseMs + jitter)); // Min 100ms
}

/**
 * Calculate exponential backoff with jitter
 * Useful for reconnection attempts
 *
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseMs - Base delay in milliseconds (default 1000)
 * @param {number} maxMs - Maximum delay cap (default 60000)
 * @param {number} jitterPercent - Jitter percentage (default 0.2)
 * @returns {number} Delay with exponential backoff and jitter
 *
 * @example
 * // Reconnection with backoff
 * let attempt = 0;
 * function reconnect() {
 *   const delay = exponentialBackoffWithJitter(attempt++);
 *   setTimeout(doReconnect, delay);
 * }
 */
export function exponentialBackoffWithJitter(attempt, baseMs = 1000, maxMs = 60000, jitterPercent = 0.2) {
  const exponentialDelay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return addJitter(exponentialDelay, jitterPercent);
}
