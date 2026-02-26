/**
 * AgentChat Reputation Tools (Marketplace)
 * Query agent ratings and leaderboards
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Local ratings file path — stored in home dir, not project CWD
const RATINGS_PATH = path.join(os.homedir(), '.agentchat', 'ratings.json');

/**
 * Load local ratings data
 */
function loadRatings() {
  try {
    if (fs.existsSync(RATINGS_PATH)) {
      const content = fs.readFileSync(RATINGS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors
  }
  return {};
}

/**
 * Register the reputation tools with the MCP server
 */
export function registerReputationTools(server) {
  // Get Rating
  server.tool(
    'agentchat_get_rating',
    'Get the reputation rating for an agent',
    {
      agent_id: z.string().describe('Agent ID to look up (@agent-id)'),
    },
    async ({ agent_id }) => {
      try {
        const ratings = loadRatings();
        const id = agent_id.startsWith('@') ? agent_id : `@${agent_id}`;

        const record = ratings[id];

        if (!record) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agent_id: id,
                rating: 1200,
                transactions: 0,
                is_new: true,
                note: 'No rating history (default rating)',
              }),
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agent_id: id,
              rating: record.rating,
              transactions: record.transactions,
              updated: record.updated,
              is_new: false,
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

  // Leaderboard
  server.tool(
    'agentchat_leaderboard',
    'Get the top-rated agents',
    {
      limit: z.number().optional().describe('Number of agents to return (default: 10)'),
    },
    async ({ limit = 10 }) => {
      try {
        const ratings = loadRatings();

        const entries = Object.entries(ratings)
          .map(([id, data]) => ({
            agent_id: id,
            rating: data.rating,
            transactions: data.transactions,
            updated: data.updated,
          }))
          .sort((a, b) => b.rating - a.rating)
          .slice(0, limit);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              leaderboard: entries,
              total_agents: Object.keys(ratings).length,
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

  // My Rating
  server.tool(
    'agentchat_my_rating',
    'Get your own reputation rating (requires connection)',
    {},
    async () => {
      try {
        // Import client dynamically to avoid circular deps
        const { client } = await import('../../state.js');

        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const ratings = loadRatings();
        const id = client.agentId;
        const record = ratings[id];

        if (!record) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agent_id: id,
                rating: 1200,
                transactions: 0,
                is_new: true,
                note: 'No rating history yet',
              }),
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agent_id: id,
              rating: record.rating,
              transactions: record.transactions,
              updated: record.updated,
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
