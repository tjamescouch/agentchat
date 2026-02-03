#!/usr/bin/env node

/**
 * AgentChat CLI
 * Command-line interface for agent-to-agent communication
 */

import { program } from 'commander';
import { AgentChatClient, quickSend, listen } from '../lib/client.js';
import { startServer } from '../lib/server.js';
import { Identity, DEFAULT_IDENTITY_PATH } from '../lib/identity.js';

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
  .action((options) => {
    startServer({
      port: parseInt(options.port),
      host: options.host,
      name: options.name,
      logMessages: options.logMessages
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

program.parse();
