/**
 * Allowlist Module
 * Controls which public keys can connect to the server.
 * Opt-in via ALLOWLIST_ENABLED=true env var.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pubkeyToAgentId } from './protocol.js';

interface AllowlistEntry {
  agentId: string;
  approvedAt: string;
  approvedBy: string;
  note: string;
}

interface AllowlistOptions {
  enabled?: boolean;
  strict?: boolean;
  adminKey?: string | null;
  filePath?: string;
}

interface CheckResult {
  allowed: boolean;
  reason: string;
}

interface ApproveResult {
  success: boolean;
  error?: string;
  agentId?: string;
}

interface RevokeResult {
  success: boolean;
  error?: string;
}

interface ListEntry {
  agentId: string;
  pubkeyPrefix: string;
  approvedAt: string;
  note: string;
}

export class Allowlist {
  enabled: boolean;
  strict: boolean;
  adminKey: string | null;
  filePath: string;
  entries: Map<string, AllowlistEntry>;

  constructor(options: AllowlistOptions = {}) {
    this.enabled = options.enabled || false;
    this.strict = options.strict || false;
    this.adminKey = options.adminKey || null;
    this.filePath = options.filePath || path.join(process.cwd(), 'allowlist.json');
    this.entries = new Map();

    if (this.enabled) {
      this._load();
    }
  }

  /**
   * Check if a pubkey is allowed to connect.
   */
  check(pubkey: string | null): CheckResult {
    if (!this.enabled) {
      return { allowed: true, reason: 'allowlist disabled' };
    }

    if (!pubkey) {
      if (this.strict) {
        return { allowed: false, reason: 'ephemeral connections blocked in strict mode' };
      }
      return { allowed: true, reason: 'ephemeral allowed (non-strict mode)' };
    }

    if (this.entries.has(pubkey)) {
      return { allowed: true, reason: 'pubkey approved' };
    }

    return { allowed: false, reason: 'pubkey not in allowlist' };
  }

  /**
   * Approve a pubkey for connection.
   * Requires valid admin key.
   */
  approve(pubkey: string, adminKey: string, note: string = ''): ApproveResult {
    if (!this._validateAdminKey(adminKey)) {
      return { success: false, error: 'invalid admin key' };
    }

    const agentId = pubkeyToAgentId(pubkey);
    this.entries.set(pubkey, {
      agentId,
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin',
      note,
    });

    this._save();
    return { success: true, agentId };
  }

  /**
   * Revoke a pubkey from the allowlist.
   * Can revoke by pubkey or agentId.
   */
  revoke(identifier: string, adminKey: string): RevokeResult {
    if (!this._validateAdminKey(adminKey)) {
      return { success: false, error: 'invalid admin key' };
    }

    // Try by pubkey first
    if (this.entries.has(identifier)) {
      this.entries.delete(identifier);
      this._save();
      return { success: true };
    }

    // Try by agentId
    for (const [pubkey, entry] of this.entries) {
      if (entry.agentId === identifier) {
        this.entries.delete(pubkey);
        this._save();
        return { success: true };
      }
    }

    return { success: false, error: 'not found' };
  }

  /**
   * List all approved entries.
   */
  list(): ListEntry[] {
    const result: ListEntry[] = [];
    for (const [pubkey, entry] of this.entries) {
      result.push({
        agentId: `@${entry.agentId}`,
        pubkeyPrefix: pubkey.slice(0, 40) + '...',
        approvedAt: entry.approvedAt,
        note: entry.note,
      });
    }
    return result;
  }

  /**
   * Validate admin key using timing-safe comparison.
   * Hash both values first to ensure equal length (avoids length timing oracle).
   */
  _validateAdminKey(key: string | null | undefined): boolean {
    if (!this.adminKey || !key) return false;
    if (typeof key !== 'string') return false;

    const a = crypto.createHash('sha256').update(this.adminKey).digest();
    const b = crypto.createHash('sha256').update(key).digest();
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Load allowlist from disk.
   */
  _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const entry of data) {
          this.entries.set(entry.pubkey, {
            agentId: entry.agentId,
            approvedAt: entry.approvedAt,
            approvedBy: entry.approvedBy || 'admin',
            note: entry.note || '',
          });
        }
      }
    } catch (err) {
      console.error(`Failed to load allowlist from ${this.filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Save allowlist to disk.
   */
  _save(): void {
    try {
      const data: Array<{ pubkey: string } & AllowlistEntry> = [];
      for (const [pubkey, entry] of this.entries) {
        data.push({ pubkey, ...entry });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Failed to save allowlist to ${this.filePath}: ${(err as Error).message}`);
    }
  }
}
