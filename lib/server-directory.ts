/**
 * Server Directory
 * Registry of known AgentChat servers for discovery
 */

import http from 'http';
import https from 'https';
import fs from 'fs/promises';
import path from 'path';

export interface ServerEntry {
  name: string;
  url: string;
  description?: string;
  region?: string;
}

export interface HealthData {
  agents?: {
    connected?: number;
  };
  uptime_seconds?: number;
  [key: string]: unknown;
}

export interface ServerWithStatus extends ServerEntry {
  status: 'online' | 'offline' | 'unknown';
  health?: HealthData;
  error?: string;
  checked_at?: string;
}

export interface ServerDirectoryFile {
  version: number;
  updated_at: string;
  servers: ServerEntry[];
}

export interface ServerDirectoryOptions {
  directoryPath?: string;
  timeout?: number;
}

export interface DiscoverOptions {
  onlineOnly?: boolean;
}

// Default public servers (can be extended)
export const DEFAULT_SERVERS: ServerEntry[] = [
  {
    name: 'AgentChat Public',
    url: 'wss://agentchat-server.fly.dev',
    description: 'Official public AgentChat server',
    region: 'global'
  }
];

// Default directory file path
export const DEFAULT_DIRECTORY_PATH: string = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.agentchat',
  'servers.json'
);

/**
 * Server Directory for discovering AgentChat servers
 */
export class ServerDirectory {
  private directoryPath: string;
  private servers: ServerEntry[];
  private timeout: number;

  constructor(options: ServerDirectoryOptions = {}) {
    this.directoryPath = options.directoryPath || DEFAULT_DIRECTORY_PATH;
    this.servers = [...DEFAULT_SERVERS];
    this.timeout = options.timeout || 5000;
  }

  /**
   * Load servers from directory file
   */
  async load(): Promise<this> {
    try {
      const data = await fs.readFile(this.directoryPath, 'utf8');
      const loaded = JSON.parse(data) as ServerDirectoryFile;
      if (Array.isArray(loaded.servers)) {
        // Merge with defaults, avoiding duplicates by URL
        const urls = new Set(this.servers.map(s => s.url));
        for (const server of loaded.servers) {
          if (!urls.has(server.url)) {
            this.servers.push(server);
            urls.add(server.url);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid, use defaults
    }
    return this;
  }

  /**
   * Save servers to directory file
   */
  async save(): Promise<void> {
    const dir = path.dirname(this.directoryPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.directoryPath, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      servers: this.servers
    } as ServerDirectoryFile, null, 2));
  }

  /**
   * Add a server to the directory
   */
  async addServer(server: ServerEntry): Promise<void> {
    const existing = this.servers.find(s => s.url === server.url);
    if (existing) {
      Object.assign(existing, server);
    } else {
      this.servers.push(server);
    }
    await this.save();
  }

  /**
   * Remove a server from the directory
   */
  async removeServer(url: string): Promise<void> {
    this.servers = this.servers.filter(s => s.url !== url);
    await this.save();
  }

  /**
   * Check health of a single server
   * @param server - Server object with url
   * @returns Server with health status
   */
  async checkHealth(server: ServerEntry): Promise<ServerWithStatus> {
    const wsUrl = server.url;
    // Convert ws:// or wss:// to http:// or https://
    const httpUrl = wsUrl
      .replace('wss://', 'https://')
      .replace('ws://', 'http://');

    try {
      const health = await this._fetchHealth(httpUrl + '/health');
      return {
        ...server,
        status: 'online',
        health,
        checked_at: new Date().toISOString()
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      return {
        ...server,
        status: 'offline',
        error: error.message || error.code || 'Unknown error',
        checked_at: new Date().toISOString()
      };
    }
  }

  /**
   * Fetch health endpoint
   */
  private _fetchHealth(url: string): Promise<HealthData> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(url, { timeout: this.timeout }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data) as HealthData);
            } catch {
              reject(new Error('Invalid health response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Discover available servers (check health of all known servers)
   * @param options
   * @param options.onlineOnly - Only return online servers
   * @returns List of servers with status
   */
  async discover(options: DiscoverOptions = {}): Promise<ServerWithStatus[]> {
    const results = await Promise.all(
      this.servers.map(server => this.checkHealth(server))
    );

    if (options.onlineOnly) {
      return results.filter(s => s.status === 'online');
    }

    return results;
  }

  /**
   * Get list of known servers without health check
   */
  list(): ServerEntry[] {
    return [...this.servers];
  }
}

export default ServerDirectory;
