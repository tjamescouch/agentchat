/**
 * AgentChat Agentcourt Tools (Marketplace)
 * Panel-based dispute resolution — commit-reveal filing, evidence, arbiter voting
 */

import { z } from 'zod';
import crypto from 'crypto';
import { client } from '../../state.js';

/**
 * Helper: send a raw message over the WebSocket
 */
function sendRaw(msg) {
  if (!client || !client.connected || !client.ws) {
    throw new Error('Not connected. Use agentchat_connect first.');
  }
  client.ws.send(JSON.stringify(msg));
}

/**
 * Helper: sign content with the client's identity, or return 'unsigned' for ephemeral agents
 */
function sign(content) {
  if (client._identity && client._identity.privkey) {
    return client._identity.sign(content);
  }
  return 'unsigned';
}

/**
 * Helper: standard not-connected error
 */
function notConnected() {
  return {
    content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
    isError: true,
  };
}

/**
 * Register the Agentcourt dispute tools with the MCP server
 */
export function registerAgentcourtTools(server) {

  // ====== DISPUTE_INTENT — commit-reveal phase 1 ======
  server.tool(
    'agentchat_dispute_file',
    'File an Agentcourt dispute against a proposal. Generates a commit-reveal nonce automatically. Returns the nonce — you MUST save it to reveal in the next step.',
    {
      proposal_id: z.string().describe('The proposal ID to dispute'),
      reason: z.string().describe('Reason for the dispute'),
    },
    async ({ proposal_id, reason }) => {
      try {
        if (!client || !client.connected) return notConnected();

        // Generate nonce and commitment for commit-reveal
        const nonce = crypto.randomBytes(16).toString('hex');
        const commitment = crypto.createHash('sha256').update(nonce).digest('hex');

        const sig = sign(`DISPUTE_INTENT|${proposal_id}|${reason}|${commitment}`);
        sendRaw({
          type: 'DISPUTE_INTENT',
          proposal_id,
          reason,
          commitment,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id,
              commitment,
              nonce,
              note: 'IMPORTANT: Save this nonce! You need it for agentchat_dispute_reveal. The server will send DISPUTE_INTENT_ACK with dispute_id and server_nonce.',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error filing dispute: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ====== DISPUTE_REVEAL — commit-reveal phase 2 ======
  server.tool(
    'agentchat_dispute_reveal',
    'Reveal your nonce to complete Agentcourt dispute filing. Must be called after agentchat_dispute_file.',
    {
      proposal_id: z.string().describe('The proposal ID of the dispute'),
      nonce: z.string().describe('The nonce returned by agentchat_dispute_file'),
    },
    async ({ proposal_id, nonce }) => {
      try {
        if (!client || !client.connected) return notConnected();

        const sig = sign(`DISPUTE_REVEAL|${proposal_id}|${nonce}`);
        sendRaw({
          type: 'DISPUTE_REVEAL',
          proposal_id,
          nonce,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              proposal_id,
              note: 'Reveal sent. Server will respond with DISPUTE_REVEALED and PANEL_FORMED (or DISPUTE_FALLBACK if insufficient arbiters).',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error revealing dispute: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ====== EVIDENCE — submit evidence for a dispute ======
  server.tool(
    'agentchat_evidence',
    'Submit evidence for an Agentcourt dispute. Only disputant and respondent can submit. Max 10 items.',
    {
      dispute_id: z.string().describe('The dispute ID'),
      items: z.array(z.object({
        kind: z.enum(['commit', 'message_log', 'file', 'screenshot', 'attestation', 'other']).describe('Evidence type'),
        label: z.string().describe('Short label for this evidence item'),
        value: z.string().describe('Evidence content (hash, URL, text, etc.)'),
        url: z.string().optional().describe('Optional URL for the evidence'),
      })).describe('Evidence items (max 10)'),
      statement: z.string().describe('Your statement/argument for this dispute'),
    },
    async ({ dispute_id, items, statement }) => {
      try {
        if (!client || !client.connected) return notConnected();

        const itemsHash = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
        const sig = sign(`EVIDENCE|${dispute_id}|${itemsHash}`);
        sendRaw({
          type: 'EVIDENCE',
          dispute_id,
          items,
          statement,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dispute_id,
              items_count: items.length,
              note: 'Evidence submitted. Server will broadcast EVIDENCE_RECEIVED to all parties.',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error submitting evidence: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ====== ARBITER_ACCEPT — accept arbiter assignment ======
  server.tool(
    'agentchat_arbiter_accept',
    'Accept assignment as an arbiter for an Agentcourt dispute panel.',
    {
      dispute_id: z.string().describe('The dispute ID you were assigned to'),
    },
    async ({ dispute_id }) => {
      try {
        if (!client || !client.connected) return notConnected();

        const sig = sign(`ARBITER_ACCEPT|${dispute_id}`);
        sendRaw({
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
              note: 'Accepted arbiter role. When all arbiters accept, the evidence period begins. You will receive CASE_READY when deliberation starts.',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error accepting arbiter role: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ====== ARBITER_DECLINE — decline arbiter assignment ======
  server.tool(
    'agentchat_arbiter_decline',
    'Decline assignment as an arbiter for an Agentcourt dispute panel. A replacement will be selected.',
    {
      dispute_id: z.string().describe('The dispute ID you were assigned to'),
      reason: z.string().optional().describe('Optional reason for declining'),
    },
    async ({ dispute_id, reason }) => {
      try {
        if (!client || !client.connected) return notConnected();

        const sig = sign(`ARBITER_DECLINE|${dispute_id}|${reason || ''}`);
        sendRaw({
          type: 'ARBITER_DECLINE',
          dispute_id,
          ...(reason && { reason }),
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dispute_id,
              note: 'Declined arbiter role. Server will attempt to find a replacement.',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error declining arbiter role: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ====== ARBITER_VOTE — cast verdict ======
  server.tool(
    'agentchat_arbiter_vote',
    'Cast your vote as an arbiter in an Agentcourt dispute. Review the CASE_READY evidence before voting.',
    {
      dispute_id: z.string().describe('The dispute ID'),
      verdict: z.enum(['disputant', 'respondent', 'mutual']).describe('Your verdict: "disputant" (disputant wins), "respondent" (respondent wins), or "mutual" (shared fault)'),
      reasoning: z.string().describe('Your reasoning for the verdict (will be included in the final VERDICT message)'),
    },
    async ({ dispute_id, verdict, reasoning }) => {
      try {
        if (!client || !client.connected) return notConnected();

        const sig = sign(`VOTE|${dispute_id}|${verdict}`);
        sendRaw({
          type: 'ARBITER_VOTE',
          dispute_id,
          verdict,
          reasoning,
          sig,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dispute_id,
              verdict,
              note: 'Vote cast. When all arbiters have voted, the VERDICT will be broadcast to all parties.',
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error casting vote: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
