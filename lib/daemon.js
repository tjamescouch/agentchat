/**
 * AgentChat Daemon
 * Persistent connection with file-based inbox/outbox
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { AgentChatClient } from './client.js';
import { Identity, DEFAULT_IDENTITY_PATH } from './identity.js';

// Default paths
const AGENTCHAT_DIR = path.join(os.homedir(), '.agentchat');
const INBOX_PATH = path.join(AGENTCHAT_DIR, 'inbox.jsonl');
const OUTBOX_PATH = path.join(AGENTCHAT_DIR, 'outbox.jsonl');
const LOG_PATH = path.join(AGENTCHAT_DIR, 'daemon.log');
const PID_PATH = path.join(AGENTCHAT_DIR, 'daemon.pid');

const DEFAULT_CHANNELS = ['#general', '#agents', '#skills'];
const MAX_INBOX_LINES = 1000;
const RECONNECT_DELAY = 5000; // 5 seconds
const OUTBOX_POLL_INTERVAL = 500; // 500ms

export class AgentChatDaemon {
  constructor(options = {}) {
    this.server = options.server;
    this.identityPath = options.identity || DEFAULT_IDENTITY_PATH;
    this.channels = options.channels || DEFAULT_CHANNELS;

    this.client = null;
    this.running = false;
    this.reconnecting = false;
    this.outboxWatcher = null;
    this.outboxPollInterval = null;
    this.lastOutboxSize = 0;

    // Ensure directory exists
    this._ensureDir();
  }

  async _ensureDir() {
    await fsp.mkdir(AGENTCHAT_DIR, { recursive: true });
  }

  _log(level, message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    // Append to log file
    fs.appendFileSync(LOG_PATH, line);

    // Also output to console if not background
    if (level === 'error') {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  }

  async _appendToInbox(msg) {
    const line = JSON.stringify(msg) + '\n';

    // Append to inbox
    await fsp.appendFile(INBOX_PATH, line);

    // Check if we need to truncate (ring buffer)
    await this._truncateInbox();
  }

  async _truncateInbox() {
    try {
      const content = await fsp.readFile(INBOX_PATH, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length > MAX_INBOX_LINES) {
        // Keep only the last MAX_INBOX_LINES
        const newLines = lines.slice(-MAX_INBOX_LINES);
        await fsp.writeFile(INBOX_PATH, newLines.join('\n') + '\n');
        this._log('info', `Truncated inbox to ${MAX_INBOX_LINES} lines`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this._log('error', `Failed to truncate inbox: ${err.message}`);
      }
    }
  }

  async _processOutbox() {
    try {
      // Check if outbox exists
      try {
        await fsp.access(OUTBOX_PATH);
      } catch {
        return; // No outbox file
      }

      const content = await fsp.readFile(OUTBOX_PATH, 'utf-8');
      if (!content.trim()) return;

      const lines = content.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line);

          if (msg.to && msg.content) {
            // Join channel if needed
            if (msg.to.startsWith('#') && !this.client.channels.has(msg.to)) {
              await this.client.join(msg.to);
              this._log('info', `Joined ${msg.to} for outbound message`);
            }

            await this.client.send(msg.to, msg.content);
            this._log('info', `Sent message to ${msg.to}: ${msg.content.substring(0, 50)}...`);
          } else {
            this._log('warn', `Invalid outbox message: ${line}`);
          }
        } catch (err) {
          this._log('error', `Failed to process outbox line: ${err.message}`);
        }
      }

      // Truncate outbox after processing
      await fsp.writeFile(OUTBOX_PATH, '');

    } catch (err) {
      if (err.code !== 'ENOENT') {
        this._log('error', `Outbox error: ${err.message}`);
      }
    }
  }

  _startOutboxWatcher() {
    // Use polling instead of fs.watch for reliability
    this.outboxPollInterval = setInterval(() => {
      if (this.client && this.client.connected) {
        this._processOutbox();
      }
    }, OUTBOX_POLL_INTERVAL);

    // Also try fs.watch for immediate response (may not work on all platforms)
    try {
      // Ensure outbox file exists
      if (!fs.existsSync(OUTBOX_PATH)) {
        fs.writeFileSync(OUTBOX_PATH, '');
      }

      this.outboxWatcher = fs.watch(OUTBOX_PATH, (eventType) => {
        if (eventType === 'change' && this.client && this.client.connected) {
          this._processOutbox();
        }
      });
    } catch (err) {
      this._log('warn', `fs.watch not available, using polling only: ${err.message}`);
    }
  }

  _stopOutboxWatcher() {
    if (this.outboxPollInterval) {
      clearInterval(this.outboxPollInterval);
      this.outboxPollInterval = null;
    }
    if (this.outboxWatcher) {
      this.outboxWatcher.close();
      this.outboxWatcher = null;
    }
  }

  async _connect() {
    this._log('info', `Connecting to ${this.server}...`);

    this.client = new AgentChatClient({
      server: this.server,
      identity: this.identityPath
    });

    // Set up event handlers
    this.client.on('message', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('agent_joined', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('agent_left', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('proposal', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('accept', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('reject', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('complete', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('dispute', async (msg) => {
      await this._appendToInbox(msg);
    });

    this.client.on('disconnect', () => {
      this._log('warn', 'Disconnected from server');
      if (this.running && !this.reconnecting) {
        this._scheduleReconnect();
      }
    });

    this.client.on('error', (err) => {
      this._log('error', `Client error: ${err.message || JSON.stringify(err)}`);
    });

    try {
      await this.client.connect();
      this._log('info', `Connected as ${this.client.agentId}`);

      // Join channels
      for (const channel of this.channels) {
        try {
          await this.client.join(channel);
          this._log('info', `Joined ${channel}`);
        } catch (err) {
          this._log('error', `Failed to join ${channel}: ${err.message}`);
        }
      }

      return true;
    } catch (err) {
      this._log('error', `Connection failed: ${err.message}`);
      return false;
    }
  }

  _scheduleReconnect() {
    if (!this.running || this.reconnecting) return;

    this.reconnecting = true;
    this._log('info', `Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);

    setTimeout(async () => {
      this.reconnecting = false;
      if (this.running) {
        const connected = await this._connect();
        if (!connected) {
          this._scheduleReconnect();
        }
      }
    }, RECONNECT_DELAY);
  }

  async start() {
    this.running = true;

    // Write PID file
    await fsp.writeFile(PID_PATH, process.pid.toString());
    this._log('info', `Daemon starting (PID: ${process.pid})`);

    // Initialize inbox if it doesn't exist
    try {
      await fsp.access(INBOX_PATH);
    } catch {
      await fsp.writeFile(INBOX_PATH, '');
    }

    // Connect to server
    const connected = await this._connect();
    if (!connected) {
      this._scheduleReconnect();
    }

    // Start watching outbox
    this._startOutboxWatcher();

    // Handle shutdown signals
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    this._log('info', 'Daemon started');
    this._log('info', `Inbox: ${INBOX_PATH}`);
    this._log('info', `Outbox: ${OUTBOX_PATH}`);
    this._log('info', `Log: ${LOG_PATH}`);
  }

  async stop() {
    this._log('info', 'Daemon stopping...');
    this.running = false;

    this._stopOutboxWatcher();

    if (this.client) {
      this.client.disconnect();
    }

    // Remove PID file
    try {
      await fsp.unlink(PID_PATH);
    } catch {
      // Ignore if already gone
    }

    this._log('info', 'Daemon stopped');
    process.exit(0);
  }
}

/**
 * Check if daemon is running
 */
export async function isDaemonRunning() {
  try {
    const pid = await fsp.readFile(PID_PATH, 'utf-8');
    const pidNum = parseInt(pid.trim());

    // Check if process is running
    try {
      process.kill(pidNum, 0);
      return { running: true, pid: pidNum };
    } catch {
      // Process not running, clean up stale PID file
      await fsp.unlink(PID_PATH);
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Stop the daemon
 */
export async function stopDaemon() {
  const status = await isDaemonRunning();
  if (!status.running) {
    return { stopped: false, reason: 'Daemon not running' };
  }

  try {
    process.kill(status.pid, 'SIGTERM');

    // Wait a bit for clean shutdown
    await new Promise(r => setTimeout(r, 1000));

    // Check if still running
    try {
      process.kill(status.pid, 0);
      // Still running, force kill
      process.kill(status.pid, 'SIGKILL');
    } catch {
      // Process gone, good
    }

    // Clean up PID file
    try {
      await fsp.unlink(PID_PATH);
    } catch {
      // Ignore
    }

    return { stopped: true, pid: status.pid };
  } catch (err) {
    return { stopped: false, reason: err.message };
  }
}

/**
 * Get daemon status
 */
export async function getDaemonStatus() {
  const status = await isDaemonRunning();

  if (!status.running) {
    return {
      running: false
    };
  }

  // Get additional info
  let inboxLines = 0;
  let lastMessage = null;

  try {
    const content = await fsp.readFile(INBOX_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    inboxLines = lines.length;

    if (lines.length > 0) {
      try {
        lastMessage = JSON.parse(lines[lines.length - 1]);
      } catch {
        // Ignore parse errors
      }
    }
  } catch {
    // No inbox
  }

  return {
    running: true,
    pid: status.pid,
    inboxPath: INBOX_PATH,
    outboxPath: OUTBOX_PATH,
    logPath: LOG_PATH,
    inboxLines,
    lastMessage
  };
}

// Export paths for CLI
export { INBOX_PATH, OUTBOX_PATH, LOG_PATH, PID_PATH, DEFAULT_CHANNELS };
