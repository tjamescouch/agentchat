/**
 * Agentcourt Dispute Handlers
 * Server-side handlers for the panel-based dispute resolution system
 *
 * TODO: Signature verification — sigs are accepted but not cryptographically
 * verified. This is a systemic issue (proposals don't verify either). Should be
 * addressed holistically across proposals + disputes in a follow-up.
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type {
  DisputeIntentMessage,
  DisputeRevealMessage,
  EvidenceMessage,
  ArbiterAcceptMessage,
  ArbiterDeclineMessage,
  ArbiterVoteMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';
import { DISPUTE_CONSTANTS } from '../../disputes.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

/**
 * Build the eligible arbiter pool based on Agentcourt spec criteria
 */
async function buildArbiterPool(
  server: AgentChatServer,
  disputantId: string,
  respondentId: string,
): Promise<string[]> {
  const pool: string[] = [];

  for (const [, agent] of server.agents) {
    const agentId = `@${agent.id}`;

    // Must not be a party
    if (agentId === disputantId || agentId === respondentId) continue;

    // Must have persistent identity
    if (!agent.pubkey) continue;

    // Must not be away
    if (agent.presence === 'away') continue;

    // Check reputation rating >= 1200 and >= 10 transactions
    const rating = await server.reputationStore.getRating(agentId);
    if (!rating || rating.rating < DISPUTE_CONSTANTS.ARBITER_MIN_RATING) continue;
    if (!rating || rating.transactions < DISPUTE_CONSTANTS.ARBITER_MIN_TRANSACTIONS) continue;

    pool.push(agentId);
  }

  return pool;
}

/**
 * Send a message to a specific agent by ID
 */
function sendToAgent(server: AgentChatServer, agentId: string, msg: Record<string, unknown> & { type: string }): void {
  const id = agentId.startsWith('@') ? agentId.slice(1) : agentId;
  const ws = server.agentById.get(id);
  if (ws) {
    server._send(ws, msg as any);
  }
}

/**
 * Handle DISPUTE_INTENT — phase 1 of commit-reveal filing
 */
export function handleDisputeIntent(server: AgentChatServer, ws: ExtendedWebSocket, msg: DisputeIntentMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Filing disputes requires persistent identity'));
    return;
  }

  // Get the proposal
  const proposal = server.proposals.get(msg.proposal_id);
  if (!proposal) {
    server._send(ws, createError(ErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found'));
    return;
  }

  // Must be accepted to dispute
  if (proposal.status !== 'accepted' && proposal.status !== 'disputed') {
    server._send(ws, createError(ErrorCode.INVALID_PROPOSAL, 'Can only dispute accepted proposals'));
    return;
  }

  // Must be a party
  const disputantId = `@${agent.id}`;
  if (proposal.from !== disputantId && proposal.to !== disputantId) {
    server._send(ws, createError(ErrorCode.NOT_PROPOSAL_PARTY, 'Not a party to this proposal'));
    return;
  }

  // Check no existing agentcourt dispute for this proposal
  if (server.disputes.getByProposal(msg.proposal_id)) {
    server._send(ws, createError(ErrorCode.DISPUTE_ALREADY_EXISTS, 'Agentcourt dispute already filed for this proposal'));
    return;
  }

  const respondentId = proposal.from === disputantId ? proposal.to : proposal.from;

  const dispute = server.disputes.fileIntent(
    msg.proposal_id,
    disputantId,
    respondentId,
    msg.reason,
    msg.commitment,
  );

  server._log('dispute_intent', { dispute_id: dispute.id, proposal_id: msg.proposal_id, disputant: agent.id });

  // Set reveal timeout
  server.disputes.setTimeout(dispute.id, DISPUTE_CONSTANTS.REVEAL_TIMEOUT_MS, () => {
    const d = server.disputes.get(dispute.id);
    if (d && d.phase === 'reveal_pending') {
      d.phase = 'fallback';
      d.updated_at = Date.now();
      server._log('dispute_reveal_timeout', { dispute_id: dispute.id });
      sendToAgent(server, disputantId, createMessage(ServerMessageType.DISPUTE_FALLBACK, {
        dispute_id: dispute.id,
        reason: 'Reveal timeout expired',
      }));
    }
  });

  // ACK to disputant
  server._send(ws, createMessage(ServerMessageType.DISPUTE_INTENT_ACK, {
    dispute_id: dispute.id,
    proposal_id: msg.proposal_id,
    server_nonce: dispute.server_nonce,
  }));

  // Notify respondent
  sendToAgent(server, respondentId, createMessage(ServerMessageType.MSG, {
    from: '@server',
    from_name: 'Server',
    to: respondentId,
    content: `Dispute filed against proposal ${msg.proposal_id} by ${disputantId}. Agentcourt panel arbitration in progress.`,
  }));
}

/**
 * Handle DISPUTE_REVEAL — phase 2 of commit-reveal filing
 */
export async function handleDisputeReveal(server: AgentChatServer, ws: ExtendedWebSocket, msg: DisputeRevealMessage): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // Find the dispute by proposal
  const dispute = server.disputes.getByProposal(msg.proposal_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'No pending dispute for this proposal'));
    return;
  }

  // Must be the disputant
  if (dispute.disputant !== `@${agent.id}`) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_PARTY, 'Only the disputant can reveal'));
    return;
  }

  // Attempt reveal (synchronous — phase check + transition is atomic in single-threaded Node.js)
  const revealed = server.disputes.reveal(dispute.id, msg.nonce);
  if (!revealed) {
    server._send(ws, createError(ErrorCode.DISPUTE_COMMITMENT_MISMATCH, 'Nonce does not match commitment'));
    return;
  }

  server.disputes.clearTimeout(dispute.id);
  server._log('dispute_revealed', { dispute_id: dispute.id });

  // Build arbiter pool and select panel
  const pool = await buildArbiterPool(server, dispute.disputant, dispute.respondent);
  const selected = server.disputes.selectPanel(dispute.id, pool);

  if (!selected) {
    // Fallback to legacy
    server._log('dispute_fallback', { dispute_id: dispute.id, pool_size: pool.length });

    const fallbackMsg = createMessage(ServerMessageType.DISPUTE_FALLBACK, {
      dispute_id: dispute.id,
      proposal_id: msg.proposal_id,
      reason: `Insufficient eligible arbiters (${pool.length} available, ${DISPUTE_CONSTANTS.PANEL_SIZE} required)`,
    });
    sendToAgent(server, dispute.disputant, fallbackMsg);
    sendToAgent(server, dispute.respondent, fallbackMsg);
    return;
  }

  // Send PANEL_FORMED to both parties and arbiters
  const d = server.disputes.get(dispute.id)!;
  const panelMsg = createMessage(ServerMessageType.PANEL_FORMED, {
    dispute_id: dispute.id,
    proposal_id: msg.proposal_id,
    arbiters: selected,
    disputant: dispute.disputant,
    respondent: dispute.respondent,
    evidence_deadline: null,  // set after all arbiters accept
    vote_deadline: null,
    seed: d.seed,
    server_nonce: d.server_nonce,
  });

  sendToAgent(server, dispute.disputant, panelMsg);
  sendToAgent(server, dispute.respondent, panelMsg);

  // Send individual assignment to each arbiter
  for (const arbiterId of selected) {
    sendToAgent(server, arbiterId, createMessage(ServerMessageType.ARBITER_ASSIGNED, {
      dispute_id: dispute.id,
      proposal_id: msg.proposal_id,
      disputant: dispute.disputant,
      respondent: dispute.respondent,
      reason: dispute.reason,
      response_deadline: Date.now() + DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
    }));
  }

  // Set arbiter response timeout
  server.disputes.setTimeout(dispute.id, DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS, () => {
    const d = server.disputes.get(dispute.id);
    if (d && d.phase === 'arbiter_response') {
      // Forfeit non-responding arbiters
      for (const slot of d.arbiters) {
        if (slot.status === 'pending') {
          slot.status = 'forfeited';
        }
      }
      // Check if enough accepted
      const accepted = d.arbiters.filter(a => a.status === 'accepted');
      if (accepted.length >= DISPUTE_CONSTANTS.PANEL_SIZE) {
        d.phase = 'evidence';
        d.evidence_deadline = Date.now() + DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS;
        d.updated_at = Date.now();
      } else {
        d.phase = 'fallback';
        d.updated_at = Date.now();
        const msg = createMessage(ServerMessageType.DISPUTE_FALLBACK, {
          dispute_id: d.id,
          reason: 'Insufficient arbiters accepted',
        });
        sendToAgent(server, d.disputant, msg);
        sendToAgent(server, d.respondent, msg);
      }
    }
  });

  server._send(ws, createMessage(ServerMessageType.DISPUTE_REVEALED, {
    dispute_id: dispute.id,
    panel_size: selected.length,
    seed: d.seed,
  }));
}

/**
 * Handle EVIDENCE submission
 */
export function handleEvidence(server: AgentChatServer, ws: ExtendedWebSocket, msg: EvidenceMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const dispute = server.disputes.get(msg.dispute_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
    return;
  }

  const agentId = `@${agent.id}`;
  if (agentId !== dispute.disputant && agentId !== dispute.respondent) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_PARTY, 'Not a party to this dispute'));
    return;
  }

  const success = server.disputes.submitEvidence(
    msg.dispute_id,
    agentId,
    msg.items as any,
    msg.statement,
    msg.sig,
  );

  if (!success) {
    server._send(ws, createError(ErrorCode.DISPUTE_DEADLINE_PASSED, 'Evidence submission failed (deadline passed or limit exceeded)'));
    return;
  }

  server._log('evidence_submitted', { dispute_id: msg.dispute_id, agent: agent.id, items: msg.items.length });

  // Notify all parties and arbiters
  const ackMsg = createMessage(ServerMessageType.EVIDENCE_RECEIVED, {
    dispute_id: msg.dispute_id,
    from: agentId,
    items_count: msg.items.length,
  });

  sendToAgent(server, dispute.disputant, ackMsg);
  sendToAgent(server, dispute.respondent, ackMsg);
  for (const slot of dispute.arbiters) {
    if (slot.status === 'accepted' || slot.status === 'voted') {
      sendToAgent(server, slot.agent_id, ackMsg);
    }
  }
}

/**
 * Handle ARBITER_ACCEPT
 */
export function handleArbiterAccept(server: AgentChatServer, ws: ExtendedWebSocket, msg: ArbiterAcceptMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const dispute = server.disputes.get(msg.dispute_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
    return;
  }

  const agentId = `@${agent.id}`;
  const success = server.disputes.arbiterAccept(msg.dispute_id, agentId);

  if (!success) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_ARBITER, 'Not a pending arbiter for this dispute'));
    return;
  }

  server._log('arbiter_accepted', { dispute_id: msg.dispute_id, arbiter: agent.id });

  // Check if we transitioned to evidence phase
  const d = server.disputes.get(msg.dispute_id)!;
  if (d.phase === 'evidence') {
    server.disputes.clearTimeout(msg.dispute_id);

    // Send evidence period notification to all parties
    const evidenceMsg = createMessage(ServerMessageType.MSG, {
      from: '@server',
      from_name: 'Server',
      to: dispute.disputant,
      content: `All arbiters accepted. Evidence period open until ${new Date(d.evidence_deadline!).toISOString()}. Submit your evidence now.`,
    });
    sendToAgent(server, d.disputant, evidenceMsg);
    sendToAgent(server, d.respondent, { ...evidenceMsg, to: d.respondent });

    // Set evidence deadline timeout
    server.disputes.setTimeout(msg.dispute_id, DISPUTE_CONSTANTS.EVIDENCE_PERIOD_MS, () => {
      const dispute = server.disputes.get(msg.dispute_id);
      if (dispute && dispute.phase === 'evidence') {
        server.disputes.closeEvidence(msg.dispute_id);
        _sendCaseReady(server, msg.dispute_id);
      }
    });
  }
}

/**
 * Handle ARBITER_DECLINE
 */
export async function handleArbiterDecline(server: AgentChatServer, ws: ExtendedWebSocket, msg: ArbiterDeclineMessage): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const dispute = server.disputes.get(msg.dispute_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
    return;
  }

  const agentId = `@${agent.id}`;
  const pool = await buildArbiterPool(server, dispute.disputant, dispute.respondent);
  const replacement = server.disputes.arbiterDecline(msg.dispute_id, agentId, pool);

  server._log('arbiter_declined', { dispute_id: msg.dispute_id, arbiter: agent.id, replacement });

  if (replacement) {
    // Notify the replacement
    sendToAgent(server, replacement, createMessage(ServerMessageType.ARBITER_ASSIGNED, {
      dispute_id: msg.dispute_id,
      proposal_id: dispute.proposal_id,
      disputant: dispute.disputant,
      respondent: dispute.respondent,
      reason: dispute.reason,
      response_deadline: Date.now() + DISPUTE_CONSTANTS.ARBITER_RESPONSE_TIMEOUT_MS,
      is_replacement: true,
    }));
  }

  // Check for fallback
  const d = server.disputes.get(msg.dispute_id)!;
  if (d.phase === 'fallback') {
    const fallbackMsg = createMessage(ServerMessageType.DISPUTE_FALLBACK, {
      dispute_id: msg.dispute_id,
      reason: 'Unable to form arbiter panel after replacements',
    });
    sendToAgent(server, d.disputant, fallbackMsg);
    sendToAgent(server, d.respondent, fallbackMsg);
  }
}

/**
 * Handle ARBITER_VOTE
 */
export function handleArbiterVote(server: AgentChatServer, ws: ExtendedWebSocket, msg: ArbiterVoteMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const dispute = server.disputes.get(msg.dispute_id);
  if (!dispute) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found'));
    return;
  }

  const agentId = `@${agent.id}`;
  const success = server.disputes.castVote(
    msg.dispute_id,
    agentId,
    msg.verdict as import('../../disputes.js').Verdict,
    msg.reasoning,
    msg.sig,
  );

  if (!success) {
    server._send(ws, createError(ErrorCode.DISPUTE_NOT_ARBITER, 'Cannot vote: not an accepted arbiter, wrong phase, or deadline passed'));
    return;
  }

  server._log('arbiter_voted', { dispute_id: msg.dispute_id, arbiter: agent.id, verdict: msg.verdict });

  // Check if dispute is now resolved
  const d = server.disputes.get(msg.dispute_id)!;
  if (d.phase === 'resolved') {
    server.disputes.clearTimeout(msg.dispute_id);
    _sendVerdict(server, msg.dispute_id);
  }
}

// ============ Internal helpers ============

/**
 * Send CASE_READY to all arbiters after evidence period closes
 */
function _sendCaseReady(server: AgentChatServer, disputeId: string): void {
  const dispute = server.disputes.get(disputeId);
  if (!dispute) return;

  const proposal = server.proposals.get(dispute.proposal_id);

  const caseMsg = createMessage(ServerMessageType.CASE_READY, {
    dispute_id: disputeId,
    proposal: proposal ? {
      id: proposal.id,
      from: proposal.from,
      to: proposal.to,
      task: proposal.task,
      amount: proposal.amount,
      currency: proposal.currency,
    } : null,
    disputant: dispute.disputant,
    disputant_evidence: dispute.disputant_evidence || null,
    respondent: dispute.respondent,
    respondent_evidence: dispute.respondent_evidence || null,
    vote_deadline: dispute.vote_deadline,
  });

  for (const slot of dispute.arbiters) {
    if (slot.status === 'accepted') {
      sendToAgent(server, slot.agent_id, caseMsg);
    }
  }

  server._log('case_ready', { dispute_id: disputeId });

  // Set vote deadline timeout
  server.disputes.setTimeout(disputeId, DISPUTE_CONSTANTS.VOTE_PERIOD_MS, () => {
    const d = server.disputes.get(disputeId);
    if (d && d.phase === 'deliberation') {
      server.disputes.forceResolve(disputeId);
      _sendVerdict(server, disputeId);
    }
  });
}

/**
 * Send VERDICT to all parties and arbiters
 */
function _sendVerdict(server: AgentChatServer, disputeId: string): void {
  const dispute = server.disputes.get(disputeId);
  if (!dispute || !dispute.verdict) return;

  // Compute arbiter rewards
  const arbiterResults = dispute.arbiters
    .filter(a => a.status === 'voted' || a.status === 'forfeited')
    .map(slot => {
      if (slot.status === 'forfeited') {
        return {
          arbiter: slot.agent_id,
          verdict: null,
          reasoning: null,
          reward: -DISPUTE_CONSTANTS.ARBITER_STAKE,
        };
      }
      const votedWithMajority = slot.vote?.verdict === dispute.verdict;
      return {
        arbiter: slot.agent_id,
        verdict: slot.vote?.verdict,
        reasoning: slot.vote?.reasoning,
        reward: votedWithMajority ? DISPUTE_CONSTANTS.ARBITER_REWARD : 0,
      };
    });

  const verdictMsg = createMessage(ServerMessageType.VERDICT, {
    dispute_id: disputeId,
    proposal_id: dispute.proposal_id,
    verdict: dispute.verdict,
    votes: dispute.votes.map(v => ({
      arbiter: v.arbiter,
      verdict: v.verdict,
      reasoning: v.reasoning,
    })),
    arbiter_results: arbiterResults,
    resolved_at: dispute.resolved_at,
  });

  // Send to all involved parties
  sendToAgent(server, dispute.disputant, verdictMsg);
  sendToAgent(server, dispute.respondent, verdictMsg);
  for (const slot of dispute.arbiters) {
    sendToAgent(server, slot.agent_id, verdictMsg);
  }

  server._log('verdict', {
    dispute_id: disputeId,
    verdict: dispute.verdict,
    votes: dispute.votes.length,
  });
}
