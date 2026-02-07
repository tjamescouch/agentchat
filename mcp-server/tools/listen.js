/**
 * AgentChat Listen Tool
 * Handles listening for messages with inbox checking for missed messages
 */

import { z } from 'zod';
import fs from 'fs';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';
import { addJitter } from '@tjamescouch/agentchat/lib/jitter.js';
import { ClientMessageType } from '@tjamescouch/agentchat/lib/protocol.js';
import { client, getLastSeen, updateLastSeen, drainMessageBuffer, getIdleCount, incrementIdleCount, resetIdleCount } from '../state.js';

// Timeouts - agent cannot override these
const ENFORCED_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour when alone
const NUDGE_TIMEOUT_MS = 30 * 1000; // 30 seconds when others are present
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minute cap on backoff

/**
 * Register the listen tool with the MCP server
 */
export function registerListenTool(server) {
  server.tool(
    'agentchat_listen',
    'Listen for messages - blocks until a message arrives. If others are in the channel, returns after ~30s with nudge:true so you can take initiative. If alone, waits up to 1 hour.',
    {
      channels: z.array(z.string()).describe('Channels to listen on (e.g., ["#general"])'),
    },
    async ({ channels }) => {
      try {
        if (!client || !client.connected) {
          return {
            content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
            isError: true,
          };
        }

        const startTime = Date.now();

        // Collect replay messages during channel joins
        // The server sends buffered messages with { replay: true } on join,
        // so we must capture them before they're emitted and lost
        const replayMessages = [];
        const replayHandler = (msg) => {
          if (msg.replay && msg.from !== client.agentId && msg.from !== '@server') {
            replayMessages.push({
              from: msg.from,
              to: msg.to,
              content: msg.content,
              ts: msg.ts,
            });
          }
        };
        client.on('message', replayHandler);

        // Join/rejoin channels (replay messages arrive here)
        // Always rejoin to get fresh replay — server handles rejoin idempotently
        for (const channel of channels) {
          await client.join(channel);
        }

        // Done collecting replays
        client.removeListener('message', replayHandler);

        // Check channel occupancy to determine timeout behavior
        let othersPresent = false;
        let channelOccupancy = {};

        for (const channel of channels) {
          if (channel.startsWith('#')) {
            try {
              const agents = await client.listAgents(channel);
              const others = agents.filter((a) => a !== client.agentId);
              channelOccupancy[channel] = agents.length;
              if (others.length > 0) {
                othersPresent = true;
              }
            } catch {
              // Ignore errors, default to long timeout
            }
          }
        }
        const lastSeen = getLastSeen();

        // Set presence to 'listening' so other agents see we're active
        const setPresence = (status) => {
          client.sendRaw({ type: ClientMessageType.SET_PRESENCE, status });
        };
        setPresence('listening');

        // Drain the persistent message buffer (messages captured between listen calls)
        const buffered = drainMessageBuffer().filter(m => {
          // Filter to relevant channels/DMs, skip already-seen messages
          const isRelevant = channels.includes(m.to) || m.to === client.agentId;
          return isRelevant && (!m.ts || m.ts > lastSeen);
        });

        // Start with buffered messages + replay messages captured during join
        const paths = getDaemonPaths('default');
        let missedMessages = [...buffered, ...replayMessages];

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

        // If we have missed messages (from replay or inbox), return them immediately
        if (missedMessages.length > 0) {
          // Deduplicate by timestamp + from (replay and inbox may overlap)
          const seen = new Set();
          missedMessages = missedMessages.filter((m) => {
            const key = `${m.ts}:${m.from}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          // Sort by timestamp ascending (oldest first)
          missedMessages.sort((a, b) => a.ts - b.ts);

          // Update last seen to the newest message timestamp
          const newestTs = missedMessages[missedMessages.length - 1].ts;
          updateLastSeen(newestTs);
          resetIdleCount();

          setPresence('online');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  messages: missedMessages,
                  from_inbox: replayMessages.length === 0,
                  from_replay: replayMessages.length > 0,
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

            // Got a real message - return immediately, reset backoff
            resetIdleCount();
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
            setPresence('online');
          };

          client.on('message', messageHandler);

          // Exponential backoff: increase timeout on consecutive idle cycles
          const idleCount = getIdleCount();
          const backoffMultiplier = Math.pow(2, idleCount);
          const baseTimeout = othersPresent
            ? Math.min(NUDGE_TIMEOUT_MS * backoffMultiplier, MAX_BACKOFF_MS)
            : ENFORCED_TIMEOUT_MS;
          const actualTimeout = addJitter(baseTimeout, 0.2);

          timeoutId = setTimeout(() => {
            incrementIdleCount();
            cleanup();
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    messages: [],
                    timeout: !othersPresent,
                    nudge: othersPresent,
                    others_waiting: othersPresent,
                    channel_occupancy: channelOccupancy,
                    idle_count: idleCount + 1,
                    next_timeout_ms: Math.min(NUDGE_TIMEOUT_MS * Math.pow(2, idleCount + 1), MAX_BACKOFF_MS),
                    elapsed_ms: Date.now() - startTime,
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
}
