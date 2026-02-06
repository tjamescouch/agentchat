/**
 * AgentChat Identity Module
 * Ed25519 key generation, storage, and signing
 */

import crypto, { KeyObject } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  Identity as IdentityType,
  IdentityFile,
} from './types.js';

// Default identity file location
export const DEFAULT_IDENTITY_PATH: string = path.join(process.cwd(), '.agentchat', 'identity.json');

// Rotation record type
export interface RotationRecord {
  old_pubkey: string;
  old_agent_id: string;
  new_pubkey: string;
  new_agent_id: string;
  signature: string;
  timestamp: string;
}

// Revocation notice type
export interface RevocationNotice {
  type: 'REVOCATION';
  pubkey: string;
  agent_id: string;
  fingerprint: string;
  reason: string;
  timestamp: string;
  signature: string;
  rotations?: RotationRecord[];
  original_agent_id?: string;
}

// Identity data for constructor
export interface IdentityData {
  name?: string;
  pubkey: string;
  privkey?: string | null;
  created?: string;
  rotations?: RotationRecord[];
}

// Rotation chain verification result
export interface RotationChainResult {
  valid: boolean;
  errors: string[];
}

/**
 * Generate stable agent ID from pubkey
 * Returns first 8 chars of SHA256 hash (hex)
 */
export function pubkeyToAgentId(pubkey: string): string {
  const hash = crypto.createHash('sha256').update(pubkey).digest('hex');
  return hash.substring(0, 8);
}

/**
 * Validate Ed25519 public key in PEM format
 */
export function isValidPubkey(pubkey: unknown): boolean {
  if (!pubkey || typeof pubkey !== 'string') return false;

  try {
    const keyObj = crypto.createPublicKey(pubkey);
    return keyObj.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/**
 * AgentChat Identity
 * Represents an agent's Ed25519 keypair and associated metadata
 */
export class Identity {
  name?: string;
  pubkey: string;
  privkey: string | null;
  created?: string;
  rotations: RotationRecord[];

  // Lazy-load crypto key objects
  private _publicKey: KeyObject | null = null;
  private _privateKey: KeyObject | null = null;

  constructor(data: IdentityData) {
    this.name = data.name;
    this.pubkey = data.pubkey;
    this.privkey = data.privkey || null;
    this.created = data.created;
    this.rotations = data.rotations || [];
  }

  /**
   * Generate new Ed25519 keypair
   */
  static generate(name?: string): Identity {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    return new Identity({
      name,
      pubkey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
      privkey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      created: new Date().toISOString()
    });
  }

  /**
   * Load identity from JSON file
   */
  static async load(filePath: string = DEFAULT_IDENTITY_PATH): Promise<Identity> {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed: IdentityData = JSON.parse(data);
    return new Identity(parsed);
  }

  /**
   * Save identity to JSON file
   */
  async save(filePath: string = DEFAULT_IDENTITY_PATH): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const data: IdentityFile = {
      publicKey: this.pubkey,
      privateKey: this.privkey || '',
      agentId: this.getAgentId(),
      name: this.name,
      created: this.created
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), {
      mode: 0o600  // Owner read/write only
    });
  }

  /**
   * Check if identity file exists
   */
  static async exists(filePath: string = DEFAULT_IDENTITY_PATH): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get fingerprint (first 16 chars of SHA256 hash of pubkey)
   */
  getFingerprint(): string {
    const hash = crypto.createHash('sha256').update(this.pubkey).digest('hex');
    return hash.substring(0, 16);
  }

  /**
   * Get stable agent ID (first 8 chars of fingerprint)
   */
  getAgentId(): string {
    return pubkeyToAgentId(this.pubkey);
  }

  /**
   * Sign data with private key
   * Returns base64-encoded signature
   */
  sign(data: string | Buffer): string {
    if (!this.privkey) {
      throw new Error('Private key not available (identity was loaded from export)');
    }

    if (!this._privateKey) {
      this._privateKey = crypto.createPrivateKey(this.privkey);
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const signature = crypto.sign(null, buffer, this._privateKey);
    return signature.toString('base64');
  }

  /**
   * Verify a signature
   * Static method for verifying any message
   */
  static verify(data: string | Buffer, signature: string, pubkey: string): boolean {
    try {
      const keyObj = crypto.createPublicKey(pubkey);
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const sigBuffer = Buffer.from(signature, 'base64');
      return crypto.verify(null, buffer, keyObj, sigBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Export for sharing (pubkey only, no private key)
   */
  export(): Omit<IdentityData, 'privkey'> {
    return {
      name: this.name,
      pubkey: this.pubkey,
      created: this.created,
      rotations: this.rotations
    };
  }

  /**
   * Rotate to a new keypair
   * Signs the new public key with the old private key for chain of custody
   * @returns Rotation record with old_pubkey, new_pubkey, signature, timestamp
   */
  rotate(): RotationRecord {
    if (!this.privkey) {
      throw new Error('Private key not available - cannot rotate');
    }

    // Generate new keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const newPubkey = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const newPrivkey = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    // Use same timestamp for both signing and record
    const timestamp = new Date().toISOString();

    // Create rotation record content to sign
    const rotationContent = JSON.stringify({
      old_pubkey: this.pubkey,
      new_pubkey: newPubkey,
      timestamp
    });

    // Sign with old private key
    const signature = this.sign(rotationContent);

    // Create rotation record
    const rotationRecord: RotationRecord = {
      old_pubkey: this.pubkey,
      old_agent_id: this.getAgentId(),
      new_pubkey: newPubkey,
      new_agent_id: pubkeyToAgentId(newPubkey),
      signature,
      timestamp
    };

    // Update identity with new keys
    this.rotations.push(rotationRecord);
    this.pubkey = newPubkey;
    this.privkey = newPrivkey;
    this._publicKey = null;
    this._privateKey = null;

    return rotationRecord;
  }

  /**
   * Verify a rotation record
   * Checks that the signature is valid using the old public key
   */
  static verifyRotation(record: RotationRecord): boolean {
    try {
      const rotationContent = JSON.stringify({
        old_pubkey: record.old_pubkey,
        new_pubkey: record.new_pubkey,
        timestamp: record.timestamp
      });

      return Identity.verify(rotationContent, record.signature, record.old_pubkey);
    } catch {
      return false;
    }
  }

  /**
   * Verify the entire rotation chain
   */
  verifyRotationChain(): RotationChainResult {
    const errors: string[] = [];

    if (this.rotations.length === 0) {
      return { valid: true, errors: [] };
    }

    // Verify each rotation in sequence
    for (let i = 0; i < this.rotations.length; i++) {
      const record = this.rotations[i];

      // Verify signature
      if (!Identity.verifyRotation(record)) {
        errors.push(`Rotation ${i + 1}: Invalid signature`);
        continue;
      }

      // Verify chain continuity (each new_pubkey should match next old_pubkey)
      if (i < this.rotations.length - 1) {
        const nextRecord = this.rotations[i + 1];
        if (record.new_pubkey !== nextRecord.old_pubkey) {
          errors.push(`Rotation ${i + 1}: Chain break - new_pubkey doesn't match next old_pubkey`);
        }
      }
    }

    // Verify final pubkey matches current identity
    const lastRotation = this.rotations[this.rotations.length - 1];
    if (lastRotation.new_pubkey !== this.pubkey) {
      errors.push('Final rotation new_pubkey does not match current identity pubkey');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get the original (genesis) public key before any rotations
   */
  getOriginalPubkey(): string {
    if (this.rotations.length === 0) {
      return this.pubkey;
    }
    return this.rotations[0].old_pubkey;
  }

  /**
   * Get the original (genesis) agent ID
   */
  getOriginalAgentId(): string {
    return pubkeyToAgentId(this.getOriginalPubkey());
  }

  /**
   * Generate a signed revocation notice for this identity
   * A revocation notice declares that the key should no longer be trusted
   */
  revoke(reason: string = 'revoked'): RevocationNotice {
    if (!this.privkey) {
      throw new Error('Private key not available - cannot create revocation notice');
    }

    const timestamp = new Date().toISOString();

    // Create revocation content to sign
    const revocationContent = JSON.stringify({
      type: 'REVOCATION',
      pubkey: this.pubkey,
      agent_id: this.getAgentId(),
      reason,
      timestamp
    });

    // Sign with the key being revoked (proves ownership)
    const signature = this.sign(revocationContent);

    const notice: RevocationNotice = {
      type: 'REVOCATION',
      pubkey: this.pubkey,
      agent_id: this.getAgentId(),
      fingerprint: this.getFingerprint(),
      reason,
      timestamp,
      signature,
      rotations: this.rotations.length > 0 ? this.rotations : undefined,
      original_agent_id: this.rotations.length > 0 ? this.getOriginalAgentId() : undefined
    };

    return notice;
  }

  /**
   * Verify a revocation notice
   * Checks that the signature is valid using the pubkey in the notice
   */
  static verifyRevocation(notice: RevocationNotice | null | undefined): boolean {
    if (!notice || notice.type !== 'REVOCATION') {
      return false;
    }

    try {
      const revocationContent = JSON.stringify({
        type: 'REVOCATION',
        pubkey: notice.pubkey,
        agent_id: notice.agent_id,
        reason: notice.reason,
        timestamp: notice.timestamp
      });

      return Identity.verify(revocationContent, notice.signature, notice.pubkey);
    } catch {
      return false;
    }
  }

  /**
   * Check if a pubkey has been revoked by checking against a revocation notice
   */
  static isRevoked(pubkey: string, notice: RevocationNotice): boolean {
    if (!Identity.verifyRevocation(notice)) {
      return false;
    }
    return notice.pubkey === pubkey;
  }
}
