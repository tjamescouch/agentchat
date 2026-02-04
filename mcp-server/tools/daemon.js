/**
 * AgentChat Daemon Tools
 * Handles daemon start, stop, and inbox reading
 */

import { z } from 'zod';
import fs from 'fs';
import { AgentChatDaemon, getDaemonPaths, isDaemonRunning, stopDaemon } from '@tjamescouch/agentchat/lib/daemon.js';
import { DEFAULT_IDENTITY_PATH } from '@tjamescouch/agentchat/lib/identity.js';
import { daemon, setDaemon } from '../state.js';

/**
 * Register all daemon-related tools with the MCP server
 */
export function registerDaemonTools(server) {
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

        const newDaemon = new AgentChatDaemon(daemonOptions);
        await newDaemon.start();
        setDaemon(newDaemon);

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
          setDaemon(null);
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
}
