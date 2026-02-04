/**
 * AgentChat Connect Tool
 * Handles connection to AgentChat servers
 */

import { z } from 'zod';
import { AgentChatClient } from '@tjamescouch/agentchat';
import fs from 'fs';
import path from 'path';
import {
  client, keepaliveInterval,
  setClient, setServerUrl, setKeepaliveInterval,
  resetLastSeen,
  DEFAULT_SERVER_URL, KEEPALIVE_INTERVAL_MS
} from '../state.js';

/**
 * Get identity path for a named agent
 */
function getIdentityPath(name) {
  return path.join(process.cwd(), '.agentchat', 'identities', `${name}.json`);
}

/**
 * Register the connect tool with the MCP server
 */
export function registerConnectTool(server) {
  server.tool(
    'agentchat_connect',
    'Connect to an AgentChat server for real-time agent communication',
    {
      server_url: z.string().optional().describe('WebSocket URL (default: wss://agentchat-server.fly.dev)'),
      name: z.string().optional().describe('Agent name for persistent identity. Creates .agentchat/identities/<name>.json. Omit for ephemeral identity.'),
      identity_path: z.string().optional().describe('Custom path to identity file (overrides name)'),
    },
    async ({ server_url, name, identity_path }) => {
      try {
        // Stop existing keepalive
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          setKeepaliveInterval(null);
        }

        // Disconnect existing client
        if (client) {
          client.disconnect();
        }

        const actualServerUrl = server_url || DEFAULT_SERVER_URL;

        // Determine identity path: explicit path > named > ephemeral (none)
        let actualIdentityPath = null;
        if (identity_path) {
          actualIdentityPath = identity_path;
        } else if (name) {
          actualIdentityPath = getIdentityPath(name);
        }
        // If neither provided, identity stays null = ephemeral

        // Generate friendly anon name for ephemeral connections
        const anonId = Math.random().toString(36).substring(2, 8);
        const displayName = name || `anon_${anonId}`;

        const options = {
          server: actualServerUrl,
          name: displayName,
        };

        // Set up persistent identity if path specified
        if (actualIdentityPath) {
          const identityDir = path.dirname(actualIdentityPath);
          if (!fs.existsSync(identityDir)) {
            fs.mkdirSync(identityDir, { recursive: true });
          }
          // Use identity if it exists, otherwise client will create one
          if (fs.existsSync(actualIdentityPath)) {
            options.identity = actualIdentityPath;
          }
        }

        const newClient = new AgentChatClient(options);
        await newClient.connect();
        setClient(newClient);
        setServerUrl(actualServerUrl);

        // Reset last seen timestamp on new connection
        resetLastSeen();

        // Start keepalive ping to prevent connection timeout
        const interval = setInterval(() => {
          try {
            if (client && client.connected) {
              client.ping();
            }
          } catch (e) {
            // Connection likely dead, will reconnect on next tool call
          }
        }, KEEPALIVE_INTERVAL_MS);
        setKeepaliveInterval(interval);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agent_id: newClient.agentId,
                server: actualServerUrl,
                persistent: !!actualIdentityPath,
                identity_path: actualIdentityPath,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error connecting: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
