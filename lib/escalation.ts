/**
 * Escalation Engine
 * Progressive moderation: warn -> throttle -> timeout -> kick
 *
 * Tracks per-connection violation state and escalates enforcement
 * as agents continue to exceed rate limits.
 */

// Escalation levels in order of severity
export enum EscalationLevel {
  NONE = 'none',
  WARNED = 'warned',
  THROTTLED = 'throttled',
  TIMED_OUT = 'timed_out',
  KICKED = 'kicked',
}

// Per-connection escalation state
export interface EscalationState {
  level: EscalationLevel;
  violations: number;          // total violations in current window
  warningsSent: number;        // warnings issued
  throttleUntil: number;       // timestamp: throttled until this time
  timeoutUntil: number;        // timestamp: timed out until this time
  timeoutCount: number;        // how many times timed out
  lastViolationAt: number;     // last violation timestamp
  windowStart: number;         // start of current tracking window
}

// Action the server should take
export interface EscalationAction {
  type: 'allow' | 'warn' | 'throttle' | 'timeout' | 'kick';
  message: string;
  throttleMs?: number;         // how long to throttle (for throttle action)
  timeoutMs?: number;          // how long to timeout (for timeout action)
}

// Configurable thresholds
export interface EscalationOptions {
  // How many rate limit violations before warning
  warnAfterViolations?: number;
  // How many violations after warning before throttle
  throttleAfterViolations?: number;
  // How many violations after throttle before timeout
  timeoutAfterViolations?: number;
  // How many timeouts before kick
  kickAfterTimeouts?: number;
  // Throttle duration in ms (messages delayed by this amount)
  throttleDurationMs?: number;
  // Timeout duration in ms (connection temporarily rejected)
  timeoutDurationMs?: number;
  // Window in ms for tracking violations (violations decay after this)
  violationWindowMs?: number;
  // Cool-down: if no violations for this long, decay one escalation level
  cooldownMs?: number;
  // Separate TTL for timeout history (longer than cooldownMs to prevent patient attacker gaming)
  // timeoutCount only resets after this much inactivity, even if level decays to NONE
  timeoutMemoryMs?: number;
}

const DEFAULTS: Required<EscalationOptions> = {
  warnAfterViolations: 3,
  throttleAfterViolations: 6,
  timeoutAfterViolations: 10,
  kickAfterTimeouts: 3,
  throttleDurationMs: 5000,     // 5 seconds between messages when throttled
  timeoutDurationMs: 60000,     // 1 minute timeout
  violationWindowMs: 60000,     // 1 minute violation window
  cooldownMs: 300000,           // 5 minutes clean = decay one level
  timeoutMemoryMs: 3600000,     // 1 hour: timeout history lingers even after level decay
};

export class EscalationEngine {
  private states: Map<string, EscalationState> = new Map();
  private options: Required<EscalationOptions>;
  private logger: (event: string, data: Record<string, unknown>) => void;

  constructor(
    options: EscalationOptions = {},
    logger?: (event: string, data: Record<string, unknown>) => void,
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.logger = logger || (() => {});
  }

  /**
   * Record a rate limit violation and return the action to take.
   * Called whenever a connection exceeds the rate limit.
   */
  recordViolation(connectionId: string, agentId?: string): EscalationAction {
    const now = Date.now();
    let state = this.states.get(connectionId);

    if (!state) {
      state = this._createState(now);
      this.states.set(connectionId, state);
    }

    // Apply gradual decay based on time since last violation.
    // Each cooldown period of inactivity drops one escalation level.
    this._applyDecay(state, now);

    // Reset violation count if the violation window has expired
    if (now - state.windowStart > this.options.violationWindowMs) {
      state.violations = 0;
      state.windowStart = now;
    }

    state.violations++;
    state.lastViolationAt = now;

    const meta = { connectionId, agentId, violations: state.violations, level: state.level };

    // Check if currently timed out
    if (state.level === EscalationLevel.TIMED_OUT && now < state.timeoutUntil) {
      return {
        type: 'timeout',
        message: `You are timed out. Try again in ${Math.ceil((state.timeoutUntil - now) / 1000)} seconds.`,
        timeoutMs: state.timeoutUntil - now,
      };
    }

    // Determine escalation based on violation count
    if (state.violations >= this.options.timeoutAfterViolations) {
      state.timeoutCount++;

      if (state.timeoutCount >= this.options.kickAfterTimeouts) {
        state.level = EscalationLevel.KICKED;
        this.logger('escalation_kick', { ...meta, timeoutCount: state.timeoutCount });
        return {
          type: 'kick',
          message: `Kicked for repeated violations (${state.timeoutCount} timeouts). Please moderate your message rate.`,
        };
      }

      state.level = EscalationLevel.TIMED_OUT;
      state.timeoutUntil = now + this.options.timeoutDurationMs;
      state.violations = 0; // reset violations for next window
      state.windowStart = now;
      this.logger('escalation_timeout', { ...meta, timeoutCount: state.timeoutCount, durationMs: this.options.timeoutDurationMs });
      return {
        type: 'timeout',
        message: `Timed out for ${Math.ceil(this.options.timeoutDurationMs / 1000)} seconds due to excessive messaging. (Timeout ${state.timeoutCount}/${this.options.kickAfterTimeouts})`,
        timeoutMs: this.options.timeoutDurationMs,
      };
    }

    if (state.violations >= this.options.throttleAfterViolations) {
      state.level = EscalationLevel.THROTTLED;
      state.throttleUntil = now + this.options.throttleDurationMs;
      this.logger('escalation_throttle', { ...meta, throttleMs: this.options.throttleDurationMs });
      return {
        type: 'throttle',
        message: `Throttled: your messages are being rate-limited to 1 per ${Math.ceil(this.options.throttleDurationMs / 1000)} seconds.`,
        throttleMs: this.options.throttleDurationMs,
      };
    }

    if (state.violations >= this.options.warnAfterViolations) {
      state.warningsSent++;
      if (state.level === EscalationLevel.NONE) {
        state.level = EscalationLevel.WARNED;
      }
      this.logger('escalation_warn', { ...meta, warningsSent: state.warningsSent });
      return {
        type: 'warn',
        message: `Warning: you are sending messages too quickly. Continued violations will result in throttling. (${state.violations}/${this.options.throttleAfterViolations} before throttle)`,
      };
    }

    // Below warning threshold — just silently rate limit
    return {
      type: 'allow',
      message: '',
    };
  }

  /**
   * Check if a connection is currently throttled and should have messages delayed.
   * Returns the additional delay in ms, or 0 if not throttled.
   */
  getThrottleDelay(connectionId: string): number {
    const state = this.states.get(connectionId);
    if (!state) return 0;

    // Apply gradual decay first
    this._applyDecay(state, Date.now());

    if (state.level === EscalationLevel.THROTTLED) {
      return this.options.throttleDurationMs;
    }
    return 0;
  }

  /**
   * Check if a connection is currently timed out.
   * Returns true if the connection should be rejected.
   */
  isTimedOut(connectionId: string): boolean {
    const state = this.states.get(connectionId);
    if (!state) return false;

    const now = Date.now();

    // Apply gradual decay first
    this._applyDecay(state, now);

    if (state.level === EscalationLevel.TIMED_OUT && now < state.timeoutUntil) {
      return true;
    }

    // Timeout expired — move back to throttled level
    if (state.level === EscalationLevel.TIMED_OUT && now >= state.timeoutUntil) {
      state.level = EscalationLevel.THROTTLED;
    }
    return false;
  }

  /**
   * Get the current escalation level for a connection.
   */
  getLevel(connectionId: string): EscalationLevel {
    const state = this.states.get(connectionId);
    if (!state) return EscalationLevel.NONE;

    // Apply gradual decay
    this._applyDecay(state, Date.now());

    return state.level;
  }

  /**
   * Get the full state for a connection (for debugging/logging).
   */
  getState(connectionId: string): EscalationState | undefined {
    return this.states.get(connectionId);
  }

  /**
   * Remove tracking for a disconnected connection.
   */
  remove(connectionId: string): void {
    this.states.delete(connectionId);
  }

  /**
   * Reset a connection's escalation state (e.g., after admin intervention).
   */
  reset(connectionId: string): void {
    this.states.delete(connectionId);
  }

  /**
   * Clean up stale entries (connections that have been clean for a while).
   * Call periodically to prevent memory leaks.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, state] of this.states) {
      // Apply decay first
      this._applyDecay(state, now);

      // Only remove if fully decayed to NONE AND timeout memory has expired
      if (state.level === EscalationLevel.NONE && now - state.lastViolationAt > this.options.timeoutMemoryMs) {
        this.states.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get stats for monitoring.
   */
  stats(): { tracked: number; warned: number; throttled: number; timedOut: number } {
    let warned = 0;
    let throttled = 0;
    let timedOut = 0;

    for (const state of this.states.values()) {
      switch (state.level) {
        case EscalationLevel.WARNED: warned++; break;
        case EscalationLevel.THROTTLED: throttled++; break;
        case EscalationLevel.TIMED_OUT: timedOut++; break;
      }
    }

    return {
      tracked: this.states.size,
      warned,
      throttled,
      timedOut,
    };
  }

  /**
   * Gradual decay: drop one escalation level per cooldown period of inactivity.
   * KICKED → TIMED_OUT → THROTTLED → WARNED → NONE
   */
  private _applyDecay(state: EscalationState, now: number): void {
    if (state.lastViolationAt === 0) return; // no violations yet

    const elapsed = now - state.lastViolationAt;
    if (elapsed < this.options.cooldownMs) return; // not enough time

    const levelsToDrop = Math.floor(elapsed / this.options.cooldownMs);
    const ladder: EscalationLevel[] = [
      EscalationLevel.NONE,
      EscalationLevel.WARNED,
      EscalationLevel.THROTTLED,
      EscalationLevel.TIMED_OUT,
      EscalationLevel.KICKED,
    ];

    const currentIdx = ladder.indexOf(state.level);
    if (currentIdx <= 0) return; // already at NONE

    const newIdx = Math.max(0, currentIdx - levelsToDrop);
    const oldLevel = state.level;
    state.level = ladder[newIdx];

    // If we decayed past TIMED_OUT, clear timeout state
    if (newIdx < ladder.indexOf(EscalationLevel.TIMED_OUT)) {
      state.timeoutUntil = 0;
    }

    // Reset violations when decaying (fresh window)
    if (newIdx !== currentIdx) {
      state.violations = 0;
      state.windowStart = now;

      if (newIdx === 0) {
        // Level fully decayed to NONE — reset warnings
        state.warningsSent = 0;
        // timeoutCount has its own longer TTL to prevent patient attacker gaming
        if (elapsed >= this.options.timeoutMemoryMs) {
          state.timeoutCount = 0;
        }
      }

      this.logger('escalation_decay', {
        connectionId: 'unknown', // caller doesn't pass this, but it's just for logging
        from: oldLevel,
        to: state.level,
        levelsToDrop,
        elapsedMs: elapsed,
      });
    }
  }

  private _createState(now: number): EscalationState {
    return {
      level: EscalationLevel.NONE,
      violations: 0,
      warningsSent: 0,
      throttleUntil: 0,
      timeoutUntil: 0,
      timeoutCount: 0,
      lastViolationAt: 0,
      windowStart: now,
    };
  }
}
