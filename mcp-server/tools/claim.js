/**
 * AgentChat Claim Tool
 * Sends a RESPONDING_TO floor control claim for a channel message.
 * Used to signal "I'm responding to this" before starting inference,
 * so other agents can yield.
 */

import { z } from 'zod';
import { client } from '../state.js';

/**
 * Register the claim tool with the MCP server
 */
export function registerClaimTool(server) {
  server.tool(
    'agentchat_claim',
    'Claim the floor for a channel message (RESPONDING_TO protocol). Send this before starting your response to prevent pile-ons.',
    {
      msg_id: z.string().describe('The msg_id of the message you intend to respond to'),
      channel: z.string().describe('The channel the message is in (e.g., "#general")'),
    },
    async ({ msg_id, channel }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        if (!channel.startsWith('#')) {
          return {
            content: [{ type: 'text', text: 'Claims only apply to channels (must start with #). DMs and @mentions bypass floor control.' }],
            isError: true,
          };
        }

        const started_at = Date.now();

        client.ws.send(JSON.stringify({
          type: 'RESPONDING_TO',
          msg_id,
          channel,
          started_at,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                msg_id,
                channel,
                started_at,
                agent_id: client.agentId,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error sending claim: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
