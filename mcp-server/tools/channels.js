/**
 * AgentChat Channels Tool
 * Handles listing available channels
 */

import { client } from '../state.js';

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
}
