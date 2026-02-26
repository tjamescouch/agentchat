/**
 * AgentChat Daemon
 * Persistent connection with file-based inbox/outbox
 * Supports multiple instances with different identities
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { AgentChatClient } from './client.js';
import { Identity, DEFAULT_IDENTITY_PATH } from './identity.js';
import { appendReceipt, shouldStoreReceipt, DEFAULT_RECEIPTS_PATH } from './receipts.js';
import { enforceDirectorySafety } from './security.js';
import type { ServerMessage } from './types.js';

// ============ Types ============

export interface DaemonPaths {
  dir: string;
  inbox: string;
  outbox: string;
  log: string;
  pid: string;
  newdata: string;
}

export interface DaemonOptions {
  server: string;
  identity?: string;
  channels?: string[];
  model?: string;
  name?: string;
  maxReconnectTime?: number;
}

export interface DaemonStatus {
  running: boolean;
  instance: string;
  pid?: number;
  inboxPath?: string;
  outboxPath?: string;
  logPath?: string;
  inboxLines?: number;
  lastMessage?: Record<string, unknown> | null;
}

export interface DaemonRunningStatus {
  running: boolean;
  pid?: number;
  instance: string;
}

export interface StopResult {
  stopped: boolean;
  reason?: string;
  pid?: number;
  instance: string;
}

export interface DaemonInstance {
  name: string;
  running: boolean;
  pid: number | null;
}

export interface OutboxMessage {
  to: string;
  content: string;
}

export interface DaemonCompleteMessage {
  type: string;
  ts?: number;
  proposal_id?: string;
  from?: string;
  to?: string;
  completed_by?: string;
  proposal?: {
    from?: string;
    to?: string;
  };
}

// ============ Constants ============

// Base directory — stored in home dir, never in project CWD.
// This prevents private keys and state from being accidentally committed to git.
const AGENTCHAT_DIR = path.join(os.homedir(), '.agentchat');
const DAEMONS_DIR = path.join(AGENTCHAT_DIR, 'daemons');

// Default instance name
const DEFAULT_INSTANCE = 'default';

const DEFAULT_CHANNELS = ['#general', '#agents', '#code-review', '#servers'];
const MAX_INBOX_LINES = 1000;
const RECONNECT_BASE_DELAY = 2000; // 2 seconds initial delay
const RECONNECT_MAX_DELAY = 60000; // 60 seconds cap
const MAX_RECONNECT_TIME = 10 * 60 * 1000; // 10 minutes default
const OUTBOX_POLL_INTERVAL = 500; // 500ms

// ============ Helper Functions ============

/**
 * Validate instance name to prevent path traversal
 * Only allows alphanumeric, hyphens, and underscores
 */
function validateInstanceName(name: string | undefined | null): string {
  if (!name || typeof name !== 'string') {
    return 'default';
  }
  // Strip any path separators and dangerous characters
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || 'default';
}

/**
 * Get paths for a daemon instance
 */
export function getDaemonPaths(instanceName: string = DEFAULT_INSTANCE): DaemonPaths {
  const safeName = validateInstanceName(instanceName);
  const instanceDir = path.join(DAEMONS_DIR, safeName);
  return {
    dir: instanceDir,
    inbox: path.join(instanceDir, 'inbox.jsonl'),
    outbox: path.join(instanceDir, 'outbox.jsonl'),
    log: path.join(instanceDir, 'daemon.log'),
    pid: path.join(instanceDir, 'daemon.pid'),
    newdata: path.join(instanceDir, 'newdata')  // Semaphore for new messages
  };
}

// ============ AgentChatDaemon Class ============

export class AgentChatDaemon {
  model: string | null;
  server: string;
  identityPath: string;
  channels: string[];
  instanceName: string;
  maxReconnectTime: number;
  paths: DaemonPaths;

  private client: AgentChatClient | null;
  private running: boolean;
  private reconnecting: boolean;
  private reconnectStartTime: number | null;
  private reconnectAttempts: number;
  private outboxWatcher: fs.FSWatcher | null;
  private outboxPollInterval: NodeJS.Timeout | null;
  private lastOutboxSize: number;

  constructor(options: DaemonOptions) {
    this.server = options.server;
    this.identityPath = options.identity || DEFAULT_IDENTITY_PATH;
    this.channels = options.channels || DEFAULT_CHANNELS;
    this.instanceName = options.name || DEFAULT_INSTANCE;
    this.model = options.model || null;
    this.maxReconnectTime = options.maxReconnectTime || MAX_RECONNECT_TIME;

    // Get instance-specific paths
    this.paths = getDaemonPaths(this.instanceName);

    this.client = null;
    this.running = false;
    this.reconnecting = false;
    this.reconnectStartTime = null;
    this.reconnectAttempts = 0;
    this.outboxWatcher = null;
    this.outboxPollInterval = null;
    this.lastOutboxSize = 0;
  }

  private async _ensureDir(): Promise<void> {
    await fsp.mkdir(this.paths.dir, { recursive: true });
  }

  private _log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    // Append to log file
    try {
      fs.appendFileSync(this.paths.log, line);
    } catch {
      // Directory might not exist yet
    }

    // Also output to console if not background
    if (level === 'error') {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  }

  private async _appendToInbox(msg: ServerMessage): Promise<void> {
    const line = JSON.stringify(msg) + '\n';

    // Append to inbox
    await fsp.appendFile(this.paths.inbox, line);

    // Touch semaphore file to signal new data
    await fsp.writeFile(this.paths.newdata, Date.now().toString());

    // Check if we need to truncate (ring buffer)
    await this._truncateInbox();
  }

  private async _truncateInbox(): Promise<void> {
    try {
      const content = await fsp.readFile(this.paths.inbox, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length > MAX_INBOX_LINES) {
        // Keep only the last MAX_INBOX_LINES
        const newLines = lines.slice(-MAX_INBOX_LINES);
        await fsp.writeFile(this.paths.inbox, newLines.join('\n') + '\n');
        this._log('info', `Truncated inbox to ${MAX_INBOX_LINES} lines`);
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        this._log('error', `Failed to truncate inbox: ${error.message}`);
      }
    }
  }

  private async _saveReceiptIfParty(completeMsg: DaemonCompleteMessage): Promise<void> {
    try {
      // Get our agent ID
      const ourAgentId = this.client?.agentId;
      if (!ourAgentId) {
        return;
      }

      // Check if we should store this receipt
      if (shouldStoreReceipt(completeMsg, ourAgentId)) {
        await appendReceipt(completeMsg, DEFAULT_RECEIPTS_PATH);
        this._log('info', `Saved receipt for proposal ${completeMsg.proposal_id}`);
      }
    } catch (err) {
      const error = err as Error;
      this._log('error', `Failed to save receipt: ${error.message}`);
    }
  }

  private async _processOutbox(): Promise<void> {
    try {
      // Check if outbox exists
      try {
        await fsp.access(this.paths.outbox);
      } catch {
        return; // No outbox file
      }

      const content = await fsp.readFile(this.paths.outbox, 'utf-8');
      if (!content.trim()) return;

      const lines = content.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line) as OutboxMessage;

          if (msg.to && msg.content) {
            // Join channel if needed
            if (msg.to.startsWith('#') && this.client && !this.client.channels.has(msg.to)) {
              await this.client.join(msg.to);
              this._log('info', `Joined ${msg.to} for outbound message`);
            }

            if (this.client) {
              await this.client.send(msg.to, msg.content);
              this._log('info', `Sent message to ${msg.to}: ${msg.content.substring(0, 50)}...`);
            }
          } else {
            this._log('warn', `Invalid outbox message: ${line}`);
          }
        } catch (err) {
          const error = err as Error;
          this._log('error', `Failed to process outbox line: ${error.message}`);
        }
      }

      // Truncate outbox after processing
      await fsp.writeFile(this.paths.outbox, '');

    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        this._log('error', `Outbox error: ${error.message}`);
      }
    }
  }

  private _startOutboxWatcher(): void {
    // Use polling instead of fs.watch for reliability
    this.outboxPollInterval = setInterval(() => {
      if (this.client && this.client.connected) {
        this._processOutbox();
      }
    }, OUTBOX_POLL_INTERVAL);

    // Also try fs.watch for immediate response (may not work on all platforms)
    try {
      // Ensure outbox file exists
      if (!fs.existsSync(this.paths.outbox)) {
        fs.writeFileSync(this.paths.outbox, '');
      }

      this.outboxWatcher = fs.watch(this.paths.outbox, (eventType) => {
        if (eventType === 'change' && this.client && this.client.connected) {
          this._processOutbox();
        }
      });
    } catch (err) {
      const error = err as Error;
      this._log('warn', `fs.watch not available, using polling only: ${error.message}`);
    }
  }

  private _stopOutboxWatcher(): void {
    if (this.outboxPollInterval) {
      clearInterval(this.outboxPollInterval);
      this.outboxPollInterval = null;
    }
    if (this.outboxWatcher) {
      this.outboxWatcher.close();
      this.outboxWatcher = null;
    }
  }

  private async _connect(): Promise<boolean> {
    this._log('info', `Connecting to ${this.server}...`);

    this.client = new AgentChatClient({
      server: this.server,
      identity: this.identityPath
    });

    // Set up event handlers
    this.client.on('message', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('agent_joined', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('agent_left', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('proposal', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('accept', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('reject', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('complete', async (msg: DaemonCompleteMessage) => {
      await this._appendToInbox(msg as unknown as ServerMessage);
      // Save receipt if we're a party to this completion
      await this._saveReceiptIfParty(msg);
    });

    this.client.on('dispute', async (msg: ServerMessage) => {
      await this._appendToInbox(msg);
    });

    this.client.on('disconnect', () => {
      this._log('warn', 'Disconnected from server');
      if (this.running && !this.reconnecting) {
        this._scheduleReconnect();
      }
    });

    this.client.on('error', (err: Error | { message?: string }) => {
      const message = err instanceof Error ? err.message : (err.message || JSON.stringify(err));
      this._log('error', `Client error: ${message}`);
    });

    try {
      await this.client.connect();
      this._log('info', `Connected as ${this.client.agentId}`);

      // Join channels
      const permanentlyAbsent = new Set<string>();
      for (const channel of this.channels) {
        try {
          await this.client.join(channel);
          this._log('info', `Joined ${channel}`);
        } catch (err) {
          const error = err as Error & { code?: string };
          if (error.code === 'CHANNEL_NOT_FOUND' || error.code === 'NOT_INVITED') {
            // Permanent failure — skip this channel on reconnects too
            permanentlyAbsent.add(channel);
            this._log('warn', `Skipping ${channel} permanently: ${error.message} (${error.code})`);
          } else {
            this._log('error', `Failed to join ${channel}: ${error.message}`);
          }
        }
      }
      // Remove permanently absent channels so reconnects don't retry them
      if (permanentlyAbsent.size > 0) {
        this.channels = this.channels.filter(c => !permanentlyAbsent.has(c));
      }

      return true;
    } catch (err) {
      const error = err as Error;
      this._log('error', `Connection failed: ${error.message}`);
      return false;
    }
  }

  private _scheduleReconnect(): void {
    if (!this.running || this.reconnecting) return;

    // Start tracking reconnect time if this is the first attempt
    if (!this.reconnectStartTime) {
      this.reconnectStartTime = Date.now();
    }

    // Check if we've exceeded max reconnect time
    const elapsed = Date.now() - this.reconnectStartTime;
    if (elapsed >= this.maxReconnectTime) {
      this._log('error', `Max reconnect time (${this.maxReconnectTime / 1000 / 60} minutes) exceeded. Giving up.`);
      this._log('info', 'Daemon will exit. Restart manually or use a process manager.');
      this.stop();
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff with jitter: base * 2^n + random [0,1000ms] jitter, capped at max
    const exponential = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );
    const jitter = Math.floor(Math.random() * 1000);
    const delay = exponential + jitter;

    const remaining = Math.round((this.maxReconnectTime - elapsed) / 1000);
    this._log('info', `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}, ${remaining}s until timeout)`);

    setTimeout(async () => {
      this.reconnecting = false;
      if (this.running) {
        const connected = await this._connect();
        if (connected) {
          // Reset reconnect state on successful connection
          this.reconnectStartTime = null;
          this.reconnectAttempts = 0;
          this._log('info', 'Reconnected successfully');
        } else {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }

  async start(): Promise<void> {
    // Set model in process.env if provided
    if (this.model) {
      process.env.AGENT_MODEL = this.model;
    }

    // Security check: prevent running in root/system directories
    enforceDirectorySafety(process.cwd(), { allowWarnings: true, silent: false });

    this.running = true;

    // Ensure instance directory exists
    await this._ensureDir();

    // Write PID file
    await fsp.writeFile(this.paths.pid, process.pid.toString());
    this._log('info', `Daemon starting (PID: ${process.pid}, instance: ${this.instanceName})`);

    // Initialize inbox if it doesn't exist
    try {
      await fsp.access(this.paths.inbox);
    } catch {
      await fsp.writeFile(this.paths.inbox, '');
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
    this._log('info', `Inbox: ${this.paths.inbox}`);
    this._log('info', `Outbox: ${this.paths.outbox}`);
    this._log('info', `Log: ${this.paths.log}`);
  }

  async stop(): Promise<void> {
    this._log('info', 'Daemon stopping...');
    this.running = false;

    this._stopOutboxWatcher();

    if (this.client) {
      this.client.disconnect();
    }

    // Remove PID file
    try {
      await fsp.unlink(this.paths.pid);
    } catch {
      // Ignore if already gone
    }

    this._log('info', 'Daemon stopped');
    process.exit(0);
  }
}

// ============ Utility Functions ============

/**
 * Check if daemon instance is running
 */
export async function isDaemonRunning(instanceName: string = DEFAULT_INSTANCE): Promise<DaemonRunningStatus> {
  const paths = getDaemonPaths(instanceName);

  try {
    const pid = await fsp.readFile(paths.pid, 'utf-8');
    const pidNum = parseInt(pid.trim());

    // Check if process is running
    try {
      process.kill(pidNum, 0);
      return { running: true, pid: pidNum, instance: instanceName };
    } catch {
      // Process not running, clean up stale PID file
      await fsp.unlink(paths.pid);
      return { running: false, instance: instanceName };
    }
  } catch {
    return { running: false, instance: instanceName };
  }
}

/**
 * Stop a daemon instance
 */
export async function stopDaemon(instanceName: string = DEFAULT_INSTANCE): Promise<StopResult> {
  const status = await isDaemonRunning(instanceName);
  if (!status.running) {
    return { stopped: false, reason: 'Daemon not running', instance: instanceName };
  }

  const paths = getDaemonPaths(instanceName);

  try {
    process.kill(status.pid!, 'SIGTERM');

    // Wait a bit for clean shutdown
    await new Promise(r => setTimeout(r, 1000));

    // Check if still running
    try {
      process.kill(status.pid!, 0);
      // Still running, force kill
      process.kill(status.pid!, 'SIGKILL');
    } catch {
      // Process gone, good
    }

    // Clean up PID file
    try {
      await fsp.unlink(paths.pid);
    } catch {
      // Ignore
    }

    return { stopped: true, pid: status.pid, instance: instanceName };
  } catch (err) {
    const error = err as Error;
    return { stopped: false, reason: error.message, instance: instanceName };
  }
}

/**
 * Get daemon instance status
 */
export async function getDaemonStatus(instanceName: string = DEFAULT_INSTANCE): Promise<DaemonStatus> {
  const status = await isDaemonRunning(instanceName);
  const paths = getDaemonPaths(instanceName);

  if (!status.running) {
    return {
      running: false,
      instance: instanceName
    };
  }

  // Get additional info
  let inboxLines = 0;
  let lastMessage: Record<string, unknown> | null = null;

  try {
    const content = await fsp.readFile(paths.inbox, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    inboxLines = lines.length;

    if (lines.length > 0) {
      try {
        lastMessage = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }
    }
  } catch {
    // No inbox
  }

  return {
    running: true,
    instance: instanceName,
    pid: status.pid,
    inboxPath: paths.inbox,
    outboxPath: paths.outbox,
    logPath: paths.log,
    inboxLines,
    lastMessage
  };
}

/**
 * List all daemon instances
 */
export async function listDaemons(): Promise<DaemonInstance[]> {
  const instances: DaemonInstance[] = [];

  try {
    const entries = await fsp.readdir(DAEMONS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const status = await isDaemonRunning(entry.name);
        instances.push({
          name: entry.name,
          running: status.running,
          pid: status.pid || null
        });
      }
    }
  } catch {
    // No daemons directory
  }

  return instances;
}

/**
 * Stop all running daemons
 */
export async function stopAllDaemons(): Promise<StopResult[]> {
  const instances = await listDaemons();
  const results: StopResult[] = [];

  for (const instance of instances) {
    if (instance.running) {
      const result = await stopDaemon(instance.name);
      results.push(result);
    }
  }

  return results;
}

// Export for CLI (backwards compatibility with default paths)
export const INBOX_PATH = getDaemonPaths(DEFAULT_INSTANCE).inbox;
export const OUTBOX_PATH = getDaemonPaths(DEFAULT_INSTANCE).outbox;
export const LOG_PATH = getDaemonPaths(DEFAULT_INSTANCE).log;
export const PID_PATH = getDaemonPaths(DEFAULT_INSTANCE).pid;
export { DEFAULT_CHANNELS, DEFAULT_INSTANCE };
