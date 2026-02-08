/**
 * EscrowHooks - Event system for external escrow integration
 *
 * Allows external systems (blockchain, multi-sig, compliance) to hook into
 * escrow lifecycle events without modifying core AgentChat code.
 *
 * Events:
 *   escrow:created    - Escrow created when proposal accepted with stakes
 *   escrow:released   - Escrow released (expired, cancelled)
 *   settlement:completion - Proposal completed, stakes returned
 *   settlement:dispute    - Proposal disputed, stakes transferred/burned
 */

import type { Proposal } from './types.js';

export const EscrowEvent = {
  CREATED: 'escrow:created',
  RELEASED: 'escrow:released',
  COMPLETION_SETTLED: 'settlement:completion',
  DISPUTE_SETTLED: 'settlement:dispute',
  VERDICT_SETTLED: 'settlement:verdict'
} as const;

export type EscrowEventType = typeof EscrowEvent[keyof typeof EscrowEvent];

export interface Logger {
  error?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  info?: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
}

export interface EscrowHooksOptions {
  logger?: Logger;
  continueOnError?: boolean;
}

export interface HandlerResult {
  success: boolean;
  result?: unknown;
  error?: string;
  stack?: string;
}

export interface EmitResult {
  event: EscrowEventType;
  handled: boolean;
  results: HandlerResult[];
  errors?: HandlerResult[];
}

export type EscrowEventHandler = (payload: unknown) => Promise<unknown> | unknown;

export interface EscrowStakeInfo {
  agent_id?: string;
  stake?: number;
}

export interface EscrowInfo {
  proposal_id?: string;
  from?: EscrowStakeInfo;
  to?: EscrowStakeInfo;
}

export interface EscrowResult {
  escrow?: {
    proposal_id?: string;
  };
}

export interface RatingChanges {
  _escrow?: {
    proposer_stake?: number;
    acceptor_stake?: number;
    settlement?: string;
    settlement_reason?: string;
    fault_party?: string;
    transferred?: number;
    burned?: number;
  };
  [key: string]: unknown;
}

export interface EscrowCreatedPayload {
  event: typeof EscrowEvent.CREATED;
  timestamp: number;
  proposal_id: string;
  from_agent: string;
  to_agent: string;
  proposer_stake: number;
  acceptor_stake: number;
  total_stake: number;
  task: string;
  amount?: number;
  currency?: string;
  expires?: number;
  escrow_id: string;
}

export interface CompletionPayload {
  event: typeof EscrowEvent.COMPLETION_SETTLED;
  timestamp: number;
  proposal_id: string;
  from_agent: string;
  to_agent: string;
  completed_by?: string;
  completion_proof?: string;
  settlement: string;
  stakes_returned: {
    proposer: number;
    acceptor: number;
  };
  rating_changes: {
    [key: string]: unknown;
  };
}

export interface DisputePayload {
  event: typeof EscrowEvent.DISPUTE_SETTLED;
  timestamp: number;
  proposal_id: string;
  from_agent: string;
  to_agent: string;
  disputed_by?: string;
  dispute_reason?: string;
  settlement: string;
  settlement_reason?: string;
  fault_determination?: string;
  stakes_transferred?: number;
  stakes_burned?: number;
  rating_changes: {
    [key: string]: unknown;
  };
}

export interface EscrowReleasedPayload {
  event: typeof EscrowEvent.RELEASED;
  timestamp: number;
  proposal_id: string;
  from_agent?: string;
  to_agent?: string;
  stakes_released: {
    proposer: number;
    acceptor: number;
  };
  reason: string;
}

export interface ExtendedProposal extends Proposal {
  proposer_stake?: number;
  acceptor_stake?: number;
  completed_by?: string;
  completion_proof?: string;
  disputed_by?: string;
  dispute_reason?: string;
}

export class EscrowHooks {
  private handlers: Map<EscrowEventType, Set<EscrowEventHandler>>;
  private logger: Logger;
  private continueOnError: boolean;

  constructor(options: EscrowHooksOptions = {}) {
    this.handlers = new Map();
    this.logger = options.logger || console;
    this.continueOnError = options.continueOnError !== false; // default true

    // Initialize event handler sets
    for (const event of Object.values(EscrowEvent)) {
      this.handlers.set(event, new Set());
    }
  }

  /**
   * Register a handler for an escrow event
   * @param event - Event name from EscrowEvent
   * @param handler - Async function(payload) to call
   * @returns Unsubscribe function
   */
  on(event: EscrowEventType, handler: EscrowEventHandler): () => void {
    if (!this.handlers.has(event)) {
      throw new Error(`Unknown escrow event: ${event}`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Remove a handler for an escrow event
   * @param event - Event name
   * @param handler - Handler to remove
   */
  off(event: EscrowEventType, handler: EscrowEventHandler): void {
    if (this.handlers.has(event)) {
      this.handlers.get(event)!.delete(handler);
    }
  }

  /**
   * Remove all handlers for an event (or all events)
   * @param event - Optional event name
   */
  clear(event?: EscrowEventType): void {
    if (event) {
      if (this.handlers.has(event)) {
        this.handlers.get(event)!.clear();
      }
    } else {
      for (const handlers of this.handlers.values()) {
        handlers.clear();
      }
    }
  }

  /**
   * Emit an escrow event to all registered handlers
   * @param event - Event name
   * @param payload - Event payload
   * @returns Results from all handlers
   */
  async emit(event: EscrowEventType, payload: unknown): Promise<EmitResult> {
    if (!this.handlers.has(event)) {
      throw new Error(`Unknown escrow event: ${event}`);
    }

    const handlers = this.handlers.get(event)!;
    if (handlers.size === 0) {
      return { event, handled: false, results: [] };
    }

    const results: HandlerResult[] = [];
    const errors: HandlerResult[] = [];

    for (const handler of handlers) {
      try {
        const result = await handler(payload);
        results.push({ success: true, result });
      } catch (err) {
        const error = err as Error;
        const errorInfo: HandlerResult = {
          success: false,
          error: error.message,
          stack: error.stack
        };
        errors.push(errorInfo);
        results.push(errorInfo);

        this.logger.error?.(`[EscrowHooks] Error in ${event} handler:`, error.message);

        if (!this.continueOnError) {
          break;
        }
      }
    }

    return {
      event,
      handled: true,
      results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Check if any handlers are registered for an event
   * @param event - Event name
   * @returns True if handlers exist
   */
  hasHandlers(event: EscrowEventType): boolean {
    return this.handlers.has(event) && this.handlers.get(event)!.size > 0;
  }

  /**
   * Get count of handlers for an event
   * @param event - Event name
   * @returns Number of handlers
   */
  handlerCount(event: EscrowEventType): number {
    return this.handlers.has(event) ? this.handlers.get(event)!.size : 0;
  }
}

/**
 * Create payload for escrow:created event
 */
export function createEscrowCreatedPayload(
  proposal: ExtendedProposal,
  escrowResult: EscrowResult
): EscrowCreatedPayload {
  return {
    event: EscrowEvent.CREATED,
    timestamp: Date.now(),
    proposal_id: proposal.id,
    from_agent: proposal.from,
    to_agent: proposal.to,
    proposer_stake: proposal.proposer_stake || 0,
    acceptor_stake: proposal.acceptor_stake || 0,
    total_stake: (proposal.proposer_stake || 0) + (proposal.acceptor_stake || 0),
    task: proposal.task,
    amount: proposal.amount,
    currency: proposal.currency,
    expires: proposal.expires,
    escrow_id: escrowResult.escrow?.proposal_id || proposal.id
  };
}

/**
 * Create payload for settlement:completion event
 */
export function createCompletionPayload(
  proposal: ExtendedProposal,
  ratingChanges?: RatingChanges
): CompletionPayload {
  const escrowInfo = ratingChanges?._escrow || {};
  return {
    event: EscrowEvent.COMPLETION_SETTLED,
    timestamp: Date.now(),
    proposal_id: proposal.id,
    from_agent: proposal.from,
    to_agent: proposal.to,
    completed_by: proposal.completed_by,
    completion_proof: proposal.completion_proof,
    settlement: 'returned',
    stakes_returned: {
      proposer: escrowInfo.proposer_stake || 0,
      acceptor: escrowInfo.acceptor_stake || 0
    },
    rating_changes: {
      [proposal.from]: ratingChanges?.[proposal.from],
      [proposal.to]: ratingChanges?.[proposal.to]
    }
  };
}

/**
 * Create payload for settlement:dispute event
 */
export function createDisputePayload(
  proposal: ExtendedProposal,
  ratingChanges?: RatingChanges
): DisputePayload {
  const escrowInfo = ratingChanges?._escrow || {};
  return {
    event: EscrowEvent.DISPUTE_SETTLED,
    timestamp: Date.now(),
    proposal_id: proposal.id,
    from_agent: proposal.from,
    to_agent: proposal.to,
    disputed_by: proposal.disputed_by,
    dispute_reason: proposal.dispute_reason,
    settlement: escrowInfo.settlement || 'settled',
    settlement_reason: escrowInfo.settlement_reason,
    fault_determination: escrowInfo.fault_party,
    stakes_transferred: escrowInfo.transferred,
    stakes_burned: escrowInfo.burned,
    rating_changes: {
      [proposal.from]: ratingChanges?.[proposal.from],
      [proposal.to]: ratingChanges?.[proposal.to]
    }
  };
}

/**
 * Create payload for escrow:released event
 */
export function createEscrowReleasedPayload(
  proposalId: string,
  escrow: EscrowInfo,
  reason?: string
): EscrowReleasedPayload {
  return {
    event: EscrowEvent.RELEASED,
    timestamp: Date.now(),
    proposal_id: proposalId,
    from_agent: escrow.from?.agent_id,
    to_agent: escrow.to?.agent_id,
    stakes_released: {
      proposer: escrow.from?.stake || 0,
      acceptor: escrow.to?.stake || 0
    },
    reason: reason || 'expired'
  };
}

export default EscrowHooks;
