/**
 * Skills Handlers
 * Handles skill registration and search
 */

import type { WebSocket } from 'ws';
import type { AgentChatServer } from '../../server.js';
import type { RegisterSkillsMessage, SearchSkillsMessage, Skill } from '../../types.js';
import {
  ServerMessageType,
  ErrorCode,
  createMessage,
  createError,
} from '../../protocol.js';
import { Identity } from '../../identity.js';
import crypto from 'crypto';

// Extended WebSocket with custom properties
interface ExtendedWebSocket extends WebSocket {
  _connectedAt?: number;
  _realIp?: string;
  _userAgent?: string;
}

// Skill registration entry
interface SkillRegistration {
  agent_id: string;
  skills: Skill[];
  registered_at: number;
  sig: string;
}

// Search result with additional fields
interface SkillSearchResult extends Skill {
  agent_id: string;
  registered_at: number;
  rating?: number;
  transactions?: number;
}

/**
 * Create signing content for skill registration
 */
function getRegisterSkillsSigningContent(skills: Skill[]): string {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(skills))
    .digest('hex');
  return `REGISTER_SKILLS|${hash}`;
}

/**
 * Handle REGISTER_SKILLS command
 */
export function handleRegisterSkills(server: AgentChatServer, ws: ExtendedWebSocket, msg: RegisterSkillsMessage): void {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  if (!agent.pubkey) {
    server._send(ws, createError(ErrorCode.SIGNATURE_REQUIRED, 'Skill registration requires persistent identity'));
    return;
  }

  // Verify signature
  const sigContent = getRegisterSkillsSigningContent(msg.skills);
  if (!Identity.verify(sigContent, msg.sig, agent.pubkey)) {
    server._log('sig_verification_failed', { agent: agent.id, msg_type: 'REGISTER_SKILLS' });
    server._send(ws, createError(ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
    return;
  }

  // Store skills for this agent
  const registration: SkillRegistration = {
    agent_id: `@${agent.id}`,
    skills: msg.skills,
    registered_at: Date.now(),
    sig: msg.sig
  };

  server.skillsRegistry.set(agent.id, registration);

  // Persist to disk
  server.skillsStore.register(agent.id, registration).catch(err => {
    server._log('skills_persist_error', { agent: agent.id, error: err.message });
  });

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
      from_name: 'Server',
      to: '#discovery',
      content: `Agent @${agent.id} registered ${msg.skills.length} skill(s): ${msg.skills.map(s => s.capability).join(', ')}`
    }));
  }
}

/**
 * Handle SEARCH_SKILLS command
 */
export async function handleSearchSkills(server: AgentChatServer, ws: ExtendedWebSocket, msg: SearchSkillsMessage): Promise<void> {
  const agent = server.agents.get(ws);
  if (!agent) {
    server._send(ws, createError(ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
    return;
  }

  const query = msg.query || {};
  const results: SkillSearchResult[] = [];

  // Search through all registered skills
  for (const [, registration] of server.skillsRegistry) {
    for (const skill of (registration as SkillRegistration).skills) {
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
          agent_id: (registration as SkillRegistration).agent_id,
          ...skill,
          registered_at: (registration as SkillRegistration).registered_at
        });
      }
    }
  }

  // Enrich results with reputation data
  const uniqueAgentIds = [...new Set(results.map(r => r.agent_id))];
  const ratingCache = new Map<string, { rating: number; transactions: number }>();
  for (const agentId of uniqueAgentIds) {
    const ratingInfo = await server.reputationStore.getRating(agentId);
    ratingCache.set(agentId, ratingInfo);
  }

  // Add rating info to each result
  for (const result of results) {
    const ratingInfo = ratingCache.get(result.agent_id);
    if (ratingInfo) {
      result.rating = ratingInfo.rating;
      result.transactions = ratingInfo.transactions;
    }
  }

  // Sort by rating (highest first), then by registration time
  results.sort((a, b) => {
    if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
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
