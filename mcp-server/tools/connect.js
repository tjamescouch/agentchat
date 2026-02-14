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
  DEFAULT_SERVER_URL, KEEPALIVE_INTERVAL_MS, PONG_STALE_MS,
  RECONNECT_MAX_ATTEMPTS, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS,
  recordPong, isConnectionHealthy, lastPongTime,
  connectionOptions, setConnectionOptions,
  joinedChannels, trackChannel,
  isReconnecting, setReconnecting,
} from '../state.js';
import { appendToInbox } from '../inbox-writer.js';
import { handleIncomingOffer, handleFileChunk, handleTransferComplete } from './file-transfer.js';

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
 * Wire up message handlers on a client instance.
 * Extracted so reconnect can re-attach the same handlers.
 */
function wireMessageHandlers(targetClient) {
  targetClient.on('message', (msg) => {
    // Skip own messages, server noise, and channel replays (P3-LISTEN-7)
    if (msg.from === targetClient.agentId || msg.from === '@server') return;
    if (msg.replay) return;

    // Intercept file transfer protocol messages
    if (msg.content) {
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed._ft === 'offer') {
          handleIncomingOffer({ ...msg, _ft_data: parsed });
        } else if (parsed._ft === 'complete') {
          handleTransferComplete({ ...msg, _ft_data: parsed });
        }
      } catch { /* not JSON, normal message */ }
    }

    appendToInbox({
      type: 'MSG',
      from: msg.from,
      from_name: msg.from_name,
      to: msg.to,
      content: msg.content,
      ts: msg.ts,
    });
  });

  // FILE_CHUNK handler - receives chunked file data
  targetClient.on('file_chunk', (msg) => {
    if (msg.from === targetClient.agentId) return;
    if (msg.content) {
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed._ft === 'chunk') {
          handleFileChunk({ ...msg, _ft_data: parsed });
        }
      } catch { /* not valid file transfer chunk */ }
    }
  });

  // Track pong responses for health monitoring (P1-LISTEN-1)
  targetClient.on('pong', () => {
    recordPong();
  });

  // Track whether this client was displaced by another connection
  let _displaced = false;

  // Inhibit reconnect on session displacement to prevent ping-pong loop
  targetClient.on('session_displaced', () => {
    _displaced = true;
    appendToInbox({
      type: 'MSG',
      from: '@system',
      from_name: 'system',
      to: '#internal',
      content: '[session displaced by another connection — not reconnecting]',
      ts: Date.now(),
    });
  });

  // Auto-reconnect on disconnect (P1-LISTEN-1)
  targetClient.on('disconnect', () => {
    // Don't reconnect if displaced, already reconnecting, or intentional
    if (_displaced) return;
    if (!isReconnecting() && connectionOptions) {
      attemptReconnect();
    }
  });
}

/**
 * Auto-reconnect with exponential backoff (P1-LISTEN-1)
 * Re-creates client, re-wires handlers, re-joins channels.
 */
async function attemptReconnect() {
  if (isReconnecting() || !connectionOptions) return;
  setReconnecting(true);

  const opts = connectionOptions;
  const channels = [...joinedChannels];

  for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter, capped at max delay
      const exponentialDelay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
      const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5) * 2; // +/- 20%
      const delay = Math.max(100, Math.round(exponentialDelay + jitter));
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      // Disconnect old client cleanly
      if (client) {
        try { client.disconnect(); } catch { /* already dead */ }
      }

      const newClient = new AgentChatClient(opts);
      await newClient.connect();

      setClient(newClient);
      recordPong(); // Reset health timer
      wireMessageHandlers(newClient);
      startKeepalive();

      // Re-join channels
      for (const ch of channels) {
        try { await newClient.join(ch); } catch { /* non-fatal */ }
      }

      // Write reconnect event to inbox so listen sees it
      appendToInbox({
        type: 'MSG',
        from: '@system',
        from_name: 'system',
        to: '#internal',
        content: `[reconnected after ${attempt + 1} attempt(s)]`,
        ts: Date.now(),
      });

      setReconnecting(false);
      return;
    } catch (err) {
      // Last attempt failed — log and give up
      if (attempt === RECONNECT_MAX_ATTEMPTS - 1) {
        appendToInbox({
          type: 'MSG',
          from: '@system',
          from_name: 'system',
          to: '#internal',
          content: `[reconnect failed after ${RECONNECT_MAX_ATTEMPTS} attempts — connection lost. Use agentchat_connect to reconnect manually.]`,
          ts: Date.now(),
        });
        setReconnecting(false);
      }
    }
  }
}

/**
 * Start the keepalive interval with health checking (P1-LISTEN-1)
 */
function startKeepalive() {
  // Clear existing keepalive
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    setKeepaliveInterval(null);
  }

  const interval = setInterval(() => {
    try {
      if (!client || !client.connected) {
        // Client reports disconnected — trigger reconnect
        if (!isReconnecting() && connectionOptions) {
          attemptReconnect();
        }
        return;
      }

      // Check if pongs are stale (no pong in >90s means WS is dead)
      if (!isConnectionHealthy()) {
        // Force disconnect to trigger reconnect
        try { client.disconnect(); } catch { /* ignore */ }
        if (!isReconnecting() && connectionOptions) {
          attemptReconnect();
        }
        return;
      }

      client.ping();
    } catch (e) {
      // ping() threw — connection is dead, trigger reconnect
      if (!isReconnecting() && connectionOptions) {
        attemptReconnect();
      }
    }
  }, KEEPALIVE_INTERVAL_MS);

  setKeepaliveInterval(interval);
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
      channels: z.array(z.string()).optional().describe('Channels to auto-join on connect. If omitted, joins #general, #discovery, #bounties by default.'),
    },
    async ({ server_url, name, identity_path, channels: requestedChannels }) => {
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
        // Clear connectionOptions first to prevent auto-reconnect from firing
        setConnectionOptions(null);
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

        // Save connection options for auto-reconnect (P1-LISTEN-1)
        setConnectionOptions(options);
        recordPong(); // Initialize health timer

        // Reset last seen timestamp on new connection
        resetLastSeen();

        // Wire up message, file transfer, pong, and disconnect handlers
        wireMessageHandlers(newClient);

        // Start keepalive with health checking (P1-LISTEN-1)
        startKeepalive();

        // Join channels: explicit list if provided, otherwise defaults
        const autoJoinChannels = requestedChannels && requestedChannels.length > 0
          ? requestedChannels
          : ['#general', '#discovery', '#bounties'];
        for (const ch of autoJoinChannels) {
          try {
            await newClient.join(ch);
            trackChannel(ch);
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
