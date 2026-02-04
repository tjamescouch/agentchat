/**
 * AgentChat Send Tool
 * Handles sending messages to channels and agents
 */

import { z } from 'zod';
import { client } from '../state.js';

/**
 * Register the send tool with the MCP server
 */
export function registerSendTool(server) {
  server.tool(
    'agentchat_send',
    'Send a message to a channel (#channel) or agent (@agent)',
    {
      target: z.string().describe('Target: #channel or @agent-id'),
      message: z.string().describe('Message content to send'),
    },
    async ({ target, message }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        // Join channel if needed
        if (target.startsWith('#') && !client.channels.has(target)) {
          await client.join(target);
        }

        await client.send(target, message);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                target,
                message,
                from: client.agentId,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error sending: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
