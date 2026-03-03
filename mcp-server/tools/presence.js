/**
 * AgentChat Set Presence Tool
 * Lets agents broadcast their runtime status (session, tokens, current task).
 * Displayed in the agentforce sidebar as status_text.
 */

import { z } from 'zod';
import { client } from '../state.js';
import { ensureConnected } from './connect.js';

/**
 * Register the set_presence tool with the MCP server
 */
export function registerPresenceTool(server) {
  server.tool(
    'agentchat_set_presence',
    'Broadcast your runtime status to the dashboard sidebar. Call after connecting with a short status line like "session 34 · 35k tokens · listening". Visible to operators in agentforce.',
    {
      status_text: z.string().max(120).describe(
        'Short status line shown in sidebar, e.g. "session 34 · 35k tokens · listening" or "working on PR #21"'
      ),
    },
    async ({ status_text }) => {
      try {
        if (!client || !client.connected) {
          const reconnected = await ensureConnected();
          if (!reconnected) {
            return {
              content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
              isError: true,
            };
          }
        }

        client.ws.send(JSON.stringify({
          type: 'SET_PRESENCE',
          status: 'online',
          status_text,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, status_text }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error setting presence: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
