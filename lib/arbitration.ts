/**
 * Agentcourt Arbitration Store
 * Server-side dispute lifecycle management for panel-based arbitration
 */

import crypto from 'crypto';

// ============ Constants ============

export const ARBITRATION_CONSTANTS = {
  PANEL_SIZE: 3,
  ARBITER_STAKE: 25,
  ARBITER_REWARD: 5,
  ARBITER_MIN_RATING: 1200,
  ARBITER_MIN_TRANSACTIONS: 10,
  ARBITER_INDEPENDENCE_DAYS: 30,
  EVIDENCE_PERIOD_MS: 3_600_000,
  ARBITER_RESPONSE_TIMEOUT_MS: 1_800_000,
  VOTE_PERIOD_MS: 3_600_000,
  MAX_DISPUTE_DURATION_MS: 14_400_000,
  MAX_EVIDENCE_ITEMS: 10,
  MAX_STATEMENT_CHARS: 2000,
  MAX_REASONING_CHARS: 500,
  MAX_REPLACEMENT_ROUNDS: 2,
  DISPUTE_FILING_FEE: 10,
  DISPUTE_REVEAL_TIMEOUT_MS: 600_000,
  ARBITER_MIN_ACCOUNT_AGE_DAYS: 7,
} as const;

// ============ Types ============

export type DisputeStatus =
  | 'intent'
  | 'filed'
  | 'panel_selection'
  | 'evidence'
  | 'deliberation'
  | 'resolved'
  | 'fallback'
  | 'expired';

export type VerdictType = 'disputant' | 'respondent' | 'mutual';

export interface EvidenceItem {
  kind: string;
  label: string;
  value: string;
  url?: string;
  hash?: string;
}

export interface EvidenceSubmission {
  agentId: string;
  items: EvidenceItem[];
  statement: string;
  sig: string;
  submittedAt: number;
}

export interface ArbiterSlot {
  agentId: string;
  status: 'pending' | 'accepted' | 'declined' | 'replaced' | 'voted';
  stake: number;
  acceptedAt: number | null;
  vote: {
    verdict: VerdictType;
    reasoning: string;
    sig: string;
    votedAt: number;
  } | null;
  replacedBy: string | null;
}

export interface Panel {
  arbiters: ArbiterSlot[];
  seed: string;
  serverNonce: string;
  disputantNonce: string;
  formedAt: number;
  replacementRound: number;
}

export interface Dispute {
  id: string;
  proposalId: string;
  disputantId: string;
  respondentId: string;
  reason: string;
  status: DisputeStatus;
  commitment: string;
  nonce: string | null;
  serverNonce: string | null;
  createdAt: number;
  filedAt: number | null;
  evidenceDeadline: number | null;
  voteDeadline: number | null;
  panel: Panel | null;
  disputantEvidence: EvidenceSubmission | null;
  respondentEvidence: EvidenceSubmission | null;
  verdict: VerdictType | null;
  resolvedAt: number | null;
  filingFee: number;
  filingFeeReturned: boolean;
}

export interface RatingChange {
  oldRating: number;
  newRating: number;
  change: number;
}

export interface VerdictResult {
  disputeId: string;
  proposalId: string;
  verdict: VerdictType;
  votes: Array<{ arbiter: string; verdict: VerdictType; reasoning: string }>;
  ratingChanges: Record<string, RatingChange>;
  escrowSettlement: {
    winner: string | null;
    amountTransferred: number;
    stakesBurned: number;
  };
  resolvedAt: number;
}

// ============ Helpers ============

function generateDisputeId(): string {
  return 'disp_' + crypto.randomBytes(8).toString('hex');
}

function hashEvidence(item: EvidenceItem): string {
  const json = JSON.stringify({ kind: item.kind, label: item.label, value: item.value, url: item.url });
  return crypto.createHash('sha256').update(json).digest('hex');
}

function computeSeed(proposalId: string, disputantNonce: string, serverNonce: string): string {
  return crypto.createHash('sha256')
    .update(proposalId + disputantNonce + serverNonce)
    .digest('hex');
}

function selectFromPool(pool: string[], count: number, seed: string): string[] {
  const selected: string[] = [];
  const remaining = [...pool];
  let currentHash = seed;
  for (let i = 0; i < count && remaining.length > 0; i++) {
    currentHash = crypto.createHash('sha256').update(currentHash + i).digest('hex');
    const index = parseInt(currentHash.slice(0, 8), 16) % remaining.length;
    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return selected;
}

// ============ ArbitrationStore ============

export class ArbitrationStore {
  private disputes: Map<string, Dispute> = new Map();
  private byProposal: Map<string, string> = new Map();
  private byAgent: Map<string, Set<string>> = new Map();

  createIntent(
    proposalId: string,
    disputantId: string,
    respondentId: string,
    reason: string,
    commitment: string,
  ): Dispute | { error: string } {
    if (this.byProposal.has(proposalId)) {
      return { error: 'DISPUTE_ALREADY_EXISTS' };
    }

    const id = generateDisputeId();
    const dispute: Dispute = {
      id,
      proposalId,
      disputantId,
      respondentId,
      reason,
      status: 'intent',
      commitment,
      nonce: null,
      serverNonce: null,
      createdAt: Date.now(),
      filedAt: null,
      evidenceDeadline: null,
      voteDeadline: null,
      panel: null,
      disputantEvidence: null,
      respondentEvidence: null,
      verdict: null,
      resolvedAt: null,
      filingFee: ARBITRATION_CONSTANTS.DISPUTE_FILING_FEE,
      filingFeeReturned: false,
    };

    this.disputes.set(id, dispute);
    this.byProposal.set(proposalId, id);
    this._indexAgent(disputantId, id);
    this._indexAgent(respondentId, id);

    return dispute;
  }

  revealNonce(disputeId: string, nonce: string): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'intent') return { error: 'DISPUTE_NOT_IN_INTENT' };

    if (Date.now() - dispute.createdAt > ARBITRATION_CONSTANTS.DISPUTE_REVEAL_TIMEOUT_MS) {
      dispute.status = 'expired';
      return { error: 'REVEAL_TIMEOUT' };
    }

    const hash = crypto.createHash('sha256').update(nonce).digest('hex');
    if (hash !== dispute.commitment) {
      return { error: 'COMMITMENT_MISMATCH' };
    }

    dispute.nonce = nonce;
    dispute.serverNonce = crypto.randomBytes(32).toString('hex');
    dispute.status = 'filed';
    dispute.filedAt = Date.now();
    return dispute;
  }

  selectPanel(disputeId: string, eligibleArbiters: string[]): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'filed') return { error: 'DISPUTE_NOT_FILED' };

    if (eligibleArbiters.length < ARBITRATION_CONSTANTS.PANEL_SIZE) {
      dispute.status = 'fallback';
      return dispute;
    }

    const seed = computeSeed(dispute.proposalId, dispute.nonce!, dispute.serverNonce!);
    const selected = selectFromPool(eligibleArbiters, ARBITRATION_CONSTANTS.PANEL_SIZE, seed);

    dispute.panel = {
      arbiters: selected.map(agentId => ({
        agentId,
        status: 'pending' as const,
        stake: ARBITRATION_CONSTANTS.ARBITER_STAKE,
        acceptedAt: null,
        vote: null,
        replacedBy: null,
      })),
      seed,
      serverNonce: dispute.serverNonce!,
      disputantNonce: dispute.nonce!,
      formedAt: Date.now(),
      replacementRound: 0,
    };

    dispute.status = 'panel_selection';
    return dispute;
  }

  arbiterAccept(disputeId: string, arbiterId: string): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'panel_selection') return { error: 'DISPUTE_NOT_IN_PANEL_SELECTION' };

    const slot = dispute.panel!.arbiters.find(
      a => a.agentId === arbiterId && a.status === 'pending'
    );
    if (!slot) return { error: 'ARBITER_NOT_ON_PANEL' };

    slot.status = 'accepted';
    slot.acceptedAt = Date.now();

    const allAccepted = dispute.panel!.arbiters
      .filter(a => a.status !== 'replaced' && a.status !== 'declined')
      .every(a => a.status === 'accepted');

    if (allAccepted) {
      dispute.status = 'evidence';
      dispute.evidenceDeadline = Date.now() + ARBITRATION_CONSTANTS.EVIDENCE_PERIOD_MS;
    }

    return dispute;
  }

  arbiterDecline(
    disputeId: string,
    arbiterId: string,
    remainingPool: string[],
  ): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'panel_selection') return { error: 'DISPUTE_NOT_IN_PANEL_SELECTION' };

    const slot = dispute.panel!.arbiters.find(
      a => a.agentId === arbiterId && a.status === 'pending'
    );
    if (!slot) return { error: 'ARBITER_NOT_ON_PANEL' };

    slot.status = 'declined';
    dispute.panel!.replacementRound++;

    if (dispute.panel!.replacementRound > ARBITRATION_CONSTANTS.MAX_REPLACEMENT_ROUNDS) {
      dispute.status = 'fallback';
      return dispute;
    }

    const currentArbiters = dispute.panel!.arbiters.map(a => a.agentId);
    const available = remainingPool.filter(id => !currentArbiters.includes(id));

    if (available.length === 0) {
      dispute.status = 'fallback';
      return dispute;
    }

    const replacementSeed = computeSeed(
      dispute.proposalId,
      dispute.nonce! + dispute.panel!.replacementRound,
      dispute.serverNonce!,
    );
    const [replacement] = selectFromPool(available, 1, replacementSeed);

    slot.replacedBy = replacement;
    dispute.panel!.arbiters.push({
      agentId: replacement,
      status: 'pending',
      stake: ARBITRATION_CONSTANTS.ARBITER_STAKE,
      acceptedAt: null,
      vote: null,
      replacedBy: null,
    });

    return dispute;
  }

  submitEvidence(
    disputeId: string,
    agentId: string,
    items: EvidenceItem[],
    statement: string,
    sig: string,
  ): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'evidence') return { error: 'DISPUTE_NOT_IN_EVIDENCE' };

    if (Date.now() > dispute.evidenceDeadline!) {
      return { error: 'EVIDENCE_DEADLINE_PASSED' };
    }

    if (agentId !== dispute.disputantId && agentId !== dispute.respondentId) {
      return { error: 'NOT_DISPUTE_PARTY' };
    }

    const hashedItems = items.map(item => ({
      ...item,
      hash: hashEvidence(item),
    }));

    const submission: EvidenceSubmission = {
      agentId,
      items: hashedItems,
      statement,
      sig,
      submittedAt: Date.now(),
    };

    if (agentId === dispute.disputantId) {
      if (dispute.disputantEvidence) return { error: 'EVIDENCE_ALREADY_SUBMITTED' };
      dispute.disputantEvidence = submission;
    } else {
      if (dispute.respondentEvidence) return { error: 'EVIDENCE_ALREADY_SUBMITTED' };
      dispute.respondentEvidence = submission;
    }

    return dispute;
  }

  closeEvidence(disputeId: string): Dispute | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'evidence') return { error: 'DISPUTE_NOT_IN_EVIDENCE' };

    dispute.status = 'deliberation';
    dispute.voteDeadline = Date.now() + ARBITRATION_CONSTANTS.VOTE_PERIOD_MS;
    return dispute;
  }

  castVote(
    disputeId: string,
    arbiterId: string,
    verdict: VerdictType,
    reasoning: string,
    sig: string,
  ): { dispute: Dispute; resolved: boolean } | { error: string } {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return { error: 'DISPUTE_NOT_FOUND' };
    if (dispute.status !== 'deliberation') return { error: 'DISPUTE_NOT_IN_DELIBERATION' };

    const slot = dispute.panel!.arbiters.find(
      a => a.agentId === arbiterId && (a.status === 'accepted' || a.status === 'voted')
    );
    if (!slot) return { error: 'ARBITER_NOT_ON_PANEL' };
    if (slot.vote) return { error: 'ALREADY_VOTED' };

    slot.vote = { verdict, reasoning, sig, votedAt: Date.now() };
    slot.status = 'voted';

    const activeArbiters = dispute.panel!.arbiters.filter(
      a => a.status === 'accepted' || a.status === 'voted'
    );
    const allVoted = activeArbiters.every(a => a.vote !== null);

    if (allVoted) {
      this._resolveVerdict(dispute);
      return { dispute, resolved: true };
    }

    return { dispute, resolved: false };
  }

  get(disputeId: string): Dispute | null {
    return this.disputes.get(disputeId) ?? null;
  }

  getByProposal(proposalId: string): Dispute | null {
    const id = this.byProposal.get(proposalId);
    if (!id) return null;
    return this.disputes.get(id) ?? null;
  }

  /**
   * Get the number of active panels an arbiter is on
   */
  activePanelCount(arbiterId: string): number {
    let count = 0;
    for (const dispute of this.disputes.values()) {
      if (['resolved', 'fallback', 'expired'].includes(dispute.status)) continue;
      if (dispute.panel) {
        const onPanel = dispute.panel.arbiters.some(
          a => a.agentId === arbiterId && a.status !== 'declined' && a.status !== 'replaced'
        );
        if (onPanel) count++;
      }
    }
    return count;
  }

  /**
   * Calculate rating changes for a resolved dispute
   */
  calculateRatingChanges(
    dispute: Dispute,
    ratings: Record<string, { rating: number; transactions: number }>,
    effectiveK: number = 16,
  ): Record<string, RatingChange> {
    if (!dispute.verdict) throw new Error('DISPUTE_NOT_RESOLVED');

    const changes: Record<string, RatingChange> = {};
    const disputantRating = ratings[dispute.disputantId]?.rating ?? 1200;
    const respondentRating = ratings[dispute.respondentId]?.rating ?? 1200;
    const eDisputant = 1 / (1 + Math.pow(10, (respondentRating - disputantRating) / 400));
    const eRespondent = 1 - eDisputant;

    if (dispute.verdict === 'disputant') {
      const respondentLoss = Math.max(1, Math.round(effectiveK * eRespondent));
      const disputantGain = Math.max(1, Math.round(respondentLoss * 0.5));
      changes[dispute.disputantId] = { oldRating: disputantRating, newRating: disputantRating + disputantGain, change: disputantGain };
      changes[dispute.respondentId] = { oldRating: respondentRating, newRating: respondentRating - respondentLoss, change: -respondentLoss };
    } else if (dispute.verdict === 'respondent') {
      const disputantLoss = Math.max(1, Math.round(effectiveK * eDisputant));
      const respondentGain = Math.max(1, Math.round(disputantLoss * 0.5));
      changes[dispute.disputantId] = { oldRating: disputantRating, newRating: disputantRating - disputantLoss, change: -disputantLoss };
      changes[dispute.respondentId] = { oldRating: respondentRating, newRating: respondentRating + respondentGain, change: respondentGain };
    } else {
      const disputantLoss = Math.max(1, Math.round(effectiveK * eDisputant));
      const respondentLoss = Math.max(1, Math.round(effectiveK * eRespondent));
      changes[dispute.disputantId] = { oldRating: disputantRating, newRating: disputantRating - disputantLoss, change: -disputantLoss };
      changes[dispute.respondentId] = { oldRating: respondentRating, newRating: respondentRating - respondentLoss, change: -respondentLoss };
    }

    // Arbiter rewards
    const activeArbiters = dispute.panel!.arbiters.filter(a => a.vote !== null);
    for (const arbiter of activeArbiters) {
      const arbiterRating = ratings[arbiter.agentId]?.rating ?? 1200;
      if (arbiter.vote!.verdict === dispute.verdict) {
        changes[arbiter.agentId] = { oldRating: arbiterRating, newRating: arbiterRating + ARBITRATION_CONSTANTS.ARBITER_REWARD, change: ARBITRATION_CONSTANTS.ARBITER_REWARD };
      } else {
        changes[arbiter.agentId] = { oldRating: arbiterRating, newRating: arbiterRating, change: 0 };
      }
    }

    // No-show penalties
    const noShows = dispute.panel!.arbiters.filter(
      a => a.status === 'declined' || (a.status === 'accepted' && a.vote === null)
    );
    for (const noShow of noShows) {
      const rating = ratings[noShow.agentId]?.rating ?? 1200;
      changes[noShow.agentId] = { oldRating: rating, newRating: rating - ARBITRATION_CONSTANTS.ARBITER_STAKE, change: -ARBITRATION_CONSTANTS.ARBITER_STAKE };
    }

    return changes;
  }

  buildVerdictResult(dispute: Dispute, ratingChanges: Record<string, RatingChange>): VerdictResult {
    const activeArbiters = dispute.panel!.arbiters.filter(a => a.vote !== null);

    let winner: string | null = null;
    let stakesBurned = 0;
    if (dispute.verdict === 'disputant') {
      winner = dispute.disputantId;
    } else if (dispute.verdict === 'respondent') {
      winner = dispute.respondentId;
    } else {
      stakesBurned = activeArbiters.reduce((sum, a) => sum + a.stake, 0);
    }

    return {
      disputeId: dispute.id,
      proposalId: dispute.proposalId,
      verdict: dispute.verdict!,
      votes: activeArbiters.map(a => ({
        arbiter: a.agentId,
        verdict: a.vote!.verdict,
        reasoning: a.vote!.reasoning,
      })),
      ratingChanges,
      escrowSettlement: { winner, amountTransferred: 0, stakesBurned },
      resolvedAt: dispute.resolvedAt!,
    };
  }

  private _indexAgent(agentId: string, disputeId: string): void {
    if (!this.byAgent.has(agentId)) this.byAgent.set(agentId, new Set());
    this.byAgent.get(agentId)!.add(disputeId);
  }

  private _resolveVerdict(dispute: Dispute): void {
    const activeArbiters = dispute.panel!.arbiters.filter(a => a.vote !== null);
    const counts: Record<VerdictType, number> = { disputant: 0, respondent: 0, mutual: 0 };
    for (const arbiter of activeArbiters) counts[arbiter.vote!.verdict]++;

    if (counts.disputant >= 2) dispute.verdict = 'disputant';
    else if (counts.respondent >= 2) dispute.verdict = 'respondent';
    else dispute.verdict = 'mutual';

    dispute.status = 'resolved';
    dispute.resolvedAt = Date.now();
    if (dispute.verdict === 'disputant') dispute.filingFeeReturned = true;
  }
}
