/**
 * AgentChat Listen Tool
 * Handles listening for messages with inbox checking for missed messages
 */

import { z } from 'zod';
import fs from 'fs';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';
import { addJitter } from '@tjamescouch/agentchat/lib/jitter.js';
import { client, getLastSeen, updateLastSeen } from '../state.js';

/**
 * Register the listen tool with the MCP server
 */
export function registerListenTool(server) {
  server.tool(
    'agentchat_listen',
    'Listen for messages - returns missed messages from inbox first, then blocks for new ones. No timeout by default (waits forever).',
    {
      channels: z.array(z.string()).describe('Channels to listen on (e.g., ["#general"])'),
      timeout_ms: z.number().optional().describe('Optional timeout in milliseconds. Omit to wait forever.'),
    },
    async ({ channels, timeout_ms }) => {
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
        const lastSeen = getLastSeen();

        // Check daemon inbox for missed messages first
        const paths = getDaemonPaths('default');
        let missedMessages = [];

        if (fs.existsSync(paths.inbox)) {
          try {
            const content = fs.readFileSync(paths.inbox, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);

            for (const line of lines) {
              try {
                const msg = JSON.parse(line);

                // Skip if not a message type or missing timestamp
                if (msg.type !== 'MSG' || !msg.ts) continue;

                // Skip messages we've already seen
                if (msg.ts <= lastSeen) continue;

                // Skip own messages and server messages
                if (msg.from === client.agentId || msg.from === '@server') continue;

                // Only include messages for our channels (including DMs)
                const isRelevantChannel = channels.includes(msg.to);
                const isDMToUs = msg.to === client.agentId;
                if (!isRelevantChannel && !isDMToUs) continue;

                missedMessages.push({
                  from: msg.from,
                  to: msg.to,
                  content: msg.content,
                  ts: msg.ts,
                });
              } catch {
                // Skip invalid JSON lines
              }
            }

            // Sort by timestamp ascending (oldest first)
            missedMessages.sort((a, b) => a.ts - b.ts);
          } catch {
            // Inbox read error, continue to blocking listen
          }
        }

        // If we have missed messages, return them immediately
        if (missedMessages.length > 0) {
          // Update last seen to the newest message timestamp
          const newestTs = missedMessages[missedMessages.length - 1].ts;
          updateLastSeen(newestTs);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  messages: missedMessages,
                  from_inbox: true,
                  elapsed_ms: Date.now() - startTime,
                }),
              },
            ],
          };
        }

        // No missed messages, wait for new ones
        return new Promise((resolve) => {
          let timeoutId = null;

          const messageHandler = (msg) => {
            // Filter out own messages, replays, and server messages
            if (msg.from === client.agentId || msg.replay || msg.from === '@server') {
              return;
            }

            // Update last seen timestamp
            if (msg.ts) {
              updateLastSeen(msg.ts);
            }

            // Got a real message - return immediately
            cleanup();
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    messages: [{
                      from: msg.from,
                      to: msg.to,
                      content: msg.content,
                      ts: msg.ts,
                    }],
                    from_inbox: false,
                    elapsed_ms: Date.now() - startTime,
                  }),
                },
              ],
            });
          };

          const cleanup = () => {
            client.removeListener('message', messageHandler);
            if (timeoutId) clearTimeout(timeoutId);
          };

          client.on('message', messageHandler);

          // Only set timeout if specified
          if (timeout_ms) {
            const actualTimeout = addJitter(timeout_ms, 0.2);
            timeoutId = setTimeout(() => {
              cleanup();
              resolve({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      messages: [],
                      timeout: true,
                      elapsed_ms: Date.now() - startTime,
                    }),
                  },
                ],
              });
            }, actualTimeout);
          }
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listening: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}
