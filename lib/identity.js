/**
 * AgentChat Identity Module
 * Ed25519 key generation, storage, and signing
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Default identity file location
export const DEFAULT_IDENTITY_PATH = path.join(process.cwd(), '.agentchat', 'identity.json');

/**
 * Generate stable agent ID from pubkey
 * Returns first 8 chars of SHA256 hash (hex)
 */
export function pubkeyToAgentId(pubkey) {
  const hash = crypto.createHash('sha256').update(pubkey).digest('hex');
  return hash.substring(0, 8);
}

/**
 * Validate Ed25519 public key in PEM format
 */
export function isValidPubkey(pubkey) {
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
  constructor(data) {
    this.name = data.name;
    this.pubkey = data.pubkey;      // PEM format
    this.privkey = data.privkey;    // PEM format (null if loaded from export)
    this.created = data.created;

    // Lazy-load crypto key objects
    this._publicKey = null;
    this._privateKey = null;
  }

  /**
   * Generate new Ed25519 keypair
   */
  static generate(name) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    return new Identity({
      name,
      pubkey: publicKey.export({ type: 'spki', format: 'pem' }),
      privkey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      created: new Date().toISOString()
    });
  }

  /**
   * Load identity from JSON file
   */
  static async load(filePath = DEFAULT_IDENTITY_PATH) {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return new Identity(parsed);
  }

  /**
   * Save identity to JSON file
   */
  async save(filePath = DEFAULT_IDENTITY_PATH) {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const data = {
      name: this.name,
      pubkey: this.pubkey,
      privkey: this.privkey,
      created: this.created
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), {
      mode: 0o600  // Owner read/write only
    });
  }

  /**
   * Check if identity file exists
   */
  static async exists(filePath = DEFAULT_IDENTITY_PATH) {
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
  getFingerprint() {
    const hash = crypto.createHash('sha256').update(this.pubkey).digest('hex');
    return hash.substring(0, 16);
  }

  /**
   * Get stable agent ID (first 8 chars of fingerprint)
   */
  getAgentId() {
    return pubkeyToAgentId(this.pubkey);
  }

  /**
   * Sign data with private key
   * Returns base64-encoded signature
   */
  sign(data) {
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
  static verify(data, signature, pubkey) {
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
  export() {
    return {
      name: this.name,
      pubkey: this.pubkey,
      created: this.created
    };
  }
}
