/**
 * AgentChat Moderation Tools
 * Admin-only kick and ban operations
 */

import { z } from 'zod';
import { client } from '../state.js';

/**
 * Register moderation tools with the MCP server
 */
export function registerModerationTools(server) {
  server.tool(
    'agentchat_kick',
    'Kick an agent (immediate disconnect). Requires AGENTCHAT_ADMIN_KEY env var.',
    {
      target: z.string().describe('Agent ID to kick (@agent-id)'),
      reason: z.string().optional().describe('Reason for kick'),
    },
    async ({ target, reason }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const adminKey = process.env.AGENTCHAT_ADMIN_KEY;
        if (!adminKey) {
          return {
            content: [{ type: 'text', text: 'AGENTCHAT_ADMIN_KEY environment variable not set' }],
            isError: true,
          };
        }

        client.ws.send(JSON.stringify({
          type: 'ADMIN_KICK',
          agent_id: target,
          admin_key: adminKey,
          ...(reason ? { reason } : {}),
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, action: 'kick', target }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error kicking: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'agentchat_ban',
    'Ban an agent (persistent block + kick if online). Requires AGENTCHAT_ADMIN_KEY env var.',
    {
      target: z.string().describe('Agent ID to ban (@agent-id)'),
      reason: z.string().optional().describe('Reason for ban'),
    },
    async ({ target, reason }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const adminKey = process.env.AGENTCHAT_ADMIN_KEY;
        if (!adminKey) {
          return {
            content: [{ type: 'text', text: 'AGENTCHAT_ADMIN_KEY environment variable not set' }],
            isError: true,
          };
        }

        client.ws.send(JSON.stringify({
          type: 'ADMIN_BAN',
          agent_id: target,
          admin_key: adminKey,
          ...(reason ? { reason } : {}),
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, action: 'ban', target }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error banning: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'agentchat_unban',
    'Unban a previously banned agent. Requires AGENTCHAT_ADMIN_KEY env var.',
    {
      target: z.string().describe('Agent ID to unban (@agent-id)'),
    },
    async ({ target }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const adminKey = process.env.AGENTCHAT_ADMIN_KEY;
        if (!adminKey) {
          return {
            content: [{ type: 'text', text: 'AGENTCHAT_ADMIN_KEY environment variable not set' }],
            isError: true,
          };
        }

        client.ws.send(JSON.stringify({
          type: 'ADMIN_UNBAN',
          agent_id: target,
          admin_key: adminKey,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, action: 'unban', target }),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error unbanning: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
