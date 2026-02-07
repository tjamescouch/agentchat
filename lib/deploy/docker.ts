/**
 * AgentChat Docker Deployment Module
 * Generate Docker deployment files for agentchat servers
 */

import yaml from 'js-yaml';
import type { TLSConfig } from './config.js';

/**
 * Docker deployment options
 */
export interface DockerDeployOptions {
  port?: number;
  host?: string;
  name?: string;
  logMessages?: boolean;
  volumes?: boolean;
  tls?: TLSConfig | null;
  network?: string | null;
  healthCheck?: boolean;
}

/**
 * Internal Docker configuration
 */
interface DockerConfig {
  port: number;
  host: string;
  name: string;
  logMessages: boolean;
  volumes: boolean;
  tls: TLSConfig | null;
  network: string | null;
  healthCheck: boolean;
}

/**
 * Docker Compose service definition
 */
interface DockerComposeService {
  image: string;
  build: string;
  container_name: string;
  ports: string[];
  environment: string[];
  restart: string;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period: string;
  };
  volumes?: string[];
  networks?: string[];
}

/**
 * Docker Compose file structure
 */
interface DockerCompose {
  version: string;
  services: {
    agentchat: DockerComposeService;
  };
  volumes?: Record<string, object>;
  networks?: Record<string, { driver: string }>;
}

/**
 * Dockerfile generation options
 */
export interface DockerfileOptions {
  tls?: boolean;
}

/**
 * Generate docker-compose.yml for self-hosting
 * @param options - Configuration options
 * @returns docker-compose.yml content
 */
export async function deployToDocker(options: DockerDeployOptions = {}): Promise<string> {
  const config: DockerConfig = {
    port: options.port || 6667,
    host: options.host || '0.0.0.0',
    name: options.name || 'agentchat',
    logMessages: options.logMessages || false,
    volumes: options.volumes || false,
    tls: options.tls || null,
    network: options.network || null,
    healthCheck: options.healthCheck !== false
  };

  // Build compose object
  const compose: DockerCompose = {
    version: '3.8',
    services: {
      agentchat: {
        image: 'agentchat:latest',
        build: '.',
        container_name: config.name,
        ports: [`${config.port}:6667`],
        environment: [
          `PORT=6667`,
          `HOST=${config.host}`,
          `SERVER_NAME=${config.name}`,
          `LOG_MESSAGES=${config.logMessages}`
        ],
        restart: 'unless-stopped'
      }
    }
  };

  const service = compose.services.agentchat;

  // Add health check
  if (config.healthCheck) {
    service.healthcheck = {
      test: ['CMD', 'node', '-e',
        "const ws = new (require('ws'))('ws://localhost:6667'); ws.on('open', () => process.exit(0)); ws.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 5000);"
      ],
      interval: '30s',
      timeout: '10s',
      retries: 3,
      start_period: '10s'
    };
  }

  // Add volumes if enabled
  if (config.volumes) {
    service.volumes = service.volumes || [];
    service.volumes.push('agentchat-data:/app/data');
    compose.volumes = { 'agentchat-data': {} };
  }

  // Add TLS certificate mounts
  if (config.tls) {
    service.volumes = service.volumes || [];
    service.volumes.push(`${config.tls.cert}:/app/certs/cert.pem:ro`);
    service.volumes.push(`${config.tls.key}:/app/certs/key.pem:ro`);
    service.environment.push('TLS_CERT=/app/certs/cert.pem');
    service.environment.push('TLS_KEY=/app/certs/key.pem');
  }

  // Add network configuration
  if (config.network) {
    service.networks = [config.network];
    compose.networks = {
      [config.network]: {
        driver: 'bridge'
      }
    };
  }

  return yaml.dump(compose, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"'
  });
}

/**
 * Generate Dockerfile for agentchat server
 * @param options - Configuration options
 * @returns Dockerfile content
 */
export async function generateDockerfile(options: DockerfileOptions = {}): Promise<string> {
  const tls = options.tls || false;

  return `FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY . .

# Create data directory for persistence
RUN mkdir -p /app/data

# Default environment variables
ENV PORT=6667
ENV HOST=0.0.0.0
ENV SERVER_NAME=agentchat
ENV LOG_MESSAGES=false
${tls ? `ENV TLS_CERT=""
ENV TLS_KEY=""
` : ''}
EXPOSE 6667

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \\
  CMD node -e "const ws = new (require('ws'))('ws://localhost:' + (process.env.PORT || 6667)); ws.on('open', () => process.exit(0)); ws.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 5000);"

# Start server
CMD ["node", "dist/bin/agentchat.js", "serve"]
`;
}
