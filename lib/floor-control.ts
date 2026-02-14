/**
 * Floor Control — RESPONDING_TO protocol
 *
 * Implements optimistic locking for agent channel responses.
 * When an agent starts inference to respond to a message, it broadcasts
 * RESPONDING_TO with {msg_id, started_at}. The server tracks claims
 * per channel — earliest started_at wins, losers get YIELD.
 *
 * Design: advisory v1 — server dispatches YIELD but doesn't hard-block messages.
 * Well-behaved agents abort their inference on YIELD.
 */

// Claim TTL — auto-expire if agent doesn't send a response within this window
const CLAIM_TTL_MS = parseInt(process.env.AGENTCHAT_CLAIM_TTL_MS || '45000', 10);
// Cleanup interval
const CLEANUP_INTERVAL_MS = 5000;

export interface FloorClaim {
  agentId: string;
  msgId: string;          // the message being responded to
  channel: string;
  startedAt: number;      // agent's local timestamp when inference began
  receivedAt: number;     // server timestamp when claim was received
  expiresAt: number;      // auto-expire time
}

export interface RespondingToMessage {
  type: 'RESPONDING_TO';
  msg_id: string;         // message being responded to
  channel: string;        // which channel
  started_at: number;     // when inference started (agent local time)
}

export interface YieldMessage {
  type: 'YIELD';
  msg_id: string;         // the contested message
  channel: string;
  holder: string;         // agent ID that won the floor
  holder_started_at: number;
  reason: string;
}

/**
 * FloorControl tracks active claims per channel and resolves conflicts.
 */
export class FloorControl {
  // Map: channel → Map<msg_id → FloorClaim>
  // Only one claim per msg_id per channel (the winner)
  private claims: Map<string, Map<string, FloorClaim>> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.claims.clear();
  }

  /**
   * Process a RESPONDING_TO claim from an agent.
   * Returns:
   *   { granted: true } if the agent wins the floor
   *   { granted: false, holder: FloorClaim } if someone else already has it
   */
  claim(agentId: string, channel: string, msgId: string, startedAt: number): {
    granted: boolean;
    holder?: FloorClaim;
  } {
    if (!this.claims.has(channel)) {
      this.claims.set(channel, new Map());
    }
    const channelClaims = this.claims.get(channel)!;

    const existing = channelClaims.get(msgId);

    if (!existing) {
      // No existing claim — grant it
      const claim: FloorClaim = {
        agentId,
        msgId,
        channel,
        startedAt,
        receivedAt: Date.now(),
        expiresAt: Date.now() + CLAIM_TTL_MS,
      };
      channelClaims.set(msgId, claim);
      return { granted: true };
    }

    // Conflict — compare started_at timestamps
    if (startedAt < existing.startedAt) {
      // New claim started earlier — it wins, old holder gets yielded
      const oldHolder = { ...existing };
      const claim: FloorClaim = {
        agentId,
        msgId,
        channel,
        startedAt,
        receivedAt: Date.now(),
        expiresAt: Date.now() + CLAIM_TTL_MS,
      };
      channelClaims.set(msgId, claim);
      // Return the old holder so caller can send them YIELD
      return { granted: true, holder: oldHolder };
    }

    if (startedAt === existing.startedAt) {
      // Exact tie — tiebreak by agent ID (lexicographic, deterministic)
      if (agentId < existing.agentId) {
        const oldHolder = { ...existing };
        const claim: FloorClaim = {
          agentId,
          msgId,
          channel,
          startedAt,
          receivedAt: Date.now(),
          expiresAt: Date.now() + CLAIM_TTL_MS,
        };
        channelClaims.set(msgId, claim);
        return { granted: true, holder: oldHolder };
      }
    }

    // Existing claim started earlier (or won the tiebreak) — deny
    return { granted: false, holder: existing };
  }

  /**
   * Release a claim when an agent sends their actual response,
   * or on disconnect.
   */
  release(agentId: string, channel?: string): void {
    if (channel) {
      const channelClaims = this.claims.get(channel);
      if (!channelClaims) return;
      for (const [msgId, claim] of channelClaims) {
        if (claim.agentId === agentId) {
          channelClaims.delete(msgId);
        }
      }
    } else {
      // Release all claims by this agent (disconnect cleanup)
      for (const channelClaims of this.claims.values()) {
        for (const [msgId, claim] of channelClaims) {
          if (claim.agentId === agentId) {
            channelClaims.delete(msgId);
          }
        }
      }
    }
  }

  /**
   * Check if an agent currently holds the floor for any message in a channel.
   */
  holdsFloor(agentId: string, channel: string): FloorClaim | null {
    const channelClaims = this.claims.get(channel);
    if (!channelClaims) return null;
    for (const claim of channelClaims.values()) {
      if (claim.agentId === agentId) return claim;
    }
    return null;
  }

  /**
   * Get the current floor holder for a specific message.
   */
  getHolder(channel: string, msgId: string): FloorClaim | null {
    return this.claims.get(channel)?.get(msgId) || null;
  }

  /**
   * Expire stale claims.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [channel, channelClaims] of this.claims) {
      for (const [msgId, claim] of channelClaims) {
        if (claim.expiresAt <= now) {
          channelClaims.delete(msgId);
        }
      }
      if (channelClaims.size === 0) {
        this.claims.delete(channel);
      }
    }
  }

  /**
   * Get stats for health/debug.
   */
  get stats(): { channels: number; totalClaims: number } {
    let totalClaims = 0;
    for (const channelClaims of this.claims.values()) {
      totalClaims += channelClaims.size;
    }
    return { channels: this.claims.size, totalClaims };
  }
}
