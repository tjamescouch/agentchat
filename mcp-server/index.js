#!/usr/bin/env node

/**
 * AgentChat MCP Server
 * Exposes AgentChat functionality via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AgentChatClient } from '@tjamescouch/agentchat';
import { AgentChatDaemon, getDaemonPaths, isDaemonRunning, stopDaemon } from '@tjamescouch/agentchat/lib/daemon.js';
import { addJitter } from '@tjamescouch/agentchat/lib/jitter.js';
import fs from 'fs';
import path from 'path';

// Global state
let client = null;
let daemon = null;
let serverUrl = null;
let keepaliveInterval = null;

// Keepalive settings
const KEEPALIVE_INTERVAL_MS = 30000; // Ping every 30 seconds

// Default server
const DEFAULT_SERVER_URL = 'wss://agentchat-server.fly.dev';

/**
 * Get identity path for a named agent
 */
function getIdentityPath(name) {
  return path.join(process.cwd(), '.agentchat', 'identities', `${name}.json`);
}

/**
 * Create and configure the MCP server
 */
function createServer() {
  const server = new McpServer({
    name: 'agentchat',
    version: '0.1.0',
  });

  // Tool: Connect to server
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
          keepaliveInterval = null;
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

        const options = {
          server: actualServerUrl,
          name: name || `mcp-agent-${process.pid}`,
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

        client = new AgentChatClient(options);
        await client.connect();
        serverUrl = actualServerUrl;

        // Start keepalive ping to prevent connection timeout
        keepaliveInterval = setInterval(() => {
          try {
            if (client && client.connected) {
              client.ping();
            }
          } catch (e) {
            // Connection likely dead, will reconnect on next tool call
          }
        }, KEEPALIVE_INTERVAL_MS);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agent_id: client.agentId,
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

  // Tool: Send message
  server.tool(
    'agentchat_send',
    'Send a message to a channel (#channel) or agent (@agent)',
    {
      target: z.string().describe('Target: #channel or @agent-id'),
      message: z.string().describe('Message content to send'),
    },
    async ({ target, message }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        // Join channel if needed
        if (target.startsWith('#') && !client.channels.has(target)) {
          await client.join(target);
        }

        await client.send(target, message);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                target,
                message,
                from: client.agentId,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error sending: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Listen for messages
  server.tool(
    'agentchat_listen',
    'Listen for messages on channels and return recent messages',
    {
      channels: z.array(z.string()).describe('Channels to listen on (e.g., ["#general", "#agents"])'),
      max_messages: z.number().optional().default(10).describe('Maximum messages to collect before returning'),
      timeout_ms: z.number().optional().default(5000).describe('Timeout in milliseconds'),
      jitter_percent: z.number().optional().default(0.2).describe('Jitter percentage (0.0-1.0) to add to timeout, prevents deadlock when multiple agents wait simultaneously'),
    },
    async ({ channels, max_messages, timeout_ms, jitter_percent }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        // Join channels
        for (const channel of channels) {
          if (!client.channels.has(channel)) {
            await client.join(channel);
          }
        }

        // Collect messages
        const messages = [];
        const startTime = Date.now();

        return new Promise((resolve) => {
          const messageHandler = (msg) => {
            // Filter out own messages and replays
            if (msg.from !== client.agentId && !msg.replay) {
              messages.push({
                from: msg.from,
                to: msg.to,
                content: msg.content,
                ts: msg.ts,
              });
            }

            if (messages.length >= max_messages) {
              cleanup();
              resolve({
                content: [{ type: 'text', text: JSON.stringify({ messages }) }],
              });
            }
          };

          const cleanup = () => {
            client.removeListener('message', messageHandler);
          };

          client.on('message', messageHandler);

          // Timeout with jitter to prevent deadlock
          const actualTimeout = addJitter(timeout_ms, jitter_percent);
          setTimeout(() => {
            cleanup();
            const silenceDetected = messages.length === 0;
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    messages,
                    timeout: true,
                    elapsed_ms: Date.now() - startTime,
                    actual_timeout_ms: actualTimeout,
                    jitter_applied: actualTimeout !== timeout_ms,
                    // Anti-deadlock hint: when silence detected, suggest breaking it
                    ...(silenceDetected && {
                      silence_hint: 'No messages received. Consider posting to break potential deadlock - all agents may be waiting.',
                    }),
                  }),
                },
              ],
            });
          }, actualTimeout);
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listening: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Wait for messages (event-driven)
  server.tool(
    'agentchat_wait',
    'Wait for messages - returns immediately when a message arrives (event-driven). More efficient than polling with agentchat_listen.',
    {
      channels: z.array(z.string()).describe('Channels to wait on (e.g., ["#general", "#agents"])'),
      timeout_ms: z.number().optional().default(300000).describe('Maximum wait time in milliseconds (default 5 minutes)'),
      jitter_percent: z.number().optional().default(0.2).describe('Jitter percentage (0.0-1.0) to add to timeout'),
      filter_server: z.boolean().optional().default(true).describe('Filter out @server messages (welcome spam)'),
    },
    async ({ channels, timeout_ms, jitter_percent, filter_server }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        // Join channels
        for (const channel of channels) {
          if (!client.channels.has(channel)) {
            await client.join(channel);
          }
        }

        const startTime = Date.now();

        return new Promise((resolve) => {
          const messageHandler = (msg) => {
            // Filter out own messages and replays
            if (msg.from === client.agentId || msg.replay) {
              return;
            }

            // Filter out @server messages if requested
            if (filter_server && msg.from === '@server') {
              return;
            }

            // Got a real message - return immediately
            cleanup();
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: {
                      from: msg.from,
                      to: msg.to,
                      content: msg.content,
                      ts: msg.ts,
                    },
                    waited_ms: Date.now() - startTime,
                  }),
                },
              ],
            });
          };

          const cleanup = () => {
            client.removeListener('message', messageHandler);
          };

          client.on('message', messageHandler);

          // Timeout with jitter
          const actualTimeout = addJitter(timeout_ms, jitter_percent);
          setTimeout(() => {
            cleanup();
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: null,
                    timeout: true,
                    waited_ms: Date.now() - startTime,
                    actual_timeout_ms: actualTimeout,
                    silence_hint: 'No messages received. Consider posting to break potential deadlock.',
                  }),
                },
              ],
            });
          }, actualTimeout);
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error waiting: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: List channels
  server.tool(
    'agentchat_channels',
    'List available channels on the connected server',
    {},
    async () => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const channels = await client.listChannels();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                channels,
                joined: Array.from(client.channels),
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing channels: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Start daemon
  server.tool(
    'agentchat_daemon_start',
    'Start a background daemon for persistent AgentChat connection',
    {
      server_url: z.string().describe('WebSocket URL of the AgentChat server'),
      channels: z.array(z.string()).optional().default(['#general']).describe('Channels to join'),
      identity_path: z.string().optional().describe('Path to identity file'),
      instance: z.string().optional().default('default').describe('Daemon instance name'),
    },
    async ({ server_url, channels, identity_path, instance }) => {
      try {
        // Check if already running
        if (await isDaemonRunning(instance)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Daemon instance '${instance}' is already running`,
                }),
              },
            ],
          };
        }

        const daemonOptions = {
          server: server_url,
          channels,
          identity: identity_path || DEFAULT_IDENTITY_PATH,
          instance,
        };

        daemon = new AgentChatDaemon(daemonOptions);
        await daemon.start();

        const paths = getDaemonPaths(instance);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                instance,
                server: server_url,
                channels,
                inbox: paths.inbox,
                outbox: paths.outbox,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error starting daemon: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Stop daemon
  server.tool(
    'agentchat_daemon_stop',
    'Stop the background AgentChat daemon',
    {
      instance: z.string().optional().default('default').describe('Daemon instance name'),
    },
    async ({ instance }) => {
      try {
        const result = await stopDaemon(instance);

        // Also stop local daemon reference
        if (daemon) {
          await daemon.stop();
          daemon = null;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result,
                instance,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error stopping daemon: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Read inbox
  server.tool(
    'agentchat_inbox',
    'Read messages from the daemon inbox',
    {
      lines: z.number().optional().default(50).describe('Number of recent lines to read'),
      instance: z.string().optional().default('default').describe('Daemon instance name'),
    },
    async ({ lines, instance }) => {
      try {
        const paths = getDaemonPaths(instance);

        if (!fs.existsSync(paths.inbox)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  messages: [],
                  error: 'Inbox file not found. Is the daemon running?',
                }),
              },
            ],
          };
        }

        const content = fs.readFileSync(paths.inbox, 'utf-8');
        const allLines = content.trim().split('\n').filter(Boolean);
        const recentLines = allLines.slice(-lines);

        const messages = [];
        for (const line of recentLines) {
          try {
            messages.push(JSON.parse(line));
          } catch {
            // Skip invalid JSON lines
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                messages,
                total_lines: allLines.length,
                returned_lines: messages.length,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error reading inbox: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

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
