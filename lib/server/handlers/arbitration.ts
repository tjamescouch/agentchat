/**
 * Agentcourt Arbitration Handlers
 * Handles dispute resolution via panel-based arbitration
 */

import type { AgentChatServer } from '../../server.js';
import type {
  DisputeIntentMessage,
  DisputeRevealMessage,
  EvidenceMessage,
  ArbiterAcceptMessage,
  ArbiterDeclineMessage,
  ArbiterVoteMessage,
} from '../../types.js';
import { ServerMessageType, ErrorCode } from '../../types.js';
import { createMessage, createError } from '../../protocol.js';
import { ARBITRATION_CONSTANTS } from '../../arbitration.js';

type ExtendedWebSocket = Parameters<AgentChatServer['_send']>[0];

// ============ Helpers ============

function requireAuth(server: AgentChatServer, ws: ExtendedWebSocket) {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return null;
  }
  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Arbitration requires persistent identity'));
    return null;
  }
  return agent;
}

function getEligibleArbiters(server: AgentChatServer, disputantId: string, respondentId: string): string[] {
  const eligible: string[] = [];
  for (const [, agent] of server.agents) {
    const agentId = `@${agent.id}`;
    if (agentId === disputantId || agentId === respondentId) continue;
    if (!agent.pubkey) continue;
    if (agent.presence === 'away' || agent.presence === 'offline') continue;

    // Check active panel count
    const panelCount = server.arbitrationStore.activePanelCount(agentId);
    if (panelCount >= 3) continue;

    eligible.push(agentId);
  }
  return eligible;
}

// ============ Handlers ============

export async function handleDisputeIntent(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: DisputeIntentMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;

  // Get the proposal
  const proposal = server.proposals.get(msg.proposal_id);
  if (!proposal) {
    server._send(ws, createError(ErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found'));
    return;
  }

  // Only parties to the proposal can file
  if (proposal.from !== agentId && proposal.to !== agentId) {
    server._send(ws, createError(ErrorCode.NOT_PROPOSAL_PARTY, 'Not a party to this proposal'));
    return;
  }

  // Must be an accepted proposal
  if (proposal.status !== 'accepted') {
    server._send(ws, createError(ErrorCode.INVALID_DISPUTE, 'Can only dispute accepted proposals'));
    return;
  }

  const respondentId = proposal.from === agentId ? proposal.to : proposal.from;

  const result = server.arbitrationStore.createIntent(
    msg.proposal_id,
    agentId,
    respondentId,
    msg.reason,
    msg.commitment,
  );

  if ('error' in result) {
    server._send(ws, createError(ErrorCode.DISPUTE_ALREADY_EXISTS, result.error));
    return;
  }

  server._log('dispute_intent', { dispute_id: result.id, proposal_id: msg.proposal_id, by: agent.id });

  // Notify disputant (confirm intent received)
  server._send(ws, createMessage('DISPUTE_INTENT' as any, {
    dispute_id: result.id,
    proposal_id: msg.proposal_id,
    status: 'intent',
  }));
}

export async function handleDisputeReveal(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: DisputeRevealMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;

  // Find dispute by proposal
  const dispute = server.arbitrationStore.getByProposal(msg.proposal_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'No dispute intent for this proposal'));
    return;
  }

  if (dispute.disputantId !== agentId) {
    server._send(ws, createError(ErrorCode.NOT_PROPOSAL_PARTY, 'Only the disputant can reveal'));
    return;
  }

  const result = server.arbitrationStore.revealNonce(dispute.id, msg.nonce);
  if ('error' in result) {
    server._send(ws, createError(ErrorCode.INVALID_DISPUTE, result.error));
    return;
  }

  server._log('dispute_filed', { dispute_id: dispute.id, proposal_id: msg.proposal_id });

  // Now select panel
  const eligiblePool = getEligibleArbiters(server, dispute.disputantId, dispute.respondentId);
  const panelResult = server.arbitrationStore.selectPanel(dispute.id, eligiblePool);

  if ('error' in panelResult) {
    server._send(ws, createError(ErrorCode.INVALID_DISPUTE, panelResult.error));
    return;
  }

  if (panelResult.status === 'fallback') {
    // Not enough arbiters — fall back to legacy dispute
    server._log('dispute_fallback', { dispute_id: dispute.id, pool_size: eligiblePool.length });

    const fallbackMsg = createMessage(ServerMessageType.DISPUTE_FALLBACK, {
      dispute_id: dispute.id,
      proposal_id: dispute.proposalId,
      reason: `Insufficient eligible arbiters (${eligiblePool.length} available, ${ARBITRATION_CONSTANTS.PANEL_SIZE} required)`,
    });

    server._send(ws, fallbackMsg);
    const otherId = dispute.respondentId.slice(1);
    const otherWs = server.agentById.get(otherId);
    if (otherWs) server._send(otherWs, fallbackMsg);
    return;
  }

  // Panel formed — notify everyone
  const panel = panelResult.panel!;
  const arbiterIds = panel.arbiters.map(a => a.agentId);

  const panelFormedMsg = createMessage(ServerMessageType.PANEL_FORMED, {
    proposal_id: dispute.proposalId,
    dispute_id: dispute.id,
    arbiters: arbiterIds,
    disputant: dispute.disputantId,
    respondent: dispute.respondentId,
    evidence_deadline: Date.now() + ARBITRATION_CONSTANTS.EVIDENCE_PERIOD_MS,
    vote_deadline: Date.now() + ARBITRATION_CONSTANTS.EVIDENCE_PERIOD_MS + ARBITRATION_CONSTANTS.VOTE_PERIOD_MS,
    seed: panel.seed,
    server_nonce: panel.serverNonce,
  });

  // Notify both parties
  server._send(ws, panelFormedMsg);
  const respondentWs = server.agentById.get(dispute.respondentId.slice(1));
  if (respondentWs) server._send(respondentWs, panelFormedMsg);

  // Notify each arbiter individually
  for (const arb of panel.arbiters) {
    const arbWs = server.agentById.get(arb.agentId.slice(1));
    if (arbWs) {
      server._send(arbWs, createMessage(ServerMessageType.ARBITER_ASSIGNED, {
        dispute_id: dispute.id,
        proposal_id: dispute.proposalId,
        disputant: dispute.disputantId,
        respondent: dispute.respondentId,
        reason: dispute.reason,
        response_deadline: Date.now() + ARBITRATION_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
      }));
    }
  }
}

export async function handleArbiterAccept(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: ArbiterAcceptMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;
  const result = server.arbitrationStore.arbiterAccept(msg.dispute_id, agentId);

  if ('error' in result) {
    server._send(ws, createError(ErrorCode.ARBITER_NOT_ON_PANEL, result.error));
    return;
  }

  server._log('arbiter_accept', { dispute_id: msg.dispute_id, arbiter: agent.id });

  // If all accepted and moved to evidence, notify parties
  if (result.status === 'evidence') {
    const proposal = server.proposals.get(result.proposalId);
    const caseInfo = {
      dispute_id: result.id,
      status: 'evidence',
      evidence_deadline: result.evidenceDeadline,
    };

    // Notify both parties that evidence phase has begun
    const disputantWs = server.agentById.get(result.disputantId.slice(1));
    const respondentWs = server.agentById.get(result.respondentId.slice(1));
    const evidenceOpenMsg = createMessage('EVIDENCE_OPEN' as any, caseInfo);
    if (disputantWs) server._send(disputantWs, evidenceOpenMsg);
    if (respondentWs) server._send(respondentWs, evidenceOpenMsg);
  }

  server._send(ws, createMessage('ARBITER_ACCEPTED' as any, {
    dispute_id: msg.dispute_id,
    status: result.status,
  }));
}

export async function handleArbiterDecline(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: ArbiterDeclineMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;
  const eligiblePool = getEligibleArbiters(
    server,
    server.arbitrationStore.get(msg.dispute_id)?.disputantId ?? '',
    server.arbitrationStore.get(msg.dispute_id)?.respondentId ?? '',
  );

  const result = server.arbitrationStore.arbiterDecline(msg.dispute_id, agentId, eligiblePool);

  if ('error' in result) {
    server._send(ws, createError(ErrorCode.ARBITER_NOT_ON_PANEL, result.error));
    return;
  }

  server._log('arbiter_decline', { dispute_id: msg.dispute_id, arbiter: agent.id, status: result.status });

  if (result.status === 'fallback') {
    const fallbackMsg = createMessage(ServerMessageType.DISPUTE_FALLBACK, {
      dispute_id: result.id,
      proposal_id: result.proposalId,
      reason: 'Too many arbiter declines; falling back to legacy resolution',
    });

    const disputantWs = server.agentById.get(result.disputantId.slice(1));
    const respondentWs = server.agentById.get(result.respondentId.slice(1));
    if (disputantWs) server._send(disputantWs, fallbackMsg);
    if (respondentWs) server._send(respondentWs, fallbackMsg);
  } else {
    // Notify the new replacement arbiter
    const newArbiter = result.panel!.arbiters[result.panel!.arbiters.length - 1];
    const newArbWs = server.agentById.get(newArbiter.agentId.slice(1));
    if (newArbWs) {
      server._send(newArbWs, createMessage(ServerMessageType.ARBITER_ASSIGNED, {
        dispute_id: result.id,
        proposal_id: result.proposalId,
        disputant: result.disputantId,
        respondent: result.respondentId,
        reason: result.reason,
        response_deadline: Date.now() + ARBITRATION_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
      }));
    }
  }
}

export async function handleEvidence(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: EvidenceMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;
  const result = server.arbitrationStore.submitEvidence(
    msg.dispute_id,
    agentId,
    msg.items,
    msg.statement,
    msg.sig,
  );

  if ('error' in result) {
    server._send(ws, createError(ErrorCode.INVALID_DISPUTE, result.error));
    return;
  }

  server._log('evidence_submitted', { dispute_id: msg.dispute_id, from: agent.id, items: msg.items.length });

  // Notify all parties and arbiters
  const hashes = (agentId === result.disputantId ? result.disputantEvidence : result.respondentEvidence)!
    .items.map(i => i.hash!);

  const evidenceMsg = createMessage(ServerMessageType.EVIDENCE_RECEIVED, {
    dispute_id: msg.dispute_id,
    from: agentId,
    item_count: msg.items.length,
    hashes,
  });

  // Notify other party
  const otherId = result.disputantId === agentId ? result.respondentId : result.disputantId;
  const otherWs = server.agentById.get(otherId.slice(1));
  if (otherWs) server._send(otherWs, evidenceMsg);

  // Notify arbiters
  if (result.panel) {
    for (const arb of result.panel.arbiters) {
      if (arb.status === 'accepted' || arb.status === 'voted') {
        const arbWs = server.agentById.get(arb.agentId.slice(1));
        if (arbWs) server._send(arbWs, evidenceMsg);
      }
    }
  }

  // Confirm to submitter
  server._send(ws, evidenceMsg);

  // Auto-close evidence if both parties have submitted
  if (result.disputantEvidence && result.respondentEvidence) {
    const closeResult = server.arbitrationStore.closeEvidence(msg.dispute_id);
    if (!('error' in closeResult)) {
      sendCaseReady(server, closeResult);
    }
  }
}

export async function handleArbiterVote(
  server: AgentChatServer,
  ws: ExtendedWebSocket,
  msg: ArbiterVoteMessage,
): Promise<void> {
  const agent = requireAuth(server, ws);
  if (!agent) return;

  const agentId = `@${agent.id}`;
  const result = server.arbitrationStore.castVote(
    msg.dispute_id,
    agentId,
    msg.verdict,
    msg.reasoning,
    msg.sig,
  );

  if ('error' in result) {
    server._send(ws, createError(ErrorCode.ARBITER_NOT_ON_PANEL, result.error));
    return;
  }

  server._log('arbiter_vote', { dispute_id: msg.dispute_id, arbiter: agent.id, verdict: msg.verdict });

  server._send(ws, createMessage('VOTE_RECORDED' as any, {
    dispute_id: msg.dispute_id,
    status: result.dispute.status,
  }));

  if (result.resolved) {
    await settleVerdict(server, result.dispute);
  }
}

// ============ Internal ============

function sendCaseReady(server: AgentChatServer, dispute: any): void {
  const proposal = server.proposals.get(dispute.proposalId);

  const caseReadyMsg = createMessage(ServerMessageType.CASE_READY, {
    dispute_id: dispute.id,
    proposal: {
      id: dispute.proposalId,
      from: proposal?.from ?? dispute.disputantId,
      to: proposal?.to ?? dispute.respondentId,
      task: proposal?.task ?? '',
      amount: proposal?.amount ?? null,
      currency: proposal?.currency ?? null,
    },
    disputant: dispute.disputantId,
    disputant_evidence: dispute.disputantEvidence
      ? { items: dispute.disputantEvidence.items, statement: dispute.disputantEvidence.statement }
      : null,
    respondent: dispute.respondentId,
    respondent_evidence: dispute.respondentEvidence
      ? { items: dispute.respondentEvidence.items, statement: dispute.respondentEvidence.statement }
      : null,
    vote_deadline: dispute.voteDeadline,
  });

  // Send to arbiters only
  if (dispute.panel) {
    for (const arb of dispute.panel.arbiters) {
      if (arb.status === 'accepted') {
        const arbWs = server.agentById.get(arb.agentId.slice(1));
        if (arbWs) server._send(arbWs, caseReadyMsg);
      }
    }
  }
}

async function settleVerdict(server: AgentChatServer, dispute: any): Promise<void> {
  // Get ratings for all involved agents
  const allAgents = [
    dispute.disputantId,
    dispute.respondentId,
    ...dispute.panel.arbiters.map((a: any) => a.agentId),
  ];

  const ratings: Record<string, { rating: number; transactions: number }> = {};
  for (const id of allAgents) {
    try {
      const r = await server.reputationStore.getRating(id);
      ratings[id] = { rating: r.rating, transactions: r.transactions };
    } catch {
      ratings[id] = { rating: 1200, transactions: 0 };
    }
  }

  const ratingChanges = server.arbitrationStore.calculateRatingChanges(dispute, ratings);
  const verdictResult = server.arbitrationStore.buildVerdictResult(dispute, ratingChanges);

  // Apply rating changes
  for (const [agentId, change] of Object.entries(ratingChanges)) {
    if (change.change !== 0) {
      try {
        // Use processDispute/processCompletion or direct adjustment
        // For now, we rely on the caller to apply via reputationStore
        server._log('rating_change', { agent: agentId, ...change });
      } catch (err) {
        server._log('rating_error', { agent: agentId, error: (err as Error).message });
      }
    }
  }

  // Broadcast verdict
  const verdictMsg = createMessage(ServerMessageType.VERDICT, {
    dispute_id: dispute.id,
    proposal_id: dispute.proposalId,
    verdict: dispute.verdict,
    votes: verdictResult.votes,
    rating_changes: ratingChanges,
    escrow_settlement: verdictResult.escrowSettlement,
  });

  // Notify parties
  const disputantWs = server.agentById.get(dispute.disputantId.slice(1));
  const respondentWs = server.agentById.get(dispute.respondentId.slice(1));
  if (disputantWs) server._send(disputantWs, verdictMsg);
  if (respondentWs) server._send(respondentWs, verdictMsg);

  // Notify arbiters
  for (const arb of dispute.panel.arbiters) {
    if (arb.vote) {
      const arbWs = server.agentById.get(arb.agentId.slice(1));
      if (arbWs) server._send(arbWs, verdictMsg);
    }
  }

  server._log('verdict', {
    dispute_id: dispute.id,
    verdict: dispute.verdict,
    rating_changes: ratingChanges,
  });
}
