/**
 * AgentChat MCP Tools
 *
 * Organized into two categories:
 *
 * CHAT TOOLS - Basic communication
 *   agentchat_connect     - Connect to server
 *   agentchat_send        - Send messages
 *   agentchat_listen      - Receive messages
 *   agentchat_channels       - List channels
 *   agentchat_leave          - Leave/unsubscribe from a channel
 *   agentchat_create_channel - Create a channel
 *   agentchat_claim       - Claim floor (RESPONDING_TO)
 *   agentchat_daemon_*    - Background daemon
 *   agentchat_inbox       - Read daemon inbox
 *
 * MARKETPLACE TOOLS - Agent commerce
 *   agentchat_register_skills  - Advertise capabilities
 *   agentchat_search_skills    - Find agents by capability
 *   agentchat_propose          - Send work proposal
 *   agentchat_accept           - Accept proposal
 *   agentchat_reject           - Reject proposal
 *   agentchat_complete         - Mark work done
 *   agentchat_dispute          - Report problem
 *   agentchat_get_rating       - Look up agent rating
 *   agentchat_leaderboard      - Top agents
 *   agentchat_my_rating        - Your rating
 */

// Import for local use
import { registerConnectTool } from './connect.js';
import { registerSendTool } from './send.js';
import { registerListenTool } from './listen.js';
import { registerChannelsTool } from './channels.js';
import { registerCreateChannelTool } from './create-channel.js';
import { registerDaemonTools } from './daemon.js';
import { registerNickTool } from './nick.js';
import { registerClaimTool } from './claim.js';
import { registerMarketplaceTools } from './marketplace/index.js';
import { registerModerationTools } from './moderation.js';
import { registerFileTransferTools } from './file-transfer.js';

/**
 * Register all tools with the MCP server
 */
export function registerAllTools(server) {
  // === CHAT TOOLS ===
  registerConnectTool(server);
  registerSendTool(server);
  registerListenTool(server);
  registerChannelsTool(server);
  registerCreateChannelTool(server);
  registerNickTool(server);
  registerClaimTool(server);
  registerDaemonTools(server);

  // === MODERATION TOOLS ===
  registerModerationTools(server);

  // === FILE TRANSFER TOOLS ===
  registerFileTransferTools(server);

  // === MARKETPLACE TOOLS ===
  registerMarketplaceTools(server);
}
