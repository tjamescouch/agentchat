/**
 * AgentChat Deploy Configuration
 * Parser for deploy.yaml configuration files
 */

import fs from 'fs/promises';
import yaml from 'js-yaml';

/**
 * TLS configuration
 */
export interface TLSConfig {
  cert: string;
  key: string;
}

/**
 * Deploy configuration object
 */
export interface DeployConfig {
  provider: 'docker' | 'akash';
  port: number;
  host: string;
  name: string;
  logMessages: boolean;
  volumes: boolean;
  healthCheck: boolean;
  tls: TLSConfig | null;
  network: string | null;
}

/**
 * Raw configuration from YAML (before validation)
 */
export interface RawDeployConfig {
  provider?: string;
  port?: number | string;
  host?: string;
  name?: string;
  logMessages?: boolean;
  volumes?: boolean;
  healthCheck?: boolean;
  tls?: TLSConfig | null;
  network?: string | null;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: DeployConfig = {
  provider: 'docker',
  port: 6667,
  host: '0.0.0.0',
  name: 'agentchat',
  logMessages: false,
  volumes: false,
  healthCheck: true,
  tls: null,
  network: null
};

/**
 * Load and parse deploy.yaml configuration
 * @param configPath - Path to configuration file
 * @returns Validated configuration object
 */
export async function loadConfig(configPath: string): Promise<DeployConfig> {
  const content = await fs.readFile(configPath, 'utf-8');
  const parsed = yaml.load(content) as RawDeployConfig;
  return validateConfig(parsed);
}

/**
 * Validate configuration object
 * @param config - Raw configuration object
 * @returns Validated and merged configuration
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: unknown): DeployConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration must be an object');
  }

  const rawConfig = config as RawDeployConfig;
  const result: DeployConfig = { ...DEFAULT_CONFIG, ...rawConfig } as DeployConfig;

  // Validate provider
  if (!['docker', 'akash'].includes(result.provider)) {
    throw new Error(`Invalid provider: ${result.provider}. Must be 'docker' or 'akash'`);
  }

  // Validate port
  const port = parseInt(String(result.port));
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${result.port}. Must be between 1 and 65535`);
  }
  result.port = port;

  // Validate host
  if (typeof result.host !== 'string' || result.host.length === 0) {
    throw new Error('Invalid host: must be a non-empty string');
  }

  // Validate name
  if (typeof result.name !== 'string' || result.name.length === 0) {
    throw new Error('Invalid name: must be a non-empty string');
  }
  // Docker container name must be alphanumeric with dashes/underscores
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result.name)) {
    throw new Error('Invalid name: must start with alphanumeric and contain only alphanumeric, dash, underscore');
  }

  // Validate TLS config
  if (result.tls) {
    if (typeof result.tls !== 'object') {
      throw new Error('TLS config must be an object with cert and key paths');
    }
    if (!result.tls.cert || typeof result.tls.cert !== 'string') {
      throw new Error('TLS config must include cert path');
    }
    if (!result.tls.key || typeof result.tls.key !== 'string') {
      throw new Error('TLS config must include key path');
    }
  }

  // Validate network
  if (result.network !== null && typeof result.network !== 'string') {
    throw new Error('Network must be a string or null');
  }

  // Ensure booleans
  result.logMessages = Boolean(result.logMessages);
  result.volumes = Boolean(result.volumes);
  result.healthCheck = result.healthCheck !== false;

  return result;
}

/**
 * Generate example deploy.yaml content
 * @returns Example YAML configuration
 */
export function generateExampleConfig(): string {
  return `# AgentChat deployment configuration
provider: docker
port: 6667
host: 0.0.0.0
name: agentchat

# Enable data persistence volumes
volumes: false

# Health check (default: true)
healthCheck: true

# Logging (default: false)
logMessages: false

# TLS configuration (optional)
# tls:
#   cert: ./certs/cert.pem
#   key: ./certs/key.pem

# Docker network (optional)
# network: agentchat-net
`;
}
