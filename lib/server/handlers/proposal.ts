/**
 * Proposal Handlers
 * Handles proposal, accept, reject, complete, dispute operations
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type {
  ProposalMessage,
  AcceptMessage,
  RejectMessage,
  CompleteMessage,
  DisputeMessage,
} from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';
import { formatProposal, formatProposalResponse } from '../../proposals.js';
import {
  EscrowEvent,
  createEscrowCreatedPayload,
  createCompletionPayload,
  createDisputePayload,
} from '../../escrow-hooks.js';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

/**
 * Handle PROPOSAL command
 */
export function handleProposal(server: AgentChatServer, ws: ExtendedWebSocket, msg: ProposalMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  // Proposals require a persistent identity (signature verification)
  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Proposals require persistent identity'));
    return;
  }

  const targetId = msg.to.slice(1);
  const targetWs = server.agentById.get(targetId);

  if (!targetWs) {
    server._send(ws, createError(ErrorCode.AGENT_NOT_FOUND, `Agent ${msg.to} not found`));
    return;
  }

  // Redact secrets from proposal task description
  const taskText = server.redactor.clean(msg.task);

  // Create proposal in store
  const proposal = server.proposals.create({
    from: `@${agent.id}`,
    to: msg.to,
    task: taskText,
    amount: msg.amount,
    currency: msg.currency,
    payment_code: (msg as ProposalMessage & { payment_code?: string }).payment_code,
    terms: msg.terms,
    expires: msg.expires,
    sig: msg.sig,
    elo_stake: msg.elo_stake || null
  });

  server._log('proposal', { id: proposal.id, from: agent.id, to: targetId });

  // Send to target
  const outMsg = createMessage(ServerMessageType.PROPOSAL, {
    ...formatProposal(proposal)
  });

  server._send(targetWs, outMsg);
  // Echo back to sender with the assigned ID
  server._send(ws, outMsg);
}

/**
 * Handle ACCEPT command
 */
export async function handleAccept(server: AgentChatServer, ws: ExtendedWebSocket, msg: AcceptMessage & { payment_code?: string }): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Accepting proposals requires persistent identity'));
    return;
  }

  // Get proposal first to check stakes
  const existingProposal = server.proposals.get(msg.proposal_id);
  if (!existingProposal) {
    server._send(ws, createError(ErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found'));
    return;
  }

  const proposerStake = existingProposal.proposer_stake || 0;
  const acceptorStake = msg.elo_stake || 0;

  // Validate proposer can stake (if they declared a stake)
  if (proposerStake > 0) {
    const canProposerStake = await server.reputationStore.canStake(existingProposal.from, proposerStake);
    if (!canProposerStake.canStake) {
      server._send(ws, createError(ErrorCode.INSUFFICIENT_REPUTATION, `Proposer: ${canProposerStake.reason}`));
      return;
    }
  }

  // Validate acceptor can stake (if they declared a stake)
  if (acceptorStake > 0) {
    const canAcceptorStake = await server.reputationStore.canStake(`@${agent.id}`, acceptorStake);
    if (!canAcceptorStake.canStake) {
      server._send(ws, createError(ErrorCode.INSUFFICIENT_REPUTATION, canAcceptorStake.reason));
      return;
    }
  }

  const result = server.proposals.accept(
    msg.proposal_id,
    `@${agent.id}`,
    msg.sig,
    msg.payment_code,
    acceptorStake
  );

  if (result.error) {
    server._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
    return;
  }

  const proposal = result.proposal!;

  // Create escrow if either party has a stake
  if (proposerStake > 0 || acceptorStake > 0) {
    const escrowResult = await server.reputationStore.createEscrow(
      proposal.id,
      { agent_id: proposal.from, stake: proposerStake },
      { agent_id: proposal.to, stake: acceptorStake },
      proposal.expires
    );

    if (escrowResult.success) {
      (proposal as typeof proposal & { stakes_escrowed?: boolean }).stakes_escrowed = true;
      server._log('escrow_created', {
        proposal_id: proposal.id,
        proposer_stake: proposerStake,
        acceptor_stake: acceptorStake
      });

      // Emit escrow:created hook for external integrations
      server.escrowHooks.emit(EscrowEvent.CREATED, createEscrowCreatedPayload(proposal as any, escrowResult))
        .catch((err: Error) => server._log('escrow_hook_error', { event: 'created', error: err.message }));
    } else {
      server._log('escrow_error', { proposal_id: proposal.id, error: escrowResult.error });
    }
  }

  server._log('accept', { id: proposal.id, by: agent.id, proposer_stake: proposerStake, acceptor_stake: acceptorStake });

  // Notify the proposal creator
  const creatorId = proposal.from.slice(1);
  const creatorWs = server.agentById.get(creatorId);

  const outMsg = createMessage(ServerMessageType.ACCEPT, {
    ...formatProposalResponse(proposal, 'accept')
  });

  if (creatorWs) {
    server._send(creatorWs, outMsg);
  }
  // Echo to acceptor
  server._send(ws, outMsg);
}

/**
 * Handle REJECT command
 */
export function handleReject(server: AgentChatServer, ws: ExtendedWebSocket, msg: RejectMessage & { reason?: string }): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Rejecting proposals requires persistent identity'));
    return;
  }

  const result = server.proposals.reject(
    msg.proposal_id,
    `@${agent.id}`,
    msg.sig,
    msg.reason
  );

  if (result.error) {
    server._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
    return;
  }

  const proposal = result.proposal!;
  server._log('reject', { id: proposal.id, by: agent.id });

  // Notify the proposal creator
  const creatorId = proposal.from.slice(1);
  const creatorWs = server.agentById.get(creatorId);

  const outMsg = createMessage(ServerMessageType.REJECT, {
    ...formatProposalResponse(proposal, 'reject')
  });

  if (creatorWs) {
    server._send(creatorWs, outMsg);
  }
  // Echo to rejector
  server._send(ws, outMsg);
}

/**
 * Handle COMPLETE command
 */
export async function handleComplete(server: AgentChatServer, ws: ExtendedWebSocket, msg: CompleteMessage): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Completing proposals requires persistent identity'));
    return;
  }

  const result = server.proposals.complete(
    msg.proposal_id,
    `@${agent.id}`,
    msg.sig,
    msg.proof
  );

  if (result.error) {
    server._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
    return;
  }

  const proposal = result.proposal!;
  server._log('complete', { id: proposal.id, by: agent.id });

  // Update reputation ratings (includes escrow settlement)
  let ratingChanges: Record<string, unknown> | null = null;
  try {
    ratingChanges = await server.reputationStore.processCompletion({
      type: 'COMPLETE',
      proposal_id: proposal.id,
      from: proposal.from,
      to: proposal.to,
      amount: proposal.amount
    });
    server._log('reputation_updated', {
      proposal_id: proposal.id,
      changes: ratingChanges,
      escrow: ratingChanges?._escrow
    });

    // Emit settlement:completion hook for external integrations
    if (ratingChanges?._escrow) {
      server.escrowHooks.emit(EscrowEvent.COMPLETION_SETTLED, createCompletionPayload(proposal as any, ratingChanges))
        .catch((err: Error) => server._log('escrow_hook_error', { event: 'completion', error: err.message }));
    }
  } catch (err) {
    server._log('reputation_error', { error: (err as Error).message });
  }

  // Notify both parties
  const outMsg = createMessage(ServerMessageType.COMPLETE, {
    ...formatProposalResponse(proposal, 'complete'),
    rating_changes: ratingChanges
  });

  // Notify the other party
  const otherId = proposal.from === `@${agent.id}` ? proposal.to.slice(1) : proposal.from.slice(1);
  const otherWs = server.agentById.get(otherId);

  if (otherWs) {
    server._send(otherWs, outMsg);
  }
  // Echo to completer
  server._send(ws, outMsg);
}

/**
 * Handle DISPUTE command
 */
export async function handleDispute(server: AgentChatServer, ws: ExtendedWebSocket, msg: DisputeMessage): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Disputing proposals requires persistent identity'));
    return;
  }

  const result = server.proposals.dispute(
    msg.proposal_id,
    `@${agent.id}`,
    msg.sig,
    msg.reason
  );

  if (result.error) {
    server._send(ws, createError(ErrorCode.INVALID_PROPOSAL, result.error));
    return;
  }

  const proposal = result.proposal!;
  server._log('dispute', { id: proposal.id, by: agent.id, reason: msg.reason });

  // Update reputation ratings (includes escrow settlement)
  let ratingChanges: Record<string, unknown> | null = null;
  try {
    ratingChanges = await server.reputationStore.processDispute({
      type: 'DISPUTE',
      proposal_id: proposal.id,
      from: proposal.from,
      to: proposal.to,
      amount: proposal.amount,
      disputed_by: `@${agent.id}`
    });
    server._log('reputation_updated', {
      proposal_id: proposal.id,
      changes: ratingChanges,
      escrow: ratingChanges?._escrow
    });

    // Emit settlement:dispute hook for external integrations
    if (ratingChanges?._escrow) {
      server.escrowHooks.emit(EscrowEvent.DISPUTE_SETTLED, createDisputePayload(proposal as any, ratingChanges))
        .catch((err: Error) => server._log('escrow_hook_error', { event: 'dispute', error: err.message }));
    }
  } catch (err) {
    server._log('reputation_error', { error: (err as Error).message });
  }

  // Notify both parties
  const outMsg = createMessage(ServerMessageType.DISPUTE, {
    ...formatProposalResponse(proposal, 'dispute'),
    rating_changes: ratingChanges
  });

  // Notify the other party
  const otherId = proposal.from === `@${agent.id}` ? proposal.to.slice(1) : proposal.from.slice(1);
  const otherWs = server.agentById.get(otherId);

  if (otherWs) {
    server._send(otherWs, outMsg);
  }
  // Echo to disputer
  server._send(ws, outMsg);
}
