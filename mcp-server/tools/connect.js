/**
 * AgentChat Connect Tool
 * Handles connection to AgentChat servers
 */

import { z } from 'zod';
import { AgentChatClient, checkDirectorySafety } from '@tjamescouch/agentchat';
import fs from 'fs';
import path from 'path';
import {
  client, keepaliveInterval,
  setClient, setServerUrl, setKeepaliveInterval,
  resetLastSeen,
  DEFAULT_SERVER_URL, KEEPALIVE_INTERVAL_MS
} from '../state.js';
import { appendToInbox } from '../inbox-writer.js';

/**
 * Base directory for identities
 */
const IDENTITIES_DIR = path.join(process.cwd(), '.agentchat', 'identities');

/**
 * Validate that a path stays within the allowed directory
 * Prevents path traversal attacks
 */
function isPathWithinDir(targetPath, allowedDir) {
  const resolved = path.resolve(targetPath);
  const resolvedAllowed = path.resolve(allowedDir);
  return resolved.startsWith(resolvedAllowed + path.sep) || resolved === resolvedAllowed;
}

/**
 * Sanitize agent name to prevent path traversal
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return null;
  // Only allow alphanumeric, hyphens, underscores
  return name.replace(/[^a-zA-Z0-9_-]/g, '') || null;
}

/**
 * Get identity path for a named agent
 */
function getIdentityPath(name) {
  const safeName = sanitizeName(name);
  if (!safeName) return null;
  return path.join(IDENTITIES_DIR, `${safeName}.json`);
}

/**
 * Register the connect tool with the MCP server
 */
export function registerConnectTool(server) {
  server.tool(
    'agentchat_connect',
    'Connect to an AgentChat server for real-time agent communication',
    {
      server_url: z.string().optional().describe('WebSocket URL (default: ws://localhost:6667, or wss://agentchat-server.fly.dev if AGENTCHAT_PUBLIC=true)'),
      name: z.string().optional().describe('Agent name for persistent identity. Creates .agentchat/identities/<name>.json. Omit for ephemeral identity.'),
      identity_path: z.string().optional().describe('Custom path to identity file (overrides name)'),
    },
    async ({ server_url, name, identity_path }) => {
      try {
        // Security check: prevent running in root/system directories
        const safetyCheck = checkDirectorySafety(process.cwd());
        if (safetyCheck.level === 'error') {
          return {
            content: [{ type: 'text', text: `Security Error: ${safetyCheck.error}` }],
            isError: true,
          };
        }

        // Stop existing keepalive
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          setKeepaliveInterval(null);
        }

        // Disconnect existing client and wait briefly for server to process
        if (client) {
          client.disconnect();
          await new Promise(r => setTimeout(r, 100));
        }

        const actualServerUrl = server_url || DEFAULT_SERVER_URL;

        // Determine identity path: explicit path > named > ephemeral (none)
        // All paths must stay within .agentchat/ for security
        const AGENTCHAT_DIR = path.join(process.cwd(), '.agentchat');
        let actualIdentityPath = null;

        if (identity_path) {
          // Validate custom path stays within .agentchat/
          if (!isPathWithinDir(identity_path, AGENTCHAT_DIR)) {
            return {
              content: [{ type: 'text', text: 'Error: identity_path must be within .agentchat/ directory' }],
              isError: true,
            };
          }
          actualIdentityPath = identity_path;
        } else if (name) {
          actualIdentityPath = getIdentityPath(name);
          if (!actualIdentityPath) {
            return {
              content: [{ type: 'text', text: 'Error: invalid agent name (use alphanumeric, hyphens, underscores only)' }],
              isError: true,
            };
          }
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
          // Always pass identity path - client will load existing or create new
          options.identity = actualIdentityPath;
        }

        // Connect with retry for challenge-response race conditions
        const MAX_RETRIES = 3;
        const RETRY_DELAYS = [0, 500, 1500];
        let newClient;
        let lastError;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          }
          try {
            newClient = new AgentChatClient(options);
            await newClient.connect();
            break;
          } catch (err) {
            lastError = err;
            const isRetryable = err.message && (
              err.message.includes('Challenge expired') ||
              err.message.includes('Challenge not found') ||
              err.message.includes('WebSocket closed before challenge')
            );
            if (!isRetryable || attempt === MAX_RETRIES - 1) {
              throw err;
            }
          }
        }

        setClient(newClient);
        setServerUrl(actualServerUrl);

        // Reset last seen timestamp on new connection
        resetLastSeen();

        // Persistent message handler - writes ALL messages to inbox.jsonl so
        // listen always has a single source of truth (same file the daemon uses).
        newClient.on('message', (msg) => {
          // Skip own messages and server noise
          if (msg.from === newClient.agentId || msg.from === '@server') return;
          appendToInbox({
            type: 'MSG',
            from: msg.from,
            from_name: msg.from_name,
            to: msg.to,
            content: msg.content,
            ts: msg.ts,
          });
        });

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

        // Auto-join marketplace channels for discoverability
        for (const ch of ['#general', '#discovery', '#bounties']) {
          try {
            await newClient.join(ch);
          } catch {
            // Non-fatal: channel may not exist on older servers
          }
        }

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
                marketplace: {
                  hint: 'Register skills with agentchat_register_skills, find work with agentchat_search_skills, send proposals with agentchat_propose',
                  channels: {
                    '#discovery': 'Skill registration announcements',
                    '#bounties': 'Open work proposals',
                  },
                },
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
