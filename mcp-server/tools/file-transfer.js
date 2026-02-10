/**
 * AgentChat File Transfer Tools
 * Enables MCP-connected agents to receive files sent via the _ft protocol.
 *
 * Protocol flow:
 *   Sender → _ft:offer (MSG) → Receiver sees in listen
 *   Receiver → _ft:accept (MSG) → Sender starts sending
 *   Sender → _ft:chunk (FILE_CHUNK) × N → Receiver assembles
 *   Sender → _ft:complete (MSG) → Receiver verifies hash
 *   Receiver → _ft:ack (MSG) → Sender gets confirmation
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { client } from '../state.js';

// ============ Transfer State ============

const TRANSFER_TTL = 30 * 60 * 1000; // 30 minute expiry
const RECEIVE_TIMEOUT = 120 * 1000;  // 120s max wait for chunks
const MAX_RECEIVE_SIZE = 50 * 1024 * 1024; // 50MB max

/** @type {Map<string, {tid: string, senderId: string, senderNick: string, files: Array<{name: string, size: number}>, totalSize: number, sha256: string, totalChunks: number, createdAt: number}>} */
const pendingOffers = new Map();

/** @type {Map<string, {chunks: (string|null)[], receivedCount: number, totalChunks: number, sha256: string, senderId: string, resolve: Function, reject: Function, completeSha256: string|null}>} */
const activeTransfers = new Map();

// Cleanup stale offers every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, offer] of pendingOffers) {
    if (now - offer.createdAt > TRANSFER_TTL) pendingOffers.delete(id);
  }
}, 5 * 60 * 1000);

// ============ Handlers (called from connect.js) ============

/**
 * Handle incoming _ft:offer message — store for later acceptance
 */
export function handleIncomingOffer(msg) {
  const ft = msg._ft_data;
  if (!ft || !ft.tid) return;

  // Size guard
  if (ft.totalSize > MAX_RECEIVE_SIZE) return;

  pendingOffers.set(ft.tid, {
    tid: ft.tid,
    senderId: msg.from,
    senderNick: ft.senderNick || msg.from_name || msg.from,
    files: ft.files || [],
    totalSize: ft.totalSize || 0,
    sha256: ft.sha256 || '',
    totalChunks: ft.chunks || 1,
    createdAt: Date.now(),
  });
}

/**
 * Handle incoming _ft:chunk (arrives via FILE_CHUNK event)
 */
export function handleFileChunk(msg) {
  const ft = msg._ft_data;
  if (!ft || !ft.tid) return;

  const transfer = activeTransfers.get(ft.tid);
  if (!transfer) return; // Not actively receiving this transfer

  const idx = ft.idx;
  const data = ft.data;

  if (idx >= 0 && idx < transfer.chunks.length && transfer.chunks[idx] === null) {
    transfer.chunks[idx] = data;
    transfer.receivedCount++;

    // Check if all chunks received AND we have the complete signal
    if (transfer.receivedCount === transfer.totalChunks && transfer.completeSha256 !== null) {
      transfer.resolve();
    }
  }
}

/**
 * Handle incoming _ft:complete (arrives via MSG event)
 */
export function handleTransferComplete(msg) {
  const ft = msg._ft_data;
  if (!ft || !ft.tid) return;

  const transfer = activeTransfers.get(ft.tid);
  if (!transfer) return;

  transfer.completeSha256 = ft.sha256 || transfer.sha256;

  // If all chunks already received, resolve now
  if (transfer.receivedCount === transfer.totalChunks) {
    transfer.resolve();
  }
}

// ============ SLURP v4 Unpacker (ported from dashboard) ============

function unpackArchive(content, outputDir) {
  const lines = content.split('\n');
  const extracted = [];

  fs.mkdirSync(outputDir, { recursive: true });

  let i = 0;
  while (i < lines.length) {
    const binMatch = lines[i].match(/^=== (.+?) \[binary\] ===$/);
    const textMatch = lines[i].match(/^=== (.+?) ===$/);

    if (binMatch || textMatch) {
      const binary = !!binMatch;
      const filePath = binary ? binMatch[1] : textMatch[1];
      if (filePath.startsWith('END ')) { i++; continue; }

      const endMarker = `=== END ${filePath} ===`;
      const contentLines = [];
      i++;
      while (i < lines.length && lines[i] !== endMarker) {
        contentLines.push(lines[i]);
        i++;
      }

      // Security: prevent path traversal
      const safeName = filePath.replace(/\.\./g, '').replace(/^\//, '');
      const dest = path.join(outputDir, safeName);
      const destDir = path.dirname(dest);

      // Ensure dest is within outputDir
      if (!path.resolve(dest).startsWith(path.resolve(outputDir))) {
        i++;
        continue;
      }

      fs.mkdirSync(destDir, { recursive: true });

      if (binary) {
        const b64 = contentLines.join('');
        fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      } else {
        const text = contentLines.join('\n');
        fs.writeFileSync(dest, text.endsWith('\n') ? text : text + '\n');
      }

      extracted.push({ name: safeName, path: dest, size: fs.statSync(dest).size });
    }
    i++;
  }

  return extracted;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============ Tool Registration ============

export function registerFileTransferTools(server) {
  // --- agentchat_file_list_offers ---
  server.tool(
    'agentchat_file_list_offers',
    'List pending file transfer offers that can be accepted with agentchat_file_receive',
    {},
    async () => {
      const offers = [];
      for (const [, offer] of pendingOffers) {
        offers.push({
          transfer_id: offer.tid,
          from: offer.senderId,
          from_nick: offer.senderNick,
          files: offer.files,
          total_size: humanSize(offer.totalSize),
          chunks: offer.totalChunks,
          age_seconds: Math.round((Date.now() - offer.createdAt) / 1000),
        });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ offers, count: offers.length }),
        }],
      };
    }
  );

  // --- agentchat_file_receive ---
  server.tool(
    'agentchat_file_receive',
    'Accept and receive a file transfer. Blocks until complete or timeout (120s). Files are saved to disk and paths returned.',
    {
      transfer_id: z.string().describe('Transfer ID from the _ft offer (seen in listen or file_list_offers)'),
      save_directory: z.string().optional().describe('Directory to save files to (default: /tmp/agentchat-files/<transfer_id>/)'),
    },
    async ({ transfer_id, save_directory }) => {
      try {
        if (!client || !client.connected) {
          return { content: [{ type: 'text', text: 'Not connected. Use agentchat_connect first.' }], isError: true };
        }

        const offer = pendingOffers.get(transfer_id);
        if (!offer) {
          return {
            content: [{ type: 'text', text: `No pending offer with ID "${transfer_id}". Use agentchat_file_list_offers to see available offers.` }],
            isError: true,
          };
        }

        // Validate save directory
        const saveDir = save_directory
          ? path.resolve(save_directory)
          : path.join('/tmp', 'agentchat-files', transfer_id);

        if (save_directory && save_directory.includes('..')) {
          return { content: [{ type: 'text', text: 'Path traversal not allowed in save_directory' }], isError: true };
        }

        // Set up transfer tracking
        const transferState = {
          chunks: new Array(offer.totalChunks).fill(null),
          receivedCount: 0,
          totalChunks: offer.totalChunks,
          sha256: offer.sha256,
          senderId: offer.senderId,
          resolve: null,
          reject: null,
          completeSha256: null,
        };

        // Create promise that resolves when transfer completes
        const transferPromise = new Promise((resolve, reject) => {
          transferState.resolve = resolve;
          transferState.reject = reject;
        });

        activeTransfers.set(transfer_id, transferState);

        // Send accept to sender
        const acceptMsg = JSON.stringify({ _ft: 'accept', tid: transfer_id });
        await client.send(offer.senderId, acceptMsg);

        // Wait for chunks with timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Transfer timed out after ${RECEIVE_TIMEOUT / 1000}s (received ${transferState.receivedCount}/${offer.totalChunks} chunks)`)), RECEIVE_TIMEOUT);
        });

        try {
          await Promise.race([transferPromise, timeoutPromise]);
        } catch (err) {
          activeTransfers.delete(transfer_id);
          return { content: [{ type: 'text', text: `Transfer failed: ${err.message}` }], isError: true };
        }

        // Reassemble archive
        const archive = transferState.chunks.join('');
        const actualHash = createHash('sha256').update(archive).digest('hex');
        const expectedHash = transferState.completeSha256 || offer.sha256;
        const verified = actualHash === expectedHash;

        // Unpack files
        const extractedFiles = unpackArchive(archive, saveDir);

        // Send ack to sender
        const ackMsg = JSON.stringify({ _ft: 'ack', tid: transfer_id, ok: verified, error: verified ? undefined : 'hash mismatch' });
        await client.send(offer.senderId, ackMsg);

        // Cleanup
        activeTransfers.delete(transfer_id);
        pendingOffers.delete(transfer_id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              verified,
              save_directory: saveDir,
              files: extractedFiles,
              total_size: humanSize(offer.totalSize),
              hash_match: verified,
            }),
          }],
        };
      } catch (error) {
        activeTransfers.delete(transfer_id);
        return { content: [{ type: 'text', text: `Error receiving file: ${error.message}` }], isError: true };
      }
    }
  );
}
