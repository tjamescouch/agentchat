/**
 * AgentChat Skills Tools (Marketplace)
 * Register and search for agent capabilities
 */

import { z } from 'zod';
import crypto from 'crypto';
import { client } from '../../state.js';

/**
 * Register the skills tools with the MCP server
 */
export function registerSkillsTools(server) {
  // Register Skills
  server.tool(
    'agentchat_register_skills',
    'Register your capabilities in the marketplace. Requires persistent identity.',
    {
      skills: z.array(z.object({
        capability: z.string().describe('Skill identifier (e.g., "code_review", "data_analysis")'),
        description: z.string().optional().describe('What you can do'),
        rate: z.number().optional().describe('Your rate for this service'),
        currency: z.string().optional().describe('Currency (e.g., "USD", "SOL", "TEST")'),
      })).describe('Array of skills to register'),
    },
    async ({ skills }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        if (!client._identity || !client._identity.privkey) {
          return {
            content: [{ type: 'text', text: 'Skill registration requires persistent identity. Reconnect with a name parameter.' }],
            isError: true,
          };
        }

        // Sign the skills array (must match server's getRegisterSkillsSigningContent format)
        const hash = crypto.createHash('sha256').update(JSON.stringify(skills)).digest('hex');
        const sig = client._identity.sign(`REGISTER_SKILLS|${hash}`);

        // Send registration
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('skills_registered', onRegistered);
            client.removeListener('error', onError);
            resolve({
              content: [{ type: 'text', text: 'Registration timeout' }],
              isError: true,
            });
          }, 10000);

          const onRegistered = (msg) => {
            clearTimeout(timeout);
            client.removeListener('error', onError);
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  agent_id: msg.agent_id,
                  skills_count: msg.skills_count,
                  registered_at: msg.registered_at,
                }),
              }],
            });
          };

          const onError = (err) => {
            clearTimeout(timeout);
            client.removeListener('skills_registered', onRegistered);
            resolve({
              content: [{ type: 'text', text: `Registration failed: ${err.message}` }],
              isError: true,
            });
          };

          client.once('skills_registered', onRegistered);
          client.once('error', onError);

          client.sendRaw({
            type: 'REGISTER_SKILLS',
            skills,
            sig,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Search Skills
  server.tool(
    'agentchat_search_skills',
    'Search the marketplace for agents with specific capabilities',
    {
      capability: z.string().optional().describe('Filter by capability (substring match)'),
      max_rate: z.number().optional().describe('Maximum rate filter'),
      currency: z.string().optional().describe('Filter by currency'),
      limit: z.number().optional().describe('Max results (default: 10)'),
    },
    async ({ capability, max_rate, currency, limit }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const query = {};
        if (capability) query.capability = capability;
        if (max_rate !== undefined) query.max_rate = max_rate;
        if (currency) query.currency = currency;
        if (limit) query.limit = limit;

        const queryId = `q_${Date.now()}`;

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            client.removeListener('search_results', onResults);
            resolve({
              content: [{ type: 'text', text: 'Search timeout' }],
              isError: true,
            });
          }, 10000);

          const onResults = (msg) => {
            if (msg.query_id === queryId) {
              clearTimeout(timeout);
              resolve({
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    results: msg.results,
                    total: msg.total,
                    query: msg.query,
                  }),
                }],
              });
            }
          };

          client.on('search_results', onResults);

          client.sendRaw({
            type: 'SEARCH_SKILLS',
            query,
            query_id: queryId,
          });
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
