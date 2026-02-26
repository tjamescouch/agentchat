/**
 * AgentChat Listen Tool
 * Listens for messages by polling inbox.jsonl — the single source of truth
 * for both daemon and direct-connection modes.
 *
 * v3: Configurable timeout (default 60s, was 1 hour). Reduced settle window
 * (1.5s, was 5s). Conditional channel joins (skip already-joined).
 * Replay messages now accepted if newer than lastSeen cursor (fixes message
 * loss on reconnect — see connect.js).
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { getDaemonPaths } from '@tjamescouch/agentchat/lib/daemon.js';
import { addJitter } from '@tjamescouch/agentchat/lib/jitter.js';
import { ClientMessageType } from '@tjamescouch/agentchat/lib/protocol.js';
import { client, getLastSeen, updateLastSeen, incrementIdleCount, resetIdleCount, trackChannel, joinedChannels } from '../state.js';
import { ensureConnected } from './connect.js';

// Timeout bounds
const DEFAULT_TIMEOUT_S = 60;    // default listen timeout in seconds
const MIN_TIMEOUT_S = 5;         // minimum allowed timeout
const MAX_TIMEOUT_S = 3600;      // maximum allowed timeout (1 hour)
const POLL_INTERVAL_MS = 500;    // fallback poll interval
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // heartbeat file write interval
const SETTLE_MS = parseInt(process.env.AGENTCHAT_SETTLE_MS || '1500', 10);
// Response size limits — prevent listen from returning enormous payloads
const MAX_LISTEN_MESSAGES = 50; // max messages per listen response
const MAX_RESPONSE_CHARS = 32000; // hard cap on JSON response size (~32KB)

/**
 * Read last N lines from a file efficiently (reads from end of file).
 */
function tailLines(filePath, n) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size === 0) return [];

    const CHUNK = 8192;
    let pos = stat.size;
    let lines = [];
    let partial = '';

    while (pos > 0 && lines.length <= n) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      const chunk = buf.toString('utf-8') + partial;
      const parts = chunk.split('\n');
      partial = parts.shift(); // incomplete first line
      lines = parts.concat(lines);
    }
    if (partial) lines.unshift(partial);
    return lines.filter(Boolean).slice(-n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read inbox.jsonl and return messages newer than lastSeen for the given channels.
 * If tailN is set, only read the last tailN lines from the file instead of all lines.
 */
function readInbox(paths, lastSeen, channels, agentId, tailN) {
  if (!fs.existsSync(paths.inbox)) return [];

  let lines;
  if (tailN) {
    // Read only last tailN*2 lines (extra margin for filtering) from end of file
    try {
      lines = tailLines(paths.inbox, tailN * 2);
    } catch {
      return [];
    }
  } else {
    let content;
    try {
      content = fs.readFileSync(paths.inbox, 'utf-8');
    } catch {
      return [];
    }
    lines = content.trim().split('\n').filter(Boolean);
  }

  const messages = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if ((msg.type !== 'MSG' && msg.type !== 'EVENT') || !msg.ts) continue;
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

  // Deduplicate by ts:from:content_prefix (handles same-ms messages)
  const seen = new Set();
  const deduped = messages.filter((m) => {
    const key = `${m.ts}:${m.from}:${(m.content || '').slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => a.ts - b.ts);
  return capMessages(deduped);
}

/**
 * Cap messages to prevent oversized responses.
 * Keeps the NEWEST messages (drops oldest) and enforces both a count limit
 * and a total character size limit on the JSON output.
 */
function capMessages(messages) {
  // First: count cap — keep newest
  let capped = messages.length > MAX_LISTEN_MESSAGES
    ? messages.slice(-MAX_LISTEN_MESSAGES)
    : messages;

  // Second: size cap — drop oldest until under limit
  let json = JSON.stringify(capped);
  while (json.length > MAX_RESPONSE_CHARS && capped.length > 1) {
    const dropCount = Math.max(1, Math.floor(capped.length * 0.25));
    capped = capped.slice(dropCount);
    json = JSON.stringify(capped);
  }

  // If a single message exceeds the limit, truncate its content
  if (json.length > MAX_RESPONSE_CHARS && capped.length === 1) {
    const msg = { ...capped[0] };
    const overhead = JSON.stringify([{ ...msg, content: '' }]).length;
    msg.content = msg.content.slice(0, MAX_RESPONSE_CHARS - overhead - 20) + '\u2026 [truncated]';
    capped = [msg];
  }

  return capped;
}

/**
 * Register the listen tool with the MCP server
 */
export function registerListenTool(server) {
  server.tool(
    'agentchat_listen',
    'Listen for messages - blocks until a message arrives or timeout (default 60s, max 3600s). Use tail parameter to return last N messages immediately without blocking (efficient polling mode). Use timeout parameter to control responsiveness.',
    {
      channels: z.array(z.string()).describe('Channels to listen on (e.g., ["#general"])'),
      tail: z.number().optional().describe('Return last N messages immediately without blocking. Reads only the tail of the inbox file for efficiency. Note: advances the read cursor, so subsequent listen calls will not re-return these messages.'),
      timeout: z.number().optional().describe('Max seconds to wait for messages (default: 60, min: 5, max: 3600). Controls how long listen blocks before returning empty.'),
    },
    async ({ channels, tail, timeout }) => {
      try {
        if (!client || !client.connected) {
          const reconnected = await ensureConnected();
          if (!reconnected) {
            return {
              content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }],
              isError: true,
            };
          }
        }

        const startTime = Date.now();
        const paths = getDaemonPaths('default');

        // Join channels not yet joined. Skip already-joined to avoid
        // unnecessary server round-trips and replay processing.
        for (const channel of channels) {
          if (!joinedChannels.has(channel)) {
            await client.join(channel);
            trackChannel(channel);
          }
        }

        // --- Tail mode: return last N messages immediately, no blocking ---
        if (tail) {
          const msgs = readInbox(paths, 0, channels, client.agentId, tail);
          const lastN = msgs.slice(-tail);
          if (lastN.length > 0) {
            const newestTs = lastN[lastN.length - 1].ts;
            updateLastSeen(newestTs);
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                messages: lastN,
                tail: true,
                count: lastN.length,
              }),
            }],
          };
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
          // Settle window: wait to batch burst messages before returning
          await new Promise(r => setTimeout(r, SETTLE_MS));
          // Re-read to catch any messages that arrived during settle
          const settled = readInbox(paths, lastSeen, channels, client.agentId);
          const finalMsgs = settled.length > 0 ? settled : immediate;
          const newestTs = finalMsgs[finalMsgs.length - 1].ts;
          updateLastSeen(newestTs);
          resetIdleCount();
          setPresence('online');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                messages: finalMsgs,
                from_inbox: true,
                settled: true,
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
          let settleId = null;
          let resolved = false;

          let cleanup = () => {
            if (settleId) { clearTimeout(settleId); settleId = null; }
            if (watcher) { watcher.close(); watcher = null; }
            if (pollId) { clearInterval(pollId); pollId = null; }
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            setPresence('online');
          };

          const tryRead = () => {
            if (resolved) return false;
            const msgs = readInbox(paths, getLastSeen(), channels, client.agentId);
            if (msgs.length > 0 && !settleId) {
              // Start settle window — batch burst messages before returning
              settleId = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                // Re-read to catch messages that arrived during settle
                const settled = readInbox(paths, getLastSeen(), channels, client.agentId);
                const finalMsgs = settled.length > 0 ? settled : msgs;
                const newestTs = finalMsgs[finalMsgs.length - 1].ts;
                updateLastSeen(newestTs);
                resetIdleCount();
                cleanup();
                resolve({
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      messages: finalMsgs,
                      from_inbox: true,
                      settled: true,
                      elapsed_ms: Date.now() - startTime,
                    }),
                  }],
                });
              }, SETTLE_MS);
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

          // Compute timeout: use agent-provided value (clamped) or default
          const timeoutSec = timeout
            ? Math.max(MIN_TIMEOUT_S, Math.min(MAX_TIMEOUT_S, timeout))
            : DEFAULT_TIMEOUT_S;
          const actualTimeout = addJitter(timeoutSec * 1000, 0.1);

          // Heartbeat file for deadlock detection + stderr for stall prevention
          const heartbeatPath = path.join(newdataDir, 'heartbeat');
          const writeHeartbeat = () => {
            try { fs.writeFileSync(heartbeatPath, String(Date.now())); } catch { /* ignore */ }
            try { process.stderr.write(`[heartbeat] listening on ${channels.join(', ')}\n`); } catch { /* ignore */ }
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
            if (resolved) return;
            resolved = true;
            incrementIdleCount();
            cleanupAll();
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  messages: [],
                  timeout: true,
                  timeout_s: timeoutSec,
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
