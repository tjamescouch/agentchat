/**
 * AgentChat Receipts Module
 * Stores and manages COMPLETE receipts for portable reputation
 *
 * Receipts are proof of completed work between agents.
 * They can be exported for reputation aggregation.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDefaultStore } from './reputation.js';
import type { RatingChanges } from './reputation.js';

// ============ Types ============

export interface ProposalInfo {
  from?: string;
  to?: string;
  task?: string;
  amount?: number;
  currency?: string;
}

export interface Receipt {
  type?: string;
  status?: string;
  proposal_id?: string;
  proposal?: ProposalInfo;
  from?: string;
  to?: string;
  amount?: number;
  currency?: string;
  completed_by?: string;
  completed_at?: number;
  disputed_at?: number;
  stored_at?: number;
  ts?: number;
  proof?: string;
  _ratingChanges?: RatingChanges;
}

export interface StoredReceipt extends Receipt {
  stored_at: number;
}

export interface AppendReceiptOptions {
  updateRatings?: boolean;
}

export interface ReceiptStats {
  count: number;
  counterparties: string[];
  dateRange: {
    oldest: string;
    newest: string;
  } | null;
  currencies: Record<string, CurrencyStats>;
}

export interface CurrencyStats {
  count: number;
  totalAmount: number;
}

// ============ Constants ============

// Default receipts file location
const AGENTCHAT_DIR = path.join(process.cwd(), '.agentchat');
export const DEFAULT_RECEIPTS_PATH = path.join(AGENTCHAT_DIR, 'receipts.jsonl');

// ============ Functions ============

/**
 * Append a receipt to the receipts file
 * @param receipt - The COMPLETE message/receipt to store
 * @param receiptsPath - Path to receipts file
 * @param options - Options
 * @param options.updateRatings - Whether to update ELO ratings (default: true)
 */
export async function appendReceipt(
  receipt: Receipt,
  receiptsPath: string = DEFAULT_RECEIPTS_PATH,
  options: AppendReceiptOptions = {}
): Promise<StoredReceipt> {
  const { updateRatings = true } = options;

  // Ensure directory exists
  await fsp.mkdir(path.dirname(receiptsPath), { recursive: true });

  // Add storage timestamp
  const storedReceipt: StoredReceipt = {
    ...receipt,
    stored_at: Date.now()
  };

  const line = JSON.stringify(storedReceipt) + '\n';
  await fsp.appendFile(receiptsPath, line);

  // Update ELO ratings if enabled
  if (updateRatings) {
    try {
      const store = getDefaultStore();
      const ratingChanges = await store.updateRatings(storedReceipt);
      if (ratingChanges) {
        storedReceipt._ratingChanges = ratingChanges;
      }
    } catch (err: any) {
      // Log but don't fail receipt storage if rating update fails
      console.error(`Warning: Failed to update ratings: ${err.message}`);
    }
  }

  return storedReceipt;
}

/**
 * Read all receipts from the receipts file
 * @param receiptsPath - Path to receipts file
 * @returns Array of receipt objects
 */
export async function readReceipts(receiptsPath: string = DEFAULT_RECEIPTS_PATH): Promise<Receipt[]> {
  try {
    const content = await fsp.readFile(receiptsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    return lines.map(line => {
      try {
        return JSON.parse(line) as Receipt;
      } catch {
        return null;
      }
    }).filter((r): r is Receipt => r !== null);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return []; // No receipts file yet
    }
    throw err;
  }
}

/**
 * Filter receipts by agent ID (where agent is a party)
 * @param receipts - Array of receipts
 * @param agentId - Agent ID to filter by
 * @returns Filtered receipts
 */
export function filterByAgent(receipts: Receipt[], agentId: string): Receipt[] {
  const normalizedId = agentId.startsWith('@') ? agentId : `@${agentId}`;
  return receipts.filter(r =>
    r.from === normalizedId ||
    r.to === normalizedId ||
    r.completed_by === normalizedId ||
    // Also check proposal parties if available
    r.proposal?.from === normalizedId ||
    r.proposal?.to === normalizedId
  );
}

/**
 * Get unique counterparties from receipts
 * @param receipts - Array of receipts
 * @param agentId - Our agent ID
 * @returns Array of unique counterparty IDs
 */
export function getCounterparties(receipts: Receipt[], agentId: string): string[] {
  const normalizedId = agentId.startsWith('@') ? agentId : `@${agentId}`;
  const counterparties = new Set<string>();

  for (const r of receipts) {
    // Check from/to fields
    if (r.from && r.from !== normalizedId) counterparties.add(r.from);
    if (r.to && r.to !== normalizedId) counterparties.add(r.to);

    // Check proposal parties
    if (r.proposal?.from && r.proposal.from !== normalizedId) {
      counterparties.add(r.proposal.from);
    }
    if (r.proposal?.to && r.proposal.to !== normalizedId) {
      counterparties.add(r.proposal.to);
    }
  }

  return Array.from(counterparties);
}

/**
 * Get receipt statistics
 * @param receipts - Array of receipts
 * @param agentId - Optional agent ID for filtering
 * @returns Statistics object
 */
export function getStats(receipts: Receipt[], agentId: string | null = null): ReceiptStats {
  let filtered = receipts;
  if (agentId) {
    filtered = filterByAgent(receipts, agentId);
  }

  if (filtered.length === 0) {
    return {
      count: 0,
      counterparties: [],
      dateRange: null,
      currencies: {}
    };
  }

  // Get date range
  const timestamps = filtered
    .map(r => r.completed_at || r.ts || r.stored_at)
    .filter((t): t is number => t !== undefined)
    .sort((a, b) => a - b);

  // Count currencies/amounts
  const currencies: Record<string, CurrencyStats> = {};
  for (const r of filtered) {
    const currency = r.proposal?.currency || r.currency || 'unknown';
    const amount = r.proposal?.amount || r.amount || 0;

    if (!currencies[currency]) {
      currencies[currency] = { count: 0, totalAmount: 0 };
    }
    currencies[currency].count++;
    currencies[currency].totalAmount += amount;
  }

  return {
    count: filtered.length,
    counterparties: agentId ? getCounterparties(filtered, agentId) : [],
    dateRange: timestamps.length > 0 ? {
      oldest: new Date(timestamps[0]).toISOString(),
      newest: new Date(timestamps[timestamps.length - 1]).toISOString()
    } : null,
    currencies
  };
}

/**
 * Export receipts in specified format
 * @param receipts - Array of receipts
 * @param format - 'json' or 'yaml'
 * @returns Formatted output
 */
export function exportReceipts(receipts: Receipt[], format: 'json' | 'yaml' = 'json'): string {
  if (format === 'yaml') {
    // Simple YAML-like output
    let output = 'receipts:\n';
    for (const r of receipts) {
      output += `  - proposal_id: ${r.proposal_id || 'unknown'}\n`;
      output += `    completed_at: ${r.completed_at ? new Date(r.completed_at).toISOString() : 'unknown'}\n`;
      output += `    completed_by: ${r.completed_by || 'unknown'}\n`;
      if (r.proof) output += `    proof: ${r.proof}\n`;
      if (r.proposal) {
        output += `    proposal:\n`;
        output += `      from: ${r.proposal.from}\n`;
        output += `      to: ${r.proposal.to}\n`;
        output += `      task: ${r.proposal.task}\n`;
        if (r.proposal.amount) output += `      amount: ${r.proposal.amount}\n`;
        if (r.proposal.currency) output += `      currency: ${r.proposal.currency}\n`;
      }
      output += '\n';
    }
    return output;
  }

  // Default: JSON
  return JSON.stringify(receipts, null, 2);
}

/**
 * Check if a receipt should be stored (we are a party to it)
 * @param completeMsg - The COMPLETE message
 * @param ourAgentId - Our agent ID
 * @returns boolean
 */
export function shouldStoreReceipt(completeMsg: Receipt, ourAgentId: string): boolean {
  const normalizedId = ourAgentId.startsWith('@') ? ourAgentId : `@${ourAgentId}`;

  // Check if we're a party to this completion
  return (
    completeMsg.from === normalizedId ||
    completeMsg.to === normalizedId ||
    completeMsg.completed_by === normalizedId ||
    completeMsg.proposal?.from === normalizedId ||
    completeMsg.proposal?.to === normalizedId
  );
}

// ============ ReceiptStore Class ============

/**
 * ReceiptStore class for managing receipts
 */
export class ReceiptStore {
  private receiptsPath: string;
  private _receipts: Receipt[] | null;

  constructor(receiptsPath: string = DEFAULT_RECEIPTS_PATH) {
    this.receiptsPath = receiptsPath;
    this._receipts = null; // Lazy load
  }

  /**
   * Load receipts from file
   */
  async load(): Promise<Receipt[]> {
    this._receipts = await readReceipts(this.receiptsPath);
    return this._receipts;
  }

  /**
   * Get all receipts (loads if needed)
   */
  async getAll(): Promise<Receipt[]> {
    if (this._receipts === null) {
      await this.load();
    }
    return this._receipts!;
  }

  /**
   * Add a receipt
   */
  async add(receipt: Receipt): Promise<StoredReceipt> {
    const stored = await appendReceipt(receipt, this.receiptsPath);
    if (this._receipts !== null) {
      this._receipts.push(stored);
    }
    return stored;
  }

  /**
   * Get receipts for an agent
   */
  async getForAgent(agentId: string): Promise<Receipt[]> {
    const all = await this.getAll();
    return filterByAgent(all, agentId);
  }

  /**
   * Get statistics
   */
  async getStats(agentId: string | null = null): Promise<ReceiptStats> {
    const all = await this.getAll();
    return getStats(all, agentId);
  }

  /**
   * Export receipts
   */
  async export(format: 'json' | 'yaml' = 'json', agentId: string | null = null): Promise<string> {
    let receipts = await this.getAll();
    if (agentId) {
      receipts = filterByAgent(receipts, agentId);
    }
    return exportReceipts(receipts, format);
  }
}
