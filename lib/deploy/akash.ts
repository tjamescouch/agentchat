/**
 * Akash Network Deployment Module
 *
 * Enables self-service deployment to Akash decentralized cloud.
 *
 * DISCLAIMER: This is infrastructure tooling, not a cryptocurrency product.
 * AKT tokens are used solely to pay for compute resources.
 * You are responsible for your own wallet security and funds.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

// ============ Types ============

/**
 * Akash network configuration
 */
export interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  prefix: string;
}

/**
 * Wallet data structure
 */
export interface WalletData {
  mnemonic: string;
  address: string;
  pubkey: string;
  network?: string;
  created?: string;
}

/**
 * Wallet file format (versioned)
 */
export interface WalletFile {
  version: number;
  network: string;
  address: string;
  pubkey: string;
  mnemonic: string;
  created: string;
}

/**
 * Wallet info for display (no sensitive data)
 */
export interface WalletInfo {
  address: string;
  network: string;
  created: string;
}

/**
 * Balance information
 */
export interface BalanceInfo {
  uakt: string;
  akt: string;
  sufficient: boolean;
}

/**
 * SDL generation options
 */
export interface SDLOptions {
  name?: string;
  port?: number;
  cpu?: number;
  memory?: number;
  storage?: number;
  logMessages?: boolean;
  image?: string;
}

/**
 * Deployment creation options
 */
export interface DeploymentOptions {
  walletPath?: string;
  dseq?: string;
  deposit?: string;
  name?: string;
  port?: number;
  cpu?: number;
  memory?: number;
  storage?: number;
  logMessages?: boolean;
  image?: string;
}

/**
 * Local deployment record
 */
export interface DeploymentRecord {
  dseq: string;
  owner: string;
  txHash: string;
  status: string;
  createdAt: string;
  sdl: string;
  provider?: string;
  leaseCreatedAt?: string;
  manifestSent?: boolean;
  manifestSentAt?: string;
  closedAt?: string;
}

/**
 * Deployment creation result
 */
export interface DeploymentResult {
  dseq: string;
  txHash: string;
  status: string;
  manifest: unknown;
  provider?: string;
  gseq?: number;
  oseq?: number;
  endpoint?: string;
}

/**
 * Lease creation result
 */
export interface LeaseResult {
  dseq: string;
  provider: string;
  gseq: number;
  oseq: number;
  txHash: string;
}

/**
 * Close deployment result
 */
export interface CloseDeploymentResult {
  dseq: string;
  txHash: string;
  status: string;
}

/**
 * Bid information
 */
export interface BidInfo {
  provider: string;
  price: string;
  state: string;
}

/**
 * Deployment status with bids
 */
export interface DeploymentStatusWithBids extends DeploymentRecord {
  bids?: BidInfo[];
}

/**
 * Deployment status with lease
 */
export interface DeploymentStatusWithLease extends DeploymentRecord {
  leaseStatus?: unknown;
  leaseStatusError?: string;
}

/**
 * Certificate data
 */
export interface CertificateData {
  cert: string;
  privateKey: string;
  publicKey: string;
}

// ============ Constants ============

// Default paths
const AKASH_DIR = path.join(os.homedir(), '.agentchat');
export const WALLET_PATH = path.join(AKASH_DIR, 'akash-wallet.json');
export const DEPLOYMENTS_PATH = path.join(AKASH_DIR, 'akash-deployments.json');
export const CERTIFICATE_PATH = path.join(AKASH_DIR, 'akash-cert.json');

// Network configuration
export const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    chainId: 'akashnet-2',
    rpcEndpoint: 'https://rpc.akashnet.net:443',
    restEndpoint: 'https://api.akashnet.net:443',
    prefix: 'akash'
  },
  testnet: {
    chainId: 'sandbox-01',
    rpcEndpoint: 'https://rpc.sandbox-01.aksh.pw:443',
    restEndpoint: 'https://api.sandbox-01.aksh.pw:443',
    prefix: 'akash'
  }
};

// Default deposit amount (5 AKT in uakt)
const DEFAULT_DEPOSIT = '5000000';

// ============ AkashWallet Class ============

/**
 * Akash Wallet - manages keypair and signing
 */
export class AkashWallet {
  mnemonic: string;
  address: string;
  pubkey: string;
  network: string;
  created: string;

  constructor(data: WalletData) {
    this.mnemonic = data.mnemonic;
    this.address = data.address;
    this.pubkey = data.pubkey;
    this.network = data.network || 'testnet';
    this.created = data.created || new Date().toISOString();
  }

  /**
   * Generate a new wallet
   */
  static async generate(network: string = 'testnet'): Promise<AkashWallet> {
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');

    const wallet = await DirectSecp256k1HdWallet.generate(24, {
      prefix: NETWORKS[network].prefix
    });

    const [account] = await wallet.getAccounts();

    return new AkashWallet({
      mnemonic: wallet.mnemonic,
      address: account.address,
      pubkey: Buffer.from(account.pubkey).toString('base64'),
      network,
      created: new Date().toISOString()
    });
  }

  /**
   * Load wallet from mnemonic
   */
  static async fromMnemonic(mnemonic: string, network: string = 'testnet'): Promise<AkashWallet> {
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: NETWORKS[network].prefix
    });

    const [account] = await wallet.getAccounts();

    return new AkashWallet({
      mnemonic,
      address: account.address,
      pubkey: Buffer.from(account.pubkey).toString('base64'),
      network
    });
  }

  /**
   * Get signing wallet instance
   */
  async getSigningWallet(): Promise<import('@cosmjs/proto-signing').DirectSecp256k1HdWallet> {
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
    return DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic, {
      prefix: NETWORKS[this.network].prefix
    });
  }

  /**
   * Save wallet to file
   */
  async save(filePath: string = WALLET_PATH): Promise<string> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const data: WalletFile = {
      version: 1,
      network: this.network,
      address: this.address,
      pubkey: this.pubkey,
      mnemonic: this.mnemonic,
      created: this.created
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    return filePath;
  }

  /**
   * Load wallet from file
   */
  static async load(filePath: string = WALLET_PATH): Promise<AkashWallet> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data: WalletFile = JSON.parse(content);

    if (data.version !== 1) {
      throw new Error(`Unsupported wallet version: ${data.version}`);
    }

    return new AkashWallet(data);
  }

  /**
   * Check if wallet file exists
   */
  static async exists(filePath: string = WALLET_PATH): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get wallet info for display (no sensitive data)
   */
  getInfo(): WalletInfo {
    return {
      address: this.address,
      network: this.network,
      created: this.created
    };
  }
}

// ============ SDL Generation ============

/**
 * Generate SDL (Stack Definition Language) for agentchat server
 */
export function generateSDL(options: SDLOptions = {}): string {
  const config = {
    name: options.name || 'agentchat',
    port: options.port || 6667,
    cpu: options.cpu || 0.5,
    memory: options.memory || 512,
    storage: options.storage || 1,
    logMessages: options.logMessages || false
  };

  const sdl = {
    version: '2.0',
    services: {
      agentchat: {
        image: options.image || 'ghcr.io/anthropics/agentchat:latest',
        expose: [
          {
            port: config.port,
            as: 80,
            to: [{ global: true }]
          }
        ],
        env: [
          `PORT=${config.port}`,
          'HOST=0.0.0.0',
          `SERVER_NAME=${config.name}`,
          `LOG_MESSAGES=${config.logMessages}`
        ]
      }
    },
    profiles: {
      compute: {
        agentchat: {
          resources: {
            cpu: { units: config.cpu },
            memory: { size: `${config.memory}Mi` },
            storage: { size: `${config.storage}Gi` }
          }
        }
      },
      placement: {
        dcloud: {
          pricing: {
            agentchat: {
              denom: 'uakt',
              amount: 1000
            }
          }
        }
      }
    },
    deployment: {
      agentchat: {
        dcloud: {
          profile: 'agentchat',
          count: 1
        }
      }
    }
  };

  return yaml.dump(sdl, { lineWidth: -1 });
}

// ============ AkashClient Class ============

/**
 * Akash deployment client
 */
export class AkashClient {
  wallet: AkashWallet;
  network: NetworkConfig;

  constructor(wallet: AkashWallet) {
    this.wallet = wallet;
    this.network = NETWORKS[wallet.network];
  }

  /**
   * Get signing client for transactions
   */
  async getSigningClient(): Promise<import('@cosmjs/stargate').SigningStargateClient> {
    const { SigningStargateClient } = await import('@cosmjs/stargate');
    const { getAkashTypeRegistry } = await import('@akashnetwork/akashjs/build/stargate/index.js');
    const { Registry } = await import('@cosmjs/proto-signing');

    const signingWallet = await this.wallet.getSigningWallet();
    const registry = new Registry(getAkashTypeRegistry());

    return SigningStargateClient.connectWithSigner(
      this.network.rpcEndpoint,
      signingWallet,
      { registry }
    );
  }

  /**
   * Query account balance
   */
  async getBalance(): Promise<BalanceInfo> {
    const { StargateClient } = await import('@cosmjs/stargate');

    let client: import('@cosmjs/stargate').StargateClient;
    try {
      client = await StargateClient.connect(this.network.rpcEndpoint);
    } catch (err) {
      throw new Error(
        `Failed to connect to ${this.wallet.network} RPC endpoint.\n` +
        `Network: ${this.network.rpcEndpoint}\n` +
        `The network may be temporarily unavailable. Try again later.`
      );
    }

    const balance = await client.getBalance(this.wallet.address, 'uakt');
    const akt = parseInt(balance.amount) / 1_000_000;

    return {
      uakt: balance.amount,
      akt: akt.toFixed(6),
      sufficient: parseInt(balance.amount) >= 5_000_000
    };
  }

  /**
   * Create a deployment on Akash
   */
  async createDeployment(sdlContent: string, options: DeploymentOptions = {}): Promise<DeploymentResult> {
    const { SDL } = await import('@akashnetwork/akashjs/build/sdl/SDL/SDL.js');
    const { MsgCreateDeployment } = await import('@akashnetwork/akash-api/v1beta3');
    const { Message } = await import('@akashnetwork/akashjs/build/stargate/index.js');

    // Parse SDL
    const sdl = SDL.fromString(sdlContent, 'beta3');

    // Get signing client
    const client = await this.getSigningClient();
    const blockHeight = await client.getHeight();

    // Create deployment ID
    const dseq = options.dseq || blockHeight.toString();

    // Build deployment message
    const groups = sdl.groups();
    const manifestVersion = await sdl.manifestVersion();

    const deploymentMsg = {
      id: {
        owner: this.wallet.address,
        dseq: dseq
      },
      groups: groups,
      deposit: {
        denom: 'uakt',
        amount: options.deposit || DEFAULT_DEPOSIT
      },
      version: manifestVersion,
      depositor: this.wallet.address
    };

    const msg = {
      typeUrl: Message.MsgCreateDeployment,
      value: MsgCreateDeployment.fromPartial(deploymentMsg)
    };

    // Broadcast transaction
    const fee = {
      amount: [{ denom: 'uakt', amount: '25000' }],
      gas: '500000'
    };

    console.log('Broadcasting deployment transaction...');
    const tx = await client.signAndBroadcast(
      this.wallet.address,
      [msg],
      fee,
      'agentchat deployment'
    );

    if (tx.code !== 0) {
      throw new Error(`Deployment failed: ${tx.rawLog}`);
    }

    console.log(`Deployment created: dseq=${dseq}, tx=${tx.transactionHash}`);

    // Save deployment record
    await this.saveDeployment({
      dseq,
      owner: this.wallet.address,
      txHash: tx.transactionHash,
      status: 'pending_bids',
      createdAt: new Date().toISOString(),
      sdl: sdlContent
    });

    return {
      dseq,
      txHash: tx.transactionHash,
      status: 'pending_bids',
      manifest: sdl.manifest()
    };
  }

  /**
   * Query bids for a deployment
   */
  async queryBids(dseq: string): Promise<unknown[]> {
    const url = `${this.network.restEndpoint}/akash/market/v1beta4/bids/list?filters.owner=${this.wallet.address}&filters.dseq=${dseq}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to query bids: ${response.statusText}`);
    }

    const data = await response.json() as { bids?: unknown[] };
    return data.bids || [];
  }

  /**
   * Accept a bid and create a lease
   */
  async createLease(dseq: string, provider: string, gseq: number = 1, oseq: number = 1): Promise<LeaseResult> {
    const { MsgCreateLease } = await import('@akashnetwork/akash-api/v1beta3');
    const { Message } = await import('@akashnetwork/akashjs/build/stargate/index.js');

    const client = await this.getSigningClient();

    const leaseMsg = {
      bidId: {
        owner: this.wallet.address,
        dseq: dseq,
        gseq: gseq,
        oseq: oseq,
        provider: provider
      }
    };

    const msg = {
      typeUrl: Message.MsgCreateLease,
      value: MsgCreateLease.fromPartial(leaseMsg)
    };

    const fee = {
      amount: [{ denom: 'uakt', amount: '25000' }],
      gas: '500000'
    };

    console.log('Creating lease...');
    const tx = await client.signAndBroadcast(
      this.wallet.address,
      [msg],
      fee,
      'create lease'
    );

    if (tx.code !== 0) {
      throw new Error(`Lease creation failed: ${tx.rawLog}`);
    }

    console.log(`Lease created: provider=${provider}, tx=${tx.transactionHash}`);

    // Update deployment record
    await this.updateDeployment(dseq, {
      status: 'active',
      provider,
      leaseCreatedAt: new Date().toISOString()
    });

    return {
      dseq,
      provider,
      gseq,
      oseq,
      txHash: tx.transactionHash
    };
  }

  /**
   * Send manifest to provider
   */
  async sendManifest(dseq: string, provider: string, manifest: unknown): Promise<{ success: boolean }> {
    const certificateModule = await import('@akashnetwork/akashjs/build/certificates/index.js');

    // Load or create certificate
    let cert: CertificateData;
    try {
      const certData = await fs.readFile(CERTIFICATE_PATH, 'utf-8');
      cert = JSON.parse(certData) as CertificateData;
    } catch {
      // Generate new certificate
      console.log('Generating deployment certificate...');
      const generated = await certificateModule.createCertificate(this.wallet.address);
      cert = {
        cert: generated.cert,
        privateKey: generated.privateKey,
        publicKey: generated.publicKey
      };
      await fs.writeFile(CERTIFICATE_PATH, JSON.stringify(cert, null, 2), { mode: 0o600 });
    }

    // Query provider info to get hostUri
    const providerUrl = `${this.network.restEndpoint}/akash/provider/v1beta3/providers/${provider}`;
    const providerResponse = await fetch(providerUrl);
    if (!providerResponse.ok) {
      throw new Error(`Failed to get provider info: ${providerResponse.statusText}`);
    }
    const providerInfo = await providerResponse.json() as { provider?: { hostUri?: string } };
    const hostUri = providerInfo.provider?.hostUri;

    if (!hostUri) {
      throw new Error('Provider hostUri not found');
    }

    // Send manifest
    const manifestUrl = `${hostUri}/deployment/${dseq}/manifest`;
    console.log(`Sending manifest to ${manifestUrl}...`);

    const response = await fetch(manifestUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(manifest)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send manifest: ${response.statusText} - ${text}`);
    }

    console.log('Manifest sent successfully');

    // Update deployment record
    await this.updateDeployment(dseq, {
      manifestSent: true,
      manifestSentAt: new Date().toISOString()
    });

    return { success: true };
  }

  /**
   * Get lease status from provider
   */
  async getLeaseStatus(dseq: string, provider: string, gseq: number = 1, oseq: number = 1): Promise<unknown> {
    // Query provider info
    const providerUrl = `${this.network.restEndpoint}/akash/provider/v1beta3/providers/${provider}`;
    const providerResponse = await fetch(providerUrl);
    if (!providerResponse.ok) {
      throw new Error(`Failed to get provider info: ${providerResponse.statusText}`);
    }
    const providerInfo = await providerResponse.json() as { provider?: { hostUri?: string } };
    const hostUri = providerInfo.provider?.hostUri;

    if (!hostUri) {
      throw new Error('Provider hostUri not found');
    }

    // Query lease status
    const statusUrl = `${hostUri}/lease/${dseq}/${gseq}/${oseq}/status`;
    const response = await fetch(statusUrl);

    if (!response.ok) {
      throw new Error(`Failed to get lease status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Close a deployment
   */
  async closeDeployment(dseq: string): Promise<CloseDeploymentResult> {
    const { MsgCloseDeployment } = await import('@akashnetwork/akash-api/v1beta3');
    const { Message } = await import('@akashnetwork/akashjs/build/stargate/index.js');

    const client = await this.getSigningClient();

    const closeMsg = {
      id: {
        owner: this.wallet.address,
        dseq: dseq
      }
    };

    const msg = {
      typeUrl: Message.MsgCloseDeployment,
      value: MsgCloseDeployment.fromPartial(closeMsg)
    };

    const fee = {
      amount: [{ denom: 'uakt', amount: '25000' }],
      gas: '500000'
    };

    console.log('Closing deployment...');
    const tx = await client.signAndBroadcast(
      this.wallet.address,
      [msg],
      fee,
      'close deployment'
    );

    if (tx.code !== 0) {
      throw new Error(`Failed to close deployment: ${tx.rawLog}`);
    }

    // Update deployment record
    await this.updateDeployment(dseq, {
      status: 'closed',
      closedAt: new Date().toISOString()
    });

    return { dseq, txHash: tx.transactionHash, status: 'closed' };
  }

  /**
   * Save deployment to local records
   */
  async saveDeployment(deployment: DeploymentRecord): Promise<void> {
    let deployments: DeploymentRecord[] = [];
    try {
      const content = await fs.readFile(DEPLOYMENTS_PATH, 'utf-8');
      deployments = JSON.parse(content) as DeploymentRecord[];
    } catch {
      // File doesn't exist yet
    }

    deployments.push(deployment);
    await fs.writeFile(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2));
  }

  /**
   * Update deployment in local records
   */
  async updateDeployment(dseq: string, updates: Partial<DeploymentRecord>): Promise<void> {
    let deployments: DeploymentRecord[] = [];
    try {
      const content = await fs.readFile(DEPLOYMENTS_PATH, 'utf-8');
      deployments = JSON.parse(content) as DeploymentRecord[];
    } catch {
      return;
    }

    const index = deployments.findIndex(d => d.dseq === dseq);
    if (index !== -1) {
      deployments[index] = { ...deployments[index], ...updates };
      await fs.writeFile(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2));
    }
  }

  /**
   * List local deployment records
   */
  async listDeployments(): Promise<DeploymentRecord[]> {
    try {
      const content = await fs.readFile(DEPLOYMENTS_PATH, 'utf-8');
      return JSON.parse(content) as DeploymentRecord[];
    } catch {
      return [];
    }
  }
}

// ============ High-level deployment functions for CLI ============

export async function generateWallet(network: string = 'testnet', walletPath: string = WALLET_PATH): Promise<AkashWallet> {
  if (await AkashWallet.exists(walletPath)) {
    throw new Error(
      `Wallet already exists at ${walletPath}\n` +
      'Use --force to overwrite (WARNING: This will destroy your existing wallet!)'
    );
  }

  const wallet = await AkashWallet.generate(network);
  await wallet.save(walletPath);

  return wallet;
}

export async function checkBalance(walletPath: string = WALLET_PATH): Promise<{ wallet: WalletInfo; balance: BalanceInfo }> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  return {
    wallet: wallet.getInfo(),
    balance: await client.getBalance()
  };
}

export async function createDeployment(options: DeploymentOptions = {}): Promise<DeploymentResult> {
  const walletPath = options.walletPath || WALLET_PATH;
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  // Check balance first
  const balance = await client.getBalance();
  if (!balance.sufficient) {
    throw new Error(
      `Insufficient balance: ${balance.akt} AKT\n` +
      `Need at least 5 AKT for deployment.\n` +
      `Fund your wallet: ${wallet.address}`
    );
  }

  // Generate SDL
  const sdl = generateSDL(options);

  // Create deployment
  const deployment = await client.createDeployment(sdl, options);

  // Wait for bids
  console.log('Waiting for bids (30 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Query bids
  const bids = await client.queryBids(deployment.dseq) as Array<{
    bid?: {
      state?: string;
      price?: { amount?: string };
      bidId?: { provider?: string; gseq?: number; oseq?: number };
    };
  }>;

  if (bids.length === 0) {
    console.log('No bids received. Deployment is pending.');
    console.log(`Check status with: agentchat deploy --provider akash --status`);
    return deployment;
  }

  // Select best bid (lowest price)
  const sortedBids = bids
    .filter(b => b.bid?.state === 'open')
    .sort((a, b) => parseInt(a.bid?.price?.amount || '0') - parseInt(b.bid?.price?.amount || '0'));

  if (sortedBids.length === 0) {
    console.log('No open bids available.');
    return deployment;
  }

  const bestBid = sortedBids[0];
  const provider = bestBid.bid?.bidId?.provider;

  if (!provider) {
    console.log('No valid provider found in bids.');
    return deployment;
  }

  console.log(`Accepting bid from provider: ${provider}`);

  // Create lease
  const lease = await client.createLease(
    deployment.dseq,
    provider,
    bestBid.bid?.bidId?.gseq || 1,
    bestBid.bid?.bidId?.oseq || 1
  );

  // Send manifest
  await client.sendManifest(deployment.dseq, provider, deployment.manifest);

  // Get status
  console.log('Waiting for deployment to start (15 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  try {
    const status = await client.getLeaseStatus(deployment.dseq, provider) as {
      services?: Record<string, { uris?: string[] }>;
    };
    const services = status.services || {};
    const service = Object.values(services)[0];
    const uris = service?.uris || [];

    if (uris.length > 0) {
      console.log(`\nDeployment ready!`);
      console.log(`Endpoint: ${uris[0]}`);
      return { ...deployment, ...lease, endpoint: uris[0], status: 'active' };
    }
  } catch (err) {
    console.log('Status check failed, deployment may still be starting.');
  }

  return { ...deployment, ...lease, status: 'active' };
}

export async function listDeployments(walletPath: string = WALLET_PATH): Promise<DeploymentRecord[]> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  return client.listDeployments();
}

export async function closeDeployment(dseq: string, walletPath: string = WALLET_PATH): Promise<CloseDeploymentResult> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  return client.closeDeployment(dseq);
}

export async function acceptBid(dseq: string, provider: string, walletPath: string = WALLET_PATH): Promise<LeaseResult> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  // Get deployment from local records
  const deployments = await client.listDeployments();
  const deployment = deployments.find(d => d.dseq === dseq);

  if (!deployment) {
    throw new Error(`Deployment ${dseq} not found in local records`);
  }

  // Create lease
  const lease = await client.createLease(dseq, provider);

  // Parse SDL and send manifest
  const { SDL } = await import('@akashnetwork/akashjs/build/sdl/SDL/SDL.js');
  const sdl = SDL.fromString(deployment.sdl, 'beta3');
  await client.sendManifest(dseq, provider, sdl.manifest());

  return lease;
}

export async function queryBids(dseq: string, walletPath: string = WALLET_PATH): Promise<unknown[]> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  return client.queryBids(dseq);
}

export async function getDeploymentStatus(dseq: string, walletPath: string = WALLET_PATH): Promise<DeploymentStatusWithBids | DeploymentStatusWithLease> {
  const wallet = await AkashWallet.load(walletPath);
  const client = new AkashClient(wallet);

  // Get deployment from local records
  const deployments = await client.listDeployments();
  const deployment = deployments.find(d => d.dseq === dseq);

  if (!deployment) {
    throw new Error(`Deployment ${dseq} not found`);
  }

  if (!deployment.provider) {
    // No lease yet, check for bids
    const bids = await client.queryBids(dseq) as Array<{
      bid?: {
        bidId?: { provider?: string };
        price?: { amount?: string };
        state?: string;
      };
    }>;
    return {
      ...deployment,
      bids: bids.map(b => ({
        provider: b.bid?.bidId?.provider || '',
        price: b.bid?.price?.amount || '',
        state: b.bid?.state || ''
      }))
    };
  }

  // Has a lease, get status from provider
  try {
    const status = await client.getLeaseStatus(dseq, deployment.provider);
    return { ...deployment, leaseStatus: status };
  } catch (err) {
    return { ...deployment, leaseStatusError: (err as Error).message };
  }
}
