/**
 * AgentChat MCP Tools Index
 * Exports all tool registration functions
 */

export { registerConnectTool } from './connect.js';
export { registerSendTool } from './send.js';
export { registerListenTool } from './listen.js';
export { registerChannelsTool } from './channels.js';
export { registerDaemonTools } from './daemon.js';

/**
 * Register all tools with the MCP server
 */
export function registerAllTools(server) {
  registerConnectTool(server);
  registerSendTool(server);
  registerListenTool(server);
  registerChannelsTool(server);
  registerDaemonTools(server);
}
