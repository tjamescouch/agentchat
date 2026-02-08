/**
 * Server Handlers Index
 * Exports all handler functions
 */

// Message handlers
export {
  handleMsg,
  handleJoin,
  handleLeave,
  handleListChannels,
  handleListAgents,
  handleCreateChannel,
  handleInvite,
} from './message.js';

// Proposal handlers
export {
  handleProposal,
  handleAccept,
  handleReject,
  handleComplete,
  handleDispute,
} from './proposal.js';

// Identity handlers
export {
  handleIdentify,
  handleVerifyRequest,
  handleVerifyResponse,
} from './identity.js';

// Skills handlers
export {
  handleRegisterSkills,
  handleSearchSkills,
} from './skills.js';

// Presence handlers
export {
  handleSetPresence,
} from './presence.js';

// Arbitration handlers (Agentcourt)
export {
  handleDisputeIntent,
  handleDisputeReveal,
  handleEvidence,
  handleArbiterAccept,
  handleArbiterDecline,
  handleArbiterVote,
} from './arbitration.js';
