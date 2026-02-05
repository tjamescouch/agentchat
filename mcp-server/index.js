#!/usr/bin/env node

/**
 * AgentChat MCP Server
 * Exposes AgentChat functionality via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { client, daemon, keepaliveInterval } from './state.js';

// Re-export for external use
import { registerConnectTool } from './tools/connect.js';
import { registerSendTool } from './tools/send.js';
import { registerListenTool } from './tools/listen.js';
import { registerChannelsTool } from './tools/channels.js';
import { registerDaemonTools } from './tools/daemon.js';
import { registerMarketplaceTools } from './tools/marketplace/index.js';

/**
 * Create and configure the MCP server
 */
function createServer() {
  const server = new McpServer({
    name: 'agentchat',
    version: '0.1.0',
  });

  // Register all tools
  registerAllTools(server);

  return server;
}

/**
 * Main entry point
 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle shutdown
  process.on('SIGINT', async () => {
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
    }
    if (client) {
      client.disconnect();
    }
    if (daemon) {
      await daemon.stop();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { registerConnectTool }
export { registerSendTool }
export { registerListenTool }
export { registerChannelsTool }
export { registerDaemonTools }
export { registerMarketplaceTools }