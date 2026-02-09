/**
 * Banlist Module
 * Persistent blocklist for banned agents.
 * Uses same admin key as allowlist (ALLOWLIST_ADMIN_KEY env var).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface BanEntry {
  agentId: string;
  reason: string;
  bannedAt: string;
  bannedBy: string;
}

interface BanlistOptions {
  adminKey?: string | null;
  filePath?: string;
}

interface CheckResult {
  banned: boolean;
  reason?: string;
}

interface BanResult {
  success: boolean;
  error?: string;
}

export class Banlist {
  adminKey: string | null;
  filePath: string;
  entries: Map<string, BanEntry>;

  constructor(options: BanlistOptions = {}) {
    this.adminKey = options.adminKey || null;
    this.filePath = options.filePath || path.join(process.cwd(), 'bans.json');
    this.entries = new Map();
    this._load();
  }

  /**
   * Check if an agent ID is banned.
   */
  check(agentId: string): CheckResult {
    const entry = this.entries.get(agentId);
    if (entry) {
      return { banned: true, reason: entry.reason || 'banned' };
    }
    return { banned: false };
  }

  /**
   * Ban an agent by ID. Requires valid admin key.
   */
  ban(agentId: string, adminKey: string, reason: string = ''): BanResult {
    if (!this._validateAdminKey(adminKey)) {
      return { success: false, error: 'invalid admin key' };
    }

    this.entries.set(agentId, {
      agentId,
      reason,
      bannedAt: new Date().toISOString(),
      bannedBy: 'admin',
    });

    this._save();
    return { success: true };
  }

  /**
   * Unban an agent by ID. Requires valid admin key.
   */
  unban(agentId: string, adminKey: string): BanResult {
    if (!this._validateAdminKey(adminKey)) {
      return { success: false, error: 'invalid admin key' };
    }

    if (!this.entries.has(agentId)) {
      return { success: false, error: 'agent not banned' };
    }

    this.entries.delete(agentId);
    this._save();
    return { success: true };
  }

  /**
   * List all banned entries.
   */
  list(): BanEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Validate admin key using timing-safe comparison.
   */
  _validateAdminKey(key: string | null | undefined): boolean {
    if (!this.adminKey || !key) return false;
    if (typeof key !== 'string') return false;

    const a = crypto.createHash('sha256').update(this.adminKey).digest();
    const b = crypto.createHash('sha256').update(key).digest();
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Load banlist from disk.
   */
  _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const entry of data) {
          this.entries.set(entry.agentId, {
            agentId: entry.agentId,
            reason: entry.reason || '',
            bannedAt: entry.bannedAt,
            bannedBy: entry.bannedBy || 'admin',
          });
        }
      }
    } catch (err) {
      console.error(`Failed to load banlist from ${this.filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Save banlist to disk.
   */
  _save(): void {
    try {
      const data = Array.from(this.entries.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Failed to save banlist to ${this.filePath}: ${(err as Error).message}`);
    }
  }
}
