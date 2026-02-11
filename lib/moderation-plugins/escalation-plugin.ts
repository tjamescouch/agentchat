/**
 * Escalation Plugin
 *
 * Wraps the EscalationEngine as a ModerationPlugin.
 * Tracks rate limit violations and progressively escalates:
 * warn -> throttle -> timeout -> kick
 */

import type { ModerationPlugin, ModerationEvent, ModerationAction } from '../moderation.js';
import { ModerationActionType } from '../moderation.js';
import { EscalationEngine, type EscalationOptions } from '../escalation.js';

export class EscalationPlugin implements ModerationPlugin {
  readonly name = 'escalation';
  readonly failBehavior = 'closed' as const;
  private engine: EscalationEngine;

  constructor(options?: EscalationOptions) {
    this.engine = new EscalationEngine(options);
  }

  check(event: ModerationEvent): ModerationAction {
    const connId = event.agentId || event.ip || 'unknown';

    // Check if currently timed out
    if (this.engine.isTimedOut(connId)) {
      return {
        type: ModerationActionType.TIMEOUT,
        reason: 'Connection is currently timed out',
        plugin: this.name,
      };
    }

    // Check if throttled — return throttle action with metadata
    const throttleDelay = this.engine.getThrottleDelay(connId);
    if (throttleDelay > 0) {
      return {
        type: ModerationActionType.THROTTLE,
        reason: `Throttled: max 1 message per ${Math.ceil(throttleDelay / 1000)} seconds`,
        plugin: this.name,
        metadata: { throttleMs: throttleDelay },
      };
    }

    // No active enforcement — allow
    return {
      type: ModerationActionType.ALLOW,
      reason: '',
      plugin: this.name,
    };
  }

  /**
   * Call this when a rate limit violation occurs (separate from check).
   * Returns the escalation action.
   */
  recordViolation(agentId: string): ModerationAction {
    const action = this.engine.recordViolation(agentId);

    switch (action.type) {
      case 'kick':
        return {
          type: ModerationActionType.KICK,
          reason: action.message,
          plugin: this.name,
        };
      case 'timeout':
        return {
          type: ModerationActionType.TIMEOUT,
          reason: action.message,
          plugin: this.name,
          metadata: { timeoutMs: action.timeoutMs },
        };
      case 'throttle':
        return {
          type: ModerationActionType.THROTTLE,
          reason: action.message,
          plugin: this.name,
          metadata: { throttleMs: action.throttleMs },
        };
      case 'warn':
        return {
          type: ModerationActionType.WARN,
          reason: action.message,
          plugin: this.name,
        };
      default:
        return {
          type: ModerationActionType.ALLOW,
          reason: '',
          plugin: this.name,
        };
    }
  }

  onDisconnect(agentId: string): void {
    // Don't remove state on disconnect — prevents reconnect-to-reset abuse
    // Stale entries cleaned up via cleanup()
  }

  cleanup(): number {
    return this.engine.cleanup();
  }

  /** Expose engine stats for monitoring */
  stats() {
    return this.engine.stats();
  }
}
