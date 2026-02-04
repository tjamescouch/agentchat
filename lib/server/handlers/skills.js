/**
 * Skills Handlers
 * Handles skill registration and search
 */

import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';

/**
 * Handle REGISTER_SKILLS command
 */
export function handleRegisterSkills(server, ws, msg) {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Skill registration requires persistent identity'));
    return;
  }

  // Store skills for this agent
  const registration = {
    agent_id: `@${agent.id}`,
    skills: msg.skills,
    registered_at: Date.now(),
    sig: msg.sig
  };

  server.skillsRegistry.set(agent.id, registration);

  server._log('skills_registered', { agent: agent.id, count: msg.skills.length });

  // Notify the registering agent
  server._send(ws, createMessage(ServerMessageType.SKILLS_REGISTERED, {
    agent_id: `@${agent.id}`,
    skills_count: msg.skills.length,
    registered_at: registration.registered_at
  }));

  // Optionally broadcast to #discovery channel if it exists
  if (server.channels.has('#discovery')) {
    server._broadcast('#discovery', createMessage(ServerMessageType.MSG, {
      from: '@server',
      to: '#discovery',
      content: `Agent @${agent.id} registered ${msg.skills.length} skill(s): ${msg.skills.map(s => s.capability).join(', ')}`
    }));
  }
}

/**
 * Handle SEARCH_SKILLS command
 */
export async function handleSearchSkills(server, ws, msg) {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const query = msg.query || {};
  const results = [];

  // Search through all registered skills
  for (const [agentId, registration] of server.skillsRegistry) {
    for (const skill of registration.skills) {
      let matches = true;

      // Filter by capability (substring match, case-insensitive)
      if (query.capability) {
        const cap = skill.capability.toLowerCase();
        const search = query.capability.toLowerCase();
        if (!cap.includes(search)) {
          matches = false;
        }
      }

      // Filter by max_rate
      if (query.max_rate !== undefined && skill.rate !== undefined) {
        if (skill.rate > query.max_rate) {
          matches = false;
        }
      }

      // Filter by currency
      if (query.currency && skill.currency) {
        if (skill.currency.toLowerCase() !== query.currency.toLowerCase()) {
          matches = false;
        }
      }

      if (matches) {
        results.push({
          agent_id: registration.agent_id,
          ...skill,
          registered_at: registration.registered_at
        });
      }
    }
  }

  // Enrich results with reputation data
  const uniqueAgentIds = [...new Set(results.map(r => r.agent_id))];
  const ratingCache = new Map();
  for (const agentId of uniqueAgentIds) {
    const ratingInfo = await server.reputationStore.getRating(agentId);
    ratingCache.set(agentId, ratingInfo);
  }

  // Add rating info to each result
  for (const result of results) {
    const ratingInfo = ratingCache.get(result.agent_id);
    result.rating = ratingInfo.rating;
    result.transactions = ratingInfo.transactions;
  }

  // Sort by rating (highest first), then by registration time
  results.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.registered_at - a.registered_at;
  });

  // Limit results
  const limit = query.limit || 50;
  const limitedResults = results.slice(0, limit);

  server._log('skills_search', { agent: agent.id, query, results_count: limitedResults.length });

  server._send(ws, createMessage(ServerMessageType.SEARCH_RESULTS, {
    query_id: msg.query_id || null,
    query,
    results: limitedResults,
    total: results.length
  }));
}
