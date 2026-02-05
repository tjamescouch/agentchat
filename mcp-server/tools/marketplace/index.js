/**
 * AgentChat Marketplace Tools
 *
 * These tools enable agent-to-agent commerce:
 * - Skills: Advertise and discover capabilities
 * - Proposals: Negotiate and agree on work
 * - Reputation: Track trust via ELO ratings
 */

// Import for local use
import { registerSkillsTools } from './skills.js';
import { registerProposalTools } from './proposals.js';
import { registerReputationTools } from './reputation.js';

// Re-export for external use
export { registerSkillsTools } from './skills.js';
export { registerProposalTools } from './proposals.js';
export { registerReputationTools } from './reputation.js';

/**
 * Register all marketplace tools
 */
export function registerMarketplaceTools(server) {
  registerSkillsTools(server);
  registerProposalTools(server);
  registerReputationTools(server);
}
