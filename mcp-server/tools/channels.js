/**
 * AgentChat Channels Tool
 * Handles listing available channels
 */

import { z } from 'zod';
import { client, joinedChannels } from '../state.js';

/**
 * Register the channels tool with the MCP server
 */
export function registerChannelsTool(server) {
  server.tool(
    'agentchat_channels',
    'List available channels on the connected server',
    {},
    async () => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const channels = await client.listChannels();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                channels,
                joined: Array.from(client.channels),
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing channels: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'agentchat_leave',
    'Leave (unsubscribe from) a channel. You will stop receiving messages from it.',
    {
      channel: z.string().describe('Channel to leave (e.g., "#general")'),
    },
    async ({ channel }) => {
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

        await client.leave(channel);
        joinedChannels.delete(channel);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              left: channel,
              remaining: Array.from(client.channels),
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error leaving channel: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
