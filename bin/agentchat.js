#!/usr/bin/env node

/**
 * AgentChat CLI
 * Command-line interface for agent-to-agent communication
 */

import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { AgentChatClient, quickSend, listen } from '../lib/client.js';
import { startServer } from '../lib/server.js';
import { Identity, DEFAULT_IDENTITY_PATH } from '../lib/identity.js';
import { deployToDocker, generateDockerfile } from '../lib/deploy/index.js';
import { loadConfig, DEFAULT_CONFIG, generateExampleConfig } from '../lib/deploy/config.js';

program
  .name('agentchat')
  .description('Real-time communication protocol for AI agents')
  .version('0.1.0');

// Server command
program
  .command('serve')
  .description('Start an agentchat relay server')
  .option('-p, --port <port>', 'Port to listen on', '6667')
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('-n, --name <name>', 'Server name', 'agentchat')
  .option('--log-messages', 'Log all messages (for debugging)')
  .option('--cert <file>', 'TLS certificate file (PEM format)')
  .option('--key <file>', 'TLS private key file (PEM format)')
  .action((options) => {
    // Validate TLS options (both or neither)
    if ((options.cert && !options.key) || (!options.cert && options.key)) {
      console.error('Error: Both --cert and --key must be provided for TLS');
      process.exit(1);
    }

    startServer({
      port: parseInt(options.port),
      host: options.host,
      name: options.name,
      logMessages: options.logMessages,
      cert: options.cert,
      key: options.key
    });
  });

// Send command (fire-and-forget)
program
  .command('send <server> <target> <message>')
  .description('Send a message and disconnect (fire-and-forget)')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .action(async (server, target, message, options) => {
    try {
      await quickSend(server, options.name, target, message, options.identity);
      console.log('Message sent');
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Listen command (stream messages to stdout)
program
  .command('listen <server> [channels...]')
  .description('Connect and stream messages as JSON lines')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .option('-m, --max-messages <n>', 'Disconnect after receiving n messages (recommended for agents)')
  .action(async (server, channels, options) => {
    try {
      // Default to #general if no channels specified
      if (!channels || channels.length === 0) {
        channels = ['#general'];
      }

      let messageCount = 0;
      const maxMessages = options.maxMessages ? parseInt(options.maxMessages) : null;

      const client = await listen(server, options.name, channels, (msg) => {
        console.log(JSON.stringify(msg));
        messageCount++;

        if (maxMessages && messageCount >= maxMessages) {
          console.error(`Received ${maxMessages} messages, disconnecting`);
          client.disconnect();
          process.exit(0);
        }
      }, options.identity);

      console.error(`Connected as ${client.agentId}`);
      console.error(`Joined: ${channels.join(', ')}`);
      if (maxMessages) {
        console.error(`Will disconnect after ${maxMessages} messages`);
      } else {
        console.error('Streaming messages to stdout (Ctrl+C to stop)');
      }

      process.on('SIGINT', () => {
        client.disconnect();
        process.exit(0);
      });

    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Channels command (list available channels)
program
  .command('channels <server>')
  .description('List available channels on a server')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .action(async (server, options) => {
    try {
      const client = new AgentChatClient({ server, name: options.name, identity: options.identity });
      await client.connect();
      
      const channels = await client.listChannels();
      
      console.log('Available channels:');
      for (const ch of channels) {
        console.log(`  ${ch.name} (${ch.agents} agents)`);
      }
      
      client.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Agents command (list agents in a channel)
program
  .command('agents <server> <channel>')
  .description('List agents in a channel')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .action(async (server, channel, options) => {
    try {
      const client = new AgentChatClient({ server, name: options.name, identity: options.identity });
      await client.connect();
      
      const agents = await client.listAgents(channel);
      
      console.log(`Agents in ${channel}:`);
      for (const agent of agents) {
        console.log(`  ${agent}`);
      }
      
      client.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Interactive connect command
program
  .command('connect <server>')
  .description('Interactive connection (for debugging)')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .option('-j, --join <channels...>', 'Channels to join automatically')
  .action(async (server, options) => {
    try {
      const client = new AgentChatClient({ server, name: options.name, identity: options.identity });
      await client.connect();
      
      console.log(`Connected as ${client.agentId}`);
      
      // Auto-join channels
      if (options.join) {
        for (const ch of options.join) {
          await client.join(ch);
          console.log(`Joined ${ch}`);
        }
      }
      
      // Listen for messages
      client.on('message', (msg) => {
        console.log(`[${msg.to}] ${msg.from}: ${msg.content}`);
      });
      
      client.on('agent_joined', (msg) => {
        console.log(`* ${msg.agent} joined ${msg.channel}`);
      });
      
      client.on('agent_left', (msg) => {
        console.log(`* ${msg.agent} left ${msg.channel}`);
      });
      
      // Read from stdin
      console.log('Type messages as: #channel message or @agent message');
      console.log('Commands: /join #channel, /leave #channel, /channels, /quit');
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.on('line', async (line) => {
        line = line.trim();
        if (!line) return;
        
        // Commands
        if (line.startsWith('/')) {
          const [cmd, ...args] = line.slice(1).split(' ');
          
          switch (cmd) {
            case 'join':
              if (args[0]) {
                await client.join(args[0]);
                console.log(`Joined ${args[0]}`);
              }
              break;
            case 'leave':
              if (args[0]) {
                await client.leave(args[0]);
                console.log(`Left ${args[0]}`);
              }
              break;
            case 'channels':
              const channels = await client.listChannels();
              for (const ch of channels) {
                console.log(`  ${ch.name} (${ch.agents})`);
              }
              break;
            case 'quit':
            case 'exit':
              client.disconnect();
              process.exit(0);
              break;
            default:
              console.log('Unknown command');
          }
          return;
        }
        
        // Messages: #channel msg or @agent msg
        const match = line.match(/^([@#][^\s]+)\s+(.+)$/);
        if (match) {
          await client.send(match[1], match[2]);
        } else {
          console.log('Format: #channel message or @agent message');
        }
      });
      
      rl.on('close', () => {
        client.disconnect();
        process.exit(0);
      });
      
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Create channel command
program
  .command('create <server> <channel>')
  .description('Create a new channel')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .option('-p, --private', 'Make channel invite-only')
  .action(async (server, channel, options) => {
    try {
      const client = new AgentChatClient({ server, name: options.name, identity: options.identity });
      await client.connect();
      
      await client.createChannel(channel, options.private);
      console.log(`Created ${channel}${options.private ? ' (invite-only)' : ''}`);
      
      client.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Invite command
program
  .command('invite <server> <channel> <agent>')
  .description('Invite an agent to a private channel')
  .option('-n, --name <name>', 'Agent name', `agent-${process.pid}`)
  .option('-i, --identity <file>', 'Path to identity file')
  .action(async (server, channel, agent, options) => {
    try {
      const client = new AgentChatClient({ server, name: options.name, identity: options.identity });
      await client.connect();
      await client.join(channel);
      
      await client.invite(channel, agent);
      console.log(`Invited ${agent} to ${channel}`);
      
      client.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Identity management command
program
  .command('identity')
  .description('Manage agent identity (Ed25519 keypair)')
  .option('-g, --generate', 'Generate new keypair')
  .option('-s, --show', 'Show current identity')
  .option('-e, --export', 'Export public key for sharing (JSON to stdout)')
  .option('-f, --file <path>', 'Identity file path', DEFAULT_IDENTITY_PATH)
  .option('-n, --name <name>', 'Agent name (for --generate)', `agent-${process.pid}`)
  .option('--force', 'Overwrite existing identity')
  .action(async (options) => {
    try {
      if (options.generate) {
        // Check if identity already exists
        const exists = await Identity.exists(options.file);
        if (exists && !options.force) {
          console.error(`Identity already exists at ${options.file}`);
          console.error('Use --force to overwrite');
          process.exit(1);
        }

        // Generate new identity
        const identity = Identity.generate(options.name);
        await identity.save(options.file);

        console.log('Generated new identity:');
        console.log(`  Name: ${identity.name}`);
        console.log(`  Fingerprint: ${identity.getFingerprint()}`);
        console.log(`  Agent ID: ${identity.getAgentId()}`);
        console.log(`  Saved to: ${options.file}`);

      } else if (options.show) {
        // Load and display identity
        const identity = await Identity.load(options.file);

        console.log('Current identity:');
        console.log(`  Name: ${identity.name}`);
        console.log(`  Fingerprint: ${identity.getFingerprint()}`);
        console.log(`  Agent ID: ${identity.getAgentId()}`);
        console.log(`  Created: ${identity.created}`);
        console.log(`  File: ${options.file}`);

      } else if (options.export) {
        // Export public key info
        const identity = await Identity.load(options.file);
        console.log(JSON.stringify(identity.export(), null, 2));

      } else {
        // Default: show if exists, otherwise show help
        const exists = await Identity.exists(options.file);
        if (exists) {
          const identity = await Identity.load(options.file);
          console.log('Current identity:');
          console.log(`  Name: ${identity.name}`);
          console.log(`  Fingerprint: ${identity.getFingerprint()}`);
          console.log(`  Agent ID: ${identity.getAgentId()}`);
          console.log(`  Created: ${identity.created}`);
        } else {
          console.log('No identity found.');
          console.log(`Use --generate to create one at ${options.file}`);
        }
      }

      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Deploy command
program
  .command('deploy')
  .description('Generate deployment files for agentchat server')
  .option('--provider <provider>', 'Deployment target (docker)', 'docker')
  .option('--config <file>', 'Deploy configuration file (deploy.yaml)')
  .option('--output <dir>', 'Output directory for generated files', '.')
  .option('-p, --port <port>', 'Server port')
  .option('-n, --name <name>', 'Server/container name')
  .option('--volumes', 'Enable volume mounts for data persistence')
  .option('--no-health-check', 'Disable health check configuration')
  .option('--cert <file>', 'TLS certificate file path')
  .option('--key <file>', 'TLS private key file path')
  .option('--network <name>', 'Docker network name')
  .option('--dockerfile', 'Also generate Dockerfile')
  .option('--init-config', 'Generate example deploy.yaml config file')
  .action(async (options) => {
    try {
      // Generate example config
      if (options.initConfig) {
        const configPath = path.resolve(options.output, 'deploy.yaml');
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, generateExampleConfig());
        console.log(`Generated: ${configPath}`);
        process.exit(0);
      }

      let config = { ...DEFAULT_CONFIG };

      // Load config file if provided
      if (options.config) {
        const fileConfig = await loadConfig(options.config);
        config = { ...config, ...fileConfig };
      }

      // Override with CLI options
      if (options.port) config.port = parseInt(options.port);
      if (options.name) config.name = options.name;
      if (options.volumes) config.volumes = true;
      if (options.healthCheck === false) config.healthCheck = false;
      if (options.network) config.network = options.network;
      if (options.cert && options.key) {
        config.tls = { cert: options.cert, key: options.key };
      }

      // Validate TLS
      if ((options.cert && !options.key) || (!options.cert && options.key)) {
        console.error('Error: Both --cert and --key must be provided for TLS');
        process.exit(1);
      }

      // Ensure output directory exists
      const outputDir = path.resolve(options.output);
      await fs.mkdir(outputDir, { recursive: true });

      // Generate based on provider
      if (options.provider === 'docker' || config.provider === 'docker') {
        // Generate docker-compose.yml
        const compose = await deployToDocker(config);
        const composePath = path.join(outputDir, 'docker-compose.yml');
        await fs.writeFile(composePath, compose);
        console.log(`Generated: ${composePath}`);

        // Optionally generate Dockerfile
        if (options.dockerfile) {
          const dockerfile = await generateDockerfile(config);
          const dockerfilePath = path.join(outputDir, 'Dockerfile.generated');
          await fs.writeFile(dockerfilePath, dockerfile);
          console.log(`Generated: ${dockerfilePath}`);
        }

        console.log('\nTo deploy:');
        console.log(`  cd ${outputDir}`);
        console.log('  docker-compose up -d');

      } else if (options.provider === 'akash' || config.provider === 'akash') {
        console.error('Akash deployment not yet implemented. Coming soon.');
        process.exit(1);
      } else {
        console.error(`Unknown provider: ${options.provider}`);
        process.exit(1);
      }

      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
