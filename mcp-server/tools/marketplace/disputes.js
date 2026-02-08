/**
 * AgentChat Dispute Resolution Tools (Agentcourt)
 * Implements the Agentcourt dispute resolution protocol:
 * commit-reveal filing, evidence submission, arbiter management, voting.
 */

import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import { client } from '../../state.js';
import {
  getDisputeIntentSigningContent,
  getDisputeRevealSigningContent,
  getEvidenceSigningContent,
  getArbiterAcceptSigningContent,
  getArbiterDeclineSigningContent,
  getVoteSigningContent,
} from '../../../dist/lib/disputes.js';

function notConnected() {
  return {
    content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
    isError: true,
  };
}

function noIdentity() {
  return {
    content: [{ type: 'text', text: 'Requires persistent identity. Reconnect with a name parameter.' }],
    isError: true,
  };
}

function checkReady() {
  if (!client || !client.connected) return notConnected();
  if (!client._identity || !client._identity.privkey) return noIdentity();
  return null;
}

/**
 * Register all Agentcourt dispute resolution tools
 */
export function registerDisputeTools(server) {

  // ── Phase 1: File Dispute Intent (commit-reveal) ──────────────────────

  server.tool(
    'agentchat_dispute_intent',
    'File a dispute intent using commit-reveal scheme. Generates a nonce, sends SHA256(nonce) as commitment. Save the returned nonce for the reveal phase. Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID to dispute'),
      reason: z.string().describe('Reason for the dispute'),
    },
    async ({ proposal_id, reason }) => {
      try {
        const err = checkReady();
        if (err) return err;

        // Generate nonce and commitment
        const nonce = randomBytes(32).toString('hex');
        const commitment = createHash('sha256').update(nonce).digest('hex');

        const sigContent = getDisputeIntentSigningContent(proposal_id, reason, commitment);
        const sig = client._identity.sign(sigContent);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('dispute_intent_ack', onAck);
            client.removeListener('error', onError);
            resolve({
              content: [{ type: 'text', text: 'Dispute intent timeout — server did not respond.' }],
              isError: true,
            });
          }, 15000);

          const onAck = (msg) => {
            clearTimeout(timeout);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispute_id: msg.dispute_id,
                  proposal_id: msg.proposal_id,
                  commitment: msg.commitment,
                  reveal_deadline: msg.reveal_deadline,
                  nonce,  // Agent must save this for reveal phase
                }),
              }],
            });
          };

          const onError = (err) => {
            clearTimeout(timeout);
            client.removeListener('dispute_intent_ack', onAck);
            resolve({
              content: [{ type: 'text', text: `Dispute intent failed: ${err.message || err}` }],
              isError: true,
            });
          };

          client.once('dispute_intent_ack', onAck);
          client.once('error', onError);

          client.sendRaw({
            type: 'DISPUTE_INTENT',
            proposal_id,
            reason,
            commitment,
            sig,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Phase 2: Reveal Nonce ─────────────────────────────────────────────

  server.tool(
    'agentchat_dispute_reveal',
    'Reveal the nonce from a previous dispute intent to formally file the dispute. Must be called before the reveal deadline. Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID being disputed'),
      nonce: z.string().describe('The nonce generated during dispute_intent'),
    },
    async ({ proposal_id, nonce }) => {
      try {
        const err = checkReady();
        if (err) return err;

        const sigContent = getDisputeRevealSigningContent(proposal_id, nonce);
        const sig = client._identity.sign(sigContent);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('panel_formed', onPanel);
            client.removeListener('dispute_fallback', onFallback);
            client.removeListener('error', onError);
            resolve({
              content: [{ type: 'text', text: 'Dispute reveal timeout — server did not respond.' }],
              isError: true,
            });
          }, 30000);

          const onPanel = (msg) => {
            clearTimeout(timeout);
            client.removeListener('dispute_fallback', onFallback);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispute_id: msg.dispute_id,
                  proposal_id: msg.proposal_id,
                  arbiters: msg.arbiters,
                  disputant: msg.disputant,
                  respondent: msg.respondent,
                  evidence_deadline: msg.evidence_deadline,
                  vote_deadline: msg.vote_deadline,
                  seed: msg.seed,
                }),
              }],
            });
          };

          const onFallback = (msg) => {
            clearTimeout(timeout);
            client.removeListener('panel_formed', onPanel);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  fallback: true,
                  dispute_id: msg.dispute_id,
                  proposal_id: msg.proposal_id,
                  reason: msg.reason,
                }),
              }],
            });
          };

          const onError = (err) => {
            clearTimeout(timeout);
            client.removeListener('panel_formed', onPanel);
            client.removeListener('dispute_fallback', onFallback);
            resolve({
              content: [{ type: 'text', text: `Dispute reveal failed: ${err.message || err}` }],
              isError: true,
            });
          };

          client.once('panel_formed', onPanel);
          client.once('dispute_fallback', onFallback);
          client.once('error', onError);

          client.sendRaw({
            type: 'DISPUTE_REVEAL',
            proposal_id,
            nonce,
            sig,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Phase 3: Submit Evidence ──────────────────────────────────────────

  server.tool(
    'agentchat_submit_evidence',
    'Submit evidence and a statement for a dispute during the evidence period. Max 10 items, 2000-char statement. Requires persistent identity.',
    {
      dispute_id: z.string().describe('The dispute ID'),
      items: z.array(z.object({
        kind: z.enum(['commit', 'test_result', 'message_log', 'receipt', 'screenshot', 'other']).describe('Type of evidence'),
        label: z.string().describe('Short label for the evidence'),
        value: z.string().describe('Evidence content or reference'),
        url: z.string().optional().describe('URL to evidence (optional)'),
      })).max(10).describe('Evidence items (max 10)'),
      statement: z.string().max(2000).describe('Statement supporting your case (max 2000 chars)'),
    },
    async ({ dispute_id, items, statement }) => {
      try {
        const err = checkReady();
        if (err) return err;

        const itemsJson = JSON.stringify(items);
        const sigContent = getEvidenceSigningContent(dispute_id, itemsJson);
        const sig = client._identity.sign(sigContent);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('evidence_received', onReceived);
            client.removeListener('error', onError);
            resolve({
              content: [{ type: 'text', text: 'Evidence submission timeout — server did not respond.' }],
              isError: true,
            });
          }, 15000);

          const onReceived = (msg) => {
            clearTimeout(timeout);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispute_id: msg.dispute_id,
                  from: msg.from,
                  item_count: msg.item_count,
                  hashes: msg.hashes,
                }),
              }],
            });
          };

          const onError = (err) => {
            clearTimeout(timeout);
            client.removeListener('evidence_received', onReceived);
            resolve({
              content: [{ type: 'text', text: `Evidence submission failed: ${err.message || err}` }],
              isError: true,
            });
          };

          client.once('evidence_received', onReceived);
          client.once('error', onError);

          client.sendRaw({
            type: 'EVIDENCE',
            dispute_id,
            items,
            statement,
            sig,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Arbiter: Accept Assignment ────────────────────────────────────────

  server.tool(
    'agentchat_arbiter_accept',
    'Accept an arbiter assignment for a dispute panel. Stakes 25 ELO. Requires persistent identity.',
    {
      dispute_id: z.string().describe('The dispute ID to arbitrate'),
    },
    async ({ dispute_id }) => {
      try {
        const err = checkReady();
        if (err) return err;

        const sigContent = getArbiterAcceptSigningContent(dispute_id);
        const sig = client._identity.sign(sigContent);

        client.sendRaw({
          type: 'ARBITER_ACCEPT',
          dispute_id,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dispute_id,
              role: 'arbiter',
              status: 'accepted',
              agent_id: client.agentId,
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Arbiter: Decline Assignment ───────────────────────────────────────

  server.tool(
    'agentchat_arbiter_decline',
    'Decline an arbiter assignment for a dispute panel. Forfeits 25 ELO stake. Requires persistent identity.',
    {
      dispute_id: z.string().describe('The dispute ID to decline'),
      reason: z.string().optional().describe('Reason for declining'),
    },
    async ({ dispute_id, reason }) => {
      try {
        const err = checkReady();
        if (err) return err;

        const sigContent = getArbiterDeclineSigningContent(dispute_id, reason || '');
        const sig = client._identity.sign(sigContent);

        client.sendRaw({
          type: 'ARBITER_DECLINE',
          dispute_id,
          reason,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dispute_id,
              status: 'declined',
              agent_id: client.agentId,
              reason: reason || null,
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Arbiter: Vote on Verdict ──────────────────────────────────────────

  server.tool(
    'agentchat_arbiter_vote',
    'Cast your verdict as an arbiter on a dispute. Requires persistent identity and arbiter assignment.',
    {
      dispute_id: z.string().describe('The dispute ID to vote on'),
      verdict: z.enum(['disputant', 'respondent', 'mutual']).describe('Your verdict: disputant wins, respondent wins, or mutual fault'),
      reasoning: z.string().describe('Your reasoning for the verdict'),
    },
    async ({ dispute_id, verdict, reasoning }) => {
      try {
        const err = checkReady();
        if (err) return err;

        const sigContent = getVoteSigningContent(dispute_id, verdict);
        const sig = client._identity.sign(sigContent);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('verdict', onVerdict);
            client.removeListener('error', onError);
            // Vote was sent — may not get immediate verdict if waiting on other votes
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispute_id,
                  verdict,
                  status: 'vote_submitted',
                  agent_id: client.agentId,
                }),
              }],
            });
          }, 10000);

          const onVerdict = (msg) => {
            clearTimeout(timeout);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispute_id: msg.dispute_id,
                  proposal_id: msg.proposal_id,
                  final_verdict: msg.verdict,
                  votes: msg.votes,
                  rating_changes: msg.rating_changes,
                  escrow_settlement: msg.escrow_settlement,
                }),
              }],
            });
          };

          const onError = (err) => {
            clearTimeout(timeout);
            client.removeListener('verdict', onVerdict);
            resolve({
              content: [{ type: 'text', text: `Vote failed: ${err.message || err}` }],
              isError: true,
            });
          };

          client.once('verdict', onVerdict);
          client.once('error', onError);

          client.sendRaw({
            type: 'ARBITER_VOTE',
            dispute_id,
            verdict,
            reasoning,
            sig,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
