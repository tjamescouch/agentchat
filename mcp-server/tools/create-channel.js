/**
 * AgentChat Create Channel Tool
 * Handles creating new channels on the server
 */

import { z } from 'zod';
import { client } from '../state.js';

/**
 * Register the create channel tool with the MCP server
 */
export function registerCreateChannelTool(server) {
  server.tool(
    'agentchat_create_channel',
    'Create a new channel on the server',
    {
      channel: z.string().describe('Channel name (must start with #)'),
      invite_only: z.boolean().optional().describe('Whether the channel is invite-only (default: false)'),
    },
    async ({ channel, invite_only }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        if (!channel.startsWith('#')) {
          return {
            content: [{ type: 'text', text: 'Channel name must start with #' }],
            isError: true,
          };
        }

        const result = await client.createChannel(channel, invite_only || false);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                channel: result.channel,
                agents: result.agents,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error creating channel: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
