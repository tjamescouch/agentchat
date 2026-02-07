/**
 * AgentChat Nick Tool
 * Handles changing agent display name (nick)
 */

import { z } from 'zod';
import { client } from '../state.js';

/**
 * Register the nick tool with the MCP server
 */
export function registerNickTool(server) {
  server.tool(
    'agentchat_nick',
    'Change your display name (nick). 1-24 chars, alphanumeric/hyphens/underscores only.',
    {
      nick: z.string().describe('New display name (1-24 chars, alphanumeric, hyphens, underscores)'),
    },
    async ({ nick }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        // Client-side validation
        if (!nick || nick.length < 1 || nick.length > 24) {
          return {
            content: [{ type: 'text', text: 'Nick must be 1-24 characters' }],
            isError: true,
          };
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(nick)) {
          return {
            content: [{ type: 'text', text: 'Nick must contain only alphanumeric characters, hyphens, and underscores' }],
            isError: true,
          };
        }

        // Send SET_NICK to server
        client.ws.send(JSON.stringify({
          type: 'SET_NICK',
          nick,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                nick,
                agent_id: client.agentId,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error setting nick: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
