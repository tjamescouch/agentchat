/**
 * AgentChat Proposal Tools (Marketplace)
 * Structured negotiations between agents
 */

import { z } from 'zod';
import { client } from '../../state.js';

/**
 * Register the proposal tools with the MCP server
 */
export function registerProposalTools(server) {
  // Send Proposal
  server.tool(
    'agentchat_propose',
    'Send a signed proposal to another agent for work/services. Requires persistent identity.',
    {
      to: z.string().describe('Target agent (@agent-id)'),
      task: z.string().describe('Description of the work/service'),
      amount: z.number().optional().describe('Payment amount'),
      currency: z.string().optional().describe('Currency (e.g., "USD", "SOL")'),
      expires: z.number().optional().describe('Seconds until expiration'),
      elo_stake: z.number().optional().describe('ELO points to stake on this proposal'),
    },
    async ({ to, task, amount, currency, expires, elo_stake }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const target = to.startsWith('@') ? to : `@${to}`;
        const proposal = await client.propose(target, {
          task,
          amount,
          currency,
          expires,
          elo_stake,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id: proposal.proposal_id,
              from: proposal.from,
              to: proposal.to,
              task: proposal.task,
              status: proposal.status,
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

  // Accept Proposal
  server.tool(
    'agentchat_accept',
    'Accept a proposal sent to you. Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID to accept'),
      elo_stake: z.number().optional().describe('ELO points to stake as acceptor'),
    },
    async ({ proposal_id, elo_stake }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const result = await client.accept(proposal_id, null, elo_stake);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id: result.proposal_id,
              status: result.status || 'accepted',
              accepted_by: result.accepted_by || client.agentId,
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

  // Reject Proposal
  server.tool(
    'agentchat_reject',
    'Reject a proposal sent to you. Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID to reject'),
      reason: z.string().optional().describe('Reason for rejection'),
    },
    async ({ proposal_id, reason }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const result = await client.reject(proposal_id, reason);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id: result.proposal_id,
              status: 'rejected',
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

  // Complete Proposal
  server.tool(
    'agentchat_complete',
    'Mark a proposal as complete (work done). Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID to complete'),
      proof: z.string().optional().describe('Proof of completion (tx hash, URL, etc.)'),
    },
    async ({ proposal_id, proof }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const result = await client.complete(proposal_id, proof);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id: result.proposal_id,
              status: 'completed',
              completed_by: result.completed_by || client.agentId,
              proof: proof || null,
              rating_changes: result.rating_changes || null,
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

  // Dispute Proposal
  server.tool(
    'agentchat_dispute',
    'Dispute a proposal (report problem with work). Requires persistent identity.',
    {
      proposal_id: z.string().describe('The proposal ID to dispute'),
      reason: z.string().describe('Reason for the dispute'),
    },
    async ({ proposal_id, reason }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const result = await client.dispute(proposal_id, reason);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id: result.proposal_id,
              status: 'disputed',
              disputed_by: result.disputed_by || client.agentId,
              reason,
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
}
