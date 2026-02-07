/**
 * AgentChat Disputes Module (Agentcourt)
 * Panel-based arbitration for dispute resolution.
 *
 * Lifecycle: DISPUTE_INTENT → DISPUTE_REVEAL → PANEL_SELECTION →
 *            EVIDENCE_PERIOD → DELIBERATION → VERDICT
 */

import crypto from 'crypto';

// ============ Constants ============

export const DISPUTE_CONSTANTS = {
  PANEL_SIZE: 3,
  ARBITER_STAKE: 25,
  ARBITER_REWARD: 5,
  ARBITER_MIN_RATING: 1200,
  ARBITER_MIN_TRANSACTIONS: 10,
  ARBITER_INDEPENDENCE_DAYS: 30,
  ARBITER_MIN_ACCOUNT_AGE_DAYS: 7,
  FILING_FEE: 10,
  EVIDENCE_PERIOD_MS: 3600000,       // 1 hour
  ARBITER_RESPONSE_TIMEOUT_MS: 1800000, // 30 minutes
  VOTE_PERIOD_MS: 3600000,           // 1 hour
  MAX_DISPUTE_DURATION_MS: 14400000, // 4 hours
  MAX_EVIDENCE_ITEMS: 10,
  MAX_STATEMENT_CHARS: 2000,
  MAX_REASONING_CHARS: 500,
  MAX_REPLACEMENT_ROUNDS: 2,
  REVEAL_TIMEOUT_MS: 600000,         // 10 minutes
};

// ============ Types ============

export type DisputePhase =
  | 'intent'
  | 'reveal_pending'
  | 'panel_selection'
  | 'arbiter_response'
  | 'evidence'
  | 'deliberation'
  | 'resolved'
  | 'fallback';

export type Verdict = 'disputant' | 'respondent' | 'mutual';

export interface EvidenceItem {
  kind: 'commit' | 'test_result' | 'message_log' | 'receipt' | 'screenshot' | 'other';
  label: string;
  value: string;
  url?: string;
  hash?: string;  // SHA256 computed at submission
}

export interface ArbiterVote {
  arbiter: string;
  verdict: Verdict;
  reasoning: string;
  sig: string;
  voted_at: number;
}

export interface ArbiterSlot {
  agent_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'replaced' | 'voted' | 'forfeited';
  accepted_at?: number;
  vote?: ArbiterVote;
}

export interface StoredDispute {
  id: string;
  proposal_id: string;
  disputant: string;       // @agent who filed
  respondent: string;      // @other party
  reason: string;
  phase: DisputePhase;
  // Commit-reveal
  commitment: string;      // SHA256(nonce) from intent
  nonce?: string;          // revealed nonce
  server_nonce: string;    // server's nonce
  seed?: string;           // SHA256(proposal_id + nonce + server_nonce)
  // Panel
  arbiters: ArbiterSlot[];
  replacement_rounds: number;
  // Evidence
  disputant_evidence?: { items: EvidenceItem[]; statement: string; sig: string; };
  respondent_evidence?: { items: EvidenceItem[]; statement: string; sig: string; };
  // Verdict
  verdict?: Verdict;
  votes: ArbiterVote[];
  // Rating changes
  rating_changes?: Record<string, { old: number; new: number; change: number }>;
  // Timestamps
  created_at: number;
  revealed_at?: number;
  panel_formed_at?: number;
  evidence_deadline?: number;
  vote_deadline?: number;
  resolved_at?: number;
  updated_at: number;
  // Fee
  filing_fee_escrowed: boolean;
}

// ============ DisputeStore Class ============

export class DisputeStore {
  private disputes: Map<string, StoredDispute> = new Map();
  private byProposal: Map<string, string> = new Map();  // proposal_id -> dispute_id
  private byAgent: Map<string, Set<string>> = new Map(); // agent_id -> Set<dispute_id>
  private timeoutHandlers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * File a dispute intent (phase 1 of commit-reveal)
   */
  fileIntent(
    proposalId: string,
    disputantId: string,
    respondentId: string,
    reason: string,
    commitment: string,
  ): StoredDispute {
    const id = generateDisputeId();
    const serverNonce = crypto.randomBytes(16).toString('hex');

    const dispute: StoredDispute = {
      id,
      proposal_id: proposalId,
      disputant: disputantId,
      respondent: respondentId,
      reason,
      phase: 'reveal_pending',
      commitment,
      server_nonce: serverNonce,
      arbiters: [],
      replacement_rounds: 0,
      votes: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      filing_fee_escrowed: true,
    };

    this.disputes.set(id, dispute);
    this.byProposal.set(proposalId, id);
    this._indexAgent(disputantId, id);
    this._indexAgent(respondentId, id);

    return dispute;
  }

  /**
   * Reveal the nonce (phase 2 of commit-reveal)
   * Returns null if commitment doesn't match.
   */
  reveal(disputeId: string, nonce: string): StoredDispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'reveal_pending') return null;

    // Verify commitment
    const hash = crypto.createHash('sha256').update(nonce).digest('hex');
    if (hash !== dispute.commitment) return null;

    dispute.nonce = nonce;
    dispute.phase = 'panel_selection';
    dispute.revealed_at = Date.now();
    dispute.seed = crypto.createHash('sha256')
      .update(dispute.proposal_id + nonce + dispute.server_nonce)
      .digest('hex');
    dispute.updated_at = Date.now();

    return dispute;
  }

  /**
   * Select arbiters from the eligible pool using seeded PRNG.
   * Returns the selected agent IDs.
   */
  selectPanel(disputeId: string, eligiblePool: string[]): string[] | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'panel_selection' || !dispute.seed) return null;

    if (eligiblePool.length < DISPUTE_CONSTANTS.PANEL_SIZE) {
      // Not enough arbiters — fallback to legacy
      dispute.phase = 'fallback';
      dispute.updated_at = Date.now();
      return null;
    }

    // Seeded selection using the seed
    const selected = seededShuffle(eligiblePool, dispute.seed)
      .slice(0, DISPUTE_CONSTANTS.PANEL_SIZE);

    dispute.arbiters = selected.map(id => ({
      agent_id: id,
      status: 'pending' as const,
    }));
    dispute.phase = 'arbiter_response';
    dispute.panel_formed_at = Date.now();
    dispute.updated_at = Date.now();

    // Index arbiters
    for (const id of selected) {
      this._indexAgent(id, disputeId);
    }

    return selected;
  }

  /**
   * Arbiter accepts their panel appointment
   */
  arbiterAccept(disputeId: string, arbiterId: string): boolean {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'arbiter_response') return false;

    const slot = dispute.arbiters.find(a => a.agent_id === arbiterId && a.status === 'pending');
    if (!slot) return false;

    slot.status = 'accepted';
    slot.accepted_at = Date.now();
    dispute.updated_at = Date.now();

    // Check if all arbiters have accepted → move to evidence phase
    if (dispute.arbiters.every(a => a.status === 'accepted')) {
      dispute.phase = 'evidence';
      dispute.evidence_deadline = Date.now() + DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS;
      dispute.updated_at = Date.now();
    }

    return true;
  }

  /**
   * Arbiter declines — forfeit stake, trigger replacement
   */
  arbiterDecline(disputeId: string, arbiterId: string, replacementPool: string[]): string | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'arbiter_response') return null;

    const slot = dispute.arbiters.find(a => a.agent_id === arbiterId && a.status === 'pending');
    if (!slot) return null;

    slot.status = 'declined';
    dispute.replacement_rounds++;
    dispute.updated_at = Date.now();

    if (dispute.replacement_rounds > DISPUTE_CONSTANTS.MAX_REPLACEMENT_ROUNDS) {
      dispute.phase = 'fallback';
      dispute.updated_at = Date.now();
      return null;
    }

    // Find a replacement from pool (exclude current/past arbiters and parties)
    const excluded = new Set([
      dispute.disputant,
      dispute.respondent,
      ...dispute.arbiters.map(a => a.agent_id),
    ]);
    const candidates = replacementPool.filter(id => !excluded.has(id));

    if (candidates.length === 0) {
      dispute.phase = 'fallback';
      dispute.updated_at = Date.now();
      return null;
    }

    // Pick first available (deterministic from remaining pool)
    const replacement = candidates[0];
    slot.status = 'replaced';

    dispute.arbiters.push({
      agent_id: replacement,
      status: 'pending',
    });
    this._indexAgent(replacement, disputeId);

    return replacement;
  }

  /**
   * Submit evidence for a dispute
   */
  submitEvidence(
    disputeId: string,
    agentId: string,
    items: EvidenceItem[],
    statement: string,
    sig: string,
  ): boolean {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'evidence') return false;

    // Check deadline
    if (dispute.evidence_deadline && Date.now() > dispute.evidence_deadline) return false;

    // Validate limits
    if (items.length > DISPUTE_CONSTANTS.MAX_EVIDENCE_ITEMS) return false;
    if (statement.length > DISPUTE_CONSTANTS.MAX_STATEMENT_CHARS) return false;

    // Hash each item for integrity
    const hashedItems = items.map(item => ({
      ...item,
      hash: crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'),
    }));

    const evidence = { items: hashedItems, statement, sig };

    if (agentId === dispute.disputant) {
      dispute.disputant_evidence = evidence;
    } else if (agentId === dispute.respondent) {
      dispute.respondent_evidence = evidence;
    } else {
      return false;
    }

    dispute.updated_at = Date.now();
    return true;
  }

  /**
   * Close evidence period and move to deliberation
   */
  closeEvidence(disputeId: string): boolean {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'evidence') return false;

    dispute.phase = 'deliberation';
    dispute.vote_deadline = Date.now() + DISPUTE_CONSTANTS.VOTE_PERIOD_MS;
    dispute.updated_at = Date.now();

    return true;
  }

  /**
   * Arbiter casts a vote
   */
  castVote(
    disputeId: string,
    arbiterId: string,
    verdict: Verdict,
    reasoning: string,
    sig: string,
  ): boolean {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'deliberation') return false;

    // Check deadline
    if (dispute.vote_deadline && Date.now() > dispute.vote_deadline) return false;

    // Validate reasoning length
    if (reasoning.length > DISPUTE_CONSTANTS.MAX_REASONING_CHARS) return false;

    // Must be an accepted arbiter
    const slot = dispute.arbiters.find(
      a => a.agent_id === arbiterId && a.status === 'accepted'
    );
    if (!slot) return false;

    const vote: ArbiterVote = {
      arbiter: arbiterId,
      verdict,
      reasoning,
      sig,
      voted_at: Date.now(),
    };

    slot.vote = vote;
    slot.status = 'voted';
    dispute.votes.push(vote);
    dispute.updated_at = Date.now();

    // Check if all accepted arbiters have voted
    const acceptedArbiters = dispute.arbiters.filter(a =>
      a.status === 'accepted' || a.status === 'voted'
    );
    const allVoted = acceptedArbiters.every(a => a.status === 'voted');

    if (allVoted) {
      this._resolveVerdict(dispute);
    }

    return true;
  }

  /**
   * Force-resolve a dispute after vote deadline
   * (some arbiters may not have voted — they forfeit)
   */
  forceResolve(disputeId: string): StoredDispute | null {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.phase !== 'deliberation') return null;

    // Mark non-voters as forfeited
    for (const slot of dispute.arbiters) {
      if (slot.status === 'accepted') {
        slot.status = 'forfeited';
      }
    }

    this._resolveVerdict(dispute);
    return dispute;
  }

  /**
   * Get a dispute by ID
   */
  get(id: string): StoredDispute | null {
    return this.disputes.get(id) || null;
  }

  /**
   * Get dispute by proposal ID
   */
  getByProposal(proposalId: string): StoredDispute | null {
    const disputeId = this.byProposal.get(proposalId);
    if (!disputeId) return null;
    return this.get(disputeId);
  }

  /**
   * List disputes involving an agent
   */
  listByAgent(agentId: string): StoredDispute[] {
    const ids = this.byAgent.get(agentId) || new Set();
    return Array.from(ids)
      .map(id => this.get(id))
      .filter((d): d is StoredDispute => d !== null)
      .sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * Clear a timeout handler
   */
  clearTimeout(disputeId: string): void {
    const handler = this.timeoutHandlers.get(disputeId);
    if (handler) {
      globalThis.clearTimeout(handler);
      this.timeoutHandlers.delete(disputeId);
    }
  }

  /**
   * Set a timeout handler for a dispute phase
   */
  setTimeout(disputeId: string, ms: number, callback: () => void): void {
    this.clearTimeout(disputeId);
    const handler = globalThis.setTimeout(callback, ms);
    this.timeoutHandlers.set(disputeId, handler);
  }

  /**
   * Cleanup all timeouts
   */
  close(): void {
    for (const handler of this.timeoutHandlers.values()) {
      globalThis.clearTimeout(handler);
    }
    this.timeoutHandlers.clear();
  }

  // ============ Private ============

  private _resolveVerdict(dispute: StoredDispute): void {
    const votes = dispute.votes;

    if (votes.length === 0) {
      dispute.verdict = 'mutual';
    } else {
      // Count votes
      const counts: Record<Verdict, number> = { disputant: 0, respondent: 0, mutual: 0 };
      for (const v of votes) {
        counts[v.verdict]++;
      }

      // Majority wins
      if (counts.disputant >= 2) {
        dispute.verdict = 'disputant';
      } else if (counts.respondent >= 2) {
        dispute.verdict = 'respondent';
      } else {
        // No majority (all different, or 2-voter tie) → mutual
        dispute.verdict = 'mutual';
      }
    }

    dispute.phase = 'resolved';
    dispute.resolved_at = Date.now();
    dispute.updated_at = Date.now();
  }

  private _indexAgent(agentId: string, disputeId: string): void {
    if (!this.byAgent.has(agentId)) {
      this.byAgent.set(agentId, new Set());
    }
    this.byAgent.get(agentId)!.add(disputeId);
  }
}

// ============ Helpers ============

/**
 * Generate a unique dispute ID
 */
export function generateDisputeId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `disp_${timestamp}_${random}`;
}

/**
 * Seeded shuffle using SHA256 chain for deterministic random selection
 */
function seededShuffle(arr: string[], seed: string): string[] {
  const result = [...arr];
  let currentSeed = seed;

  for (let i = result.length - 1; i > 0; i--) {
    currentSeed = crypto.createHash('sha256').update(currentSeed).digest('hex');
    const j = parseInt(currentSeed.substring(0, 8), 16) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Signing content generators for dispute messages
 */
export function getDisputeIntentSigningContent(proposalId: string, reason: string, commitment: string): string {
  return `DISPUTE_INTENT|${proposalId}|${reason}|${commitment}`;
}

export function getDisputeRevealSigningContent(proposalId: string, nonce: string): string {
  return `DISPUTE_REVEAL|${proposalId}|${nonce}`;
}

export function getEvidenceSigningContent(disputeId: string, itemsJson: string): string {
  const hash = crypto.createHash('sha256').update(itemsJson).digest('hex');
  return `EVIDENCE|${disputeId}|${hash}`;
}

export function getArbiterAcceptSigningContent(disputeId: string): string {
  return `ARBITER_ACCEPT|${disputeId}`;
}

export function getArbiterDeclineSigningContent(disputeId: string, reason: string): string {
  return `ARBITER_DECLINE|${disputeId}|${reason}`;
}

export function getVoteSigningContent(disputeId: string, verdict: string): string {
  return `VOTE|${disputeId}|${verdict}`;
}
