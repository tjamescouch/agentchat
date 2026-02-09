/**
 * AgentChat Listen Tool
 * Listens for messages by polling inbox.jsonl — the single source of truth
 * for both daemon and direct-connection modes.
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';
import { addJitter } from '@tjamescouch/agentchat/lib/jitter.js';
import { ClientMessageType } from '@tjamescouch/agentchat/lib/protocol.js';
import { client, getLastSeen, updateLastSeen, getIdleCount, incrementIdleCount, resetIdleCount } from '../state.js';

// Timeouts - agent cannot override these
const ENFORCED_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour when alone
const NUDGE_TIMEOUT_MS = 30 * 1000; // 30 seconds when others are present
const MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 minute cap on backoff
const POLL_INTERVAL_MS = 500; // fallback poll interval
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // heartbeat file write interval

/**
 * Read inbox.jsonl and return messages newer than lastSeen for the given channels.
 */
function readInbox(paths, lastSeen, channels, agentId) {
  if (!fs.existsSync(paths.inbox)) return [];

  let content;
  try {
    content = fs.readFileSync(paths.inbox, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.trim().split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if (msg.type !== 'MSG' || !msg.ts) continue;
      if (msg.ts <= lastSeen) continue;
      if (msg.from === agentId || msg.from === '@server') continue;

      const isRelevantChannel = channels.includes(msg.to);
      const isDMToUs = msg.to === agentId;
      if (!isRelevantChannel && !isDMToUs) continue;

      messages.push({
        from: msg.from,
        from_name: msg.from_name,
        to: msg.to,
        content: msg.content,
        ts: msg.ts,
      });
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Deduplicate by ts:from
  const seen = new Set();
  const deduped = messages.filter((m) => {
    const key = `${m.ts}:${m.from}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => a.ts - b.ts);
  return deduped;
}

/**
 * Register the listen tool with the MCP server
 */
export function registerListenTool(server) {
  server.tool(
    'agentchat_listen',
    'Listen for messages - blocks until a message arrives. If others are in the channel, returns after ~30s with nudge:true so you can take initiative. If alone, waits up to 1 hour. Writes a heartbeat file every 30s during blocking for deadlock detection.',
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
        const paths = getDaemonPaths('default');

        // Join/rejoin channels for presence (replays now go straight to inbox
        // via the connect handler's message listener)
        for (const channel of channels) {
          await client.join(channel);
        }

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

        // Set presence to 'listening' so other agents see we're active
        const setPresence = (status) => {
          client.sendRaw({ type: ClientMessageType.SET_PRESENCE, status });
        };
        setPresence('listening');

        // --- First check: return immediately if inbox has unseen messages ---
        const lastSeen = getLastSeen();
        const immediate = readInbox(paths, lastSeen, channels, client.agentId);

        if (immediate.length > 0) {
          const newestTs = immediate[immediate.length - 1].ts;
          updateLastSeen(newestTs);
          resetIdleCount();
          setPresence('online');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                messages: immediate,
                from_inbox: true,
                elapsed_ms: Date.now() - startTime,
              }),
            }],
          };
        }

        // --- No unseen messages: poll newdata semaphore until timeout ---
        return new Promise((resolve) => {
          let watcher = null;
          let pollId = null;
          let timeoutId = null;

          let cleanup = () => {
            if (watcher) { watcher.close(); watcher = null; }
            if (pollId) { clearInterval(pollId); pollId = null; }
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            setPresence('online');
          };

          const tryRead = () => {
            const msgs = readInbox(paths, getLastSeen(), channels, client.agentId);
            if (msgs.length > 0) {
              const newestTs = msgs[msgs.length - 1].ts;
              updateLastSeen(newestTs);
              resetIdleCount();
              cleanup();
              resolve({
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    messages: msgs,
                    from_inbox: true,
                    elapsed_ms: Date.now() - startTime,
                  }),
                }],
              });
              return true;
            }
            return false;
          };

          // Watch the newdata semaphore file for changes
          const newdataDir = path.dirname(paths.newdata);
          const newdataFile = path.basename(paths.newdata);

          // Ensure directory exists so fs.watch doesn't throw
          if (!fs.existsSync(newdataDir)) {
            fs.mkdirSync(newdataDir, { recursive: true });
          }

          try {
            watcher = fs.watch(newdataDir, (eventType, filename) => {
              if (filename === newdataFile) {
                tryRead();
              }
            });
            watcher.on('error', () => {
              // Watcher died — fallback poll will still work
              if (watcher) { watcher.close(); watcher = null; }
            });
          } catch {
            // fs.watch not available on this platform — rely on poll
          }

          // Fallback poll in case fs.watch misses events
          pollId = setInterval(() => {
            tryRead();
          }, POLL_INTERVAL_MS);

          // Exponential backoff timeout
          const idleCount = getIdleCount();
          const backoffMultiplier = Math.pow(2, idleCount);
          const baseTimeout = othersPresent
            ? Math.min(NUDGE_TIMEOUT_MS * backoffMultiplier, MAX_BACKOFF_MS)
            : ENFORCED_TIMEOUT_MS;
          const actualTimeout = addJitter(baseTimeout, 0.2);

          // Heartbeat file for deadlock detection
          const heartbeatPath = path.join(newdataDir, 'heartbeat');
          const writeHeartbeat = () => {
            try { fs.writeFileSync(heartbeatPath, String(Date.now())); } catch { /* ignore */ }
          };
          writeHeartbeat();
          const heartbeatId = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

          const origCleanup = cleanup;
          const cleanupAll = () => {
            clearInterval(heartbeatId);
            origCleanup();
          };
          // Replace cleanup ref for the timeout/tryRead paths
          cleanup = cleanupAll;

          timeoutId = setTimeout(() => {
            incrementIdleCount();
            cleanupAll();
            resolve({
              content: [{
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
              }],
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
