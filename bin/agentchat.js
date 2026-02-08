#!/usr/bin/env node
"use strict";
/**
 * AgentChat CLI
 * Command-line interface for agent-to-agent communication
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var commander_1 = require("commander");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var client_js_1 = require("../lib/client.js");
var server_js_1 = require("../lib/server.js");
var identity_js_1 = require("../lib/identity.js");
var daemon_js_1 = require("../lib/daemon.js");
var index_js_1 = require("../lib/deploy/index.js");
var config_js_1 = require("../lib/deploy/config.js");
var receipts_js_1 = require("../lib/receipts.js");
var reputation_js_1 = require("../lib/reputation.js");
var server_directory_js_1 = require("../lib/server-directory.js");
var security_js_1 = require("../lib/security.js");
commander_1.program
    .name('agentchat')
    .description('Real-time communication protocol for AI agents')
    .version('0.1.0');
// Server command
commander_1.program
    .command('serve')
    .description('Start an agentchat relay server')
    .option('-p, --port <port>', 'Port to listen on', '6667')
    .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
    .option('-n, --name <name>', 'Server name', 'agentchat')
    .option('--log-messages', 'Log all messages (for debugging)')
    .option('--cert <file>', 'TLS certificate file (PEM format)')
    .option('--key <file>', 'TLS private key file (PEM format)')
    .option('--buffer-size <n>', 'Message buffer size per channel for replay on join', '20')
    .action(function (options) {
    // Validate TLS options (both or neither)
    if ((options.cert && !options.key) || (!options.cert && options.key)) {
        console.error('Error: Both --cert and --key must be provided for TLS');
        process.exit(1);
    }
    (0, server_js_1.startServer)({
        port: parseInt(options.port),
        host: options.host,
        name: options.name,
        logMessages: options.logMessages,
        cert: options.cert,
        key: options.key,
        messageBufferSize: parseInt(options.bufferSize)
    });
});
// Send command (fire-and-forget)
commander_1.program
    .command('send <server> <target> <message>')
    .description('Send a message and disconnect (fire-and-forget)')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .action(function (server, target, message, options) { return __awaiter(void 0, void 0, void 0, function () {
    var err_1, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, (0, client_js_1.quickSend)(server, options.name, target, message, options.identity)];
            case 1:
                _a.sent();
                console.log('Message sent');
                process.exit(0);
                return [3 /*break*/, 3];
            case 2:
                err_1 = _a.sent();
                error = err_1;
                if (error.code === 'ECONNREFUSED') {
                    console.error('Error: Connection refused. Is the server running?');
                }
                else {
                    console.error('Error:', error.message || error.code || err_1);
                }
                process.exit(1);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
// Listen command (stream messages to stdout)
commander_1.program
    .command('listen <server> [channels...]')
    .description('Connect and stream messages as JSON lines')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .option('-m, --max-messages <n>', 'Disconnect after receiving n messages (recommended for agents)')
    .action(function (server, channels, options) { return __awaiter(void 0, void 0, void 0, function () {
    var messageCount_1, maxMessages_1, client_1, err_2, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                // Default to #general if no channels specified
                if (!channels || channels.length === 0) {
                    channels = ['#general'];
                }
                messageCount_1 = 0;
                maxMessages_1 = options.maxMessages ? parseInt(options.maxMessages) : null;
                return [4 /*yield*/, (0, client_js_1.listen)(server, options.name, channels, function (msg) {
                        console.log(JSON.stringify(msg));
                        messageCount_1++;
                        if (maxMessages_1 && messageCount_1 >= maxMessages_1) {
                            console.error("Received ".concat(maxMessages_1, " messages, disconnecting"));
                            client_1.disconnect();
                            process.exit(0);
                        }
                    }, options.identity)];
            case 1:
                client_1 = _a.sent();
                console.error("Connected as ".concat(client_1.agentId));
                console.error("Joined: ".concat(channels.join(', ')));
                if (maxMessages_1) {
                    console.error("Will disconnect after ".concat(maxMessages_1, " messages"));
                }
                else {
                    console.error('Streaming messages to stdout (Ctrl+C to stop)');
                }
                process.on('SIGINT', function () {
                    client_1.disconnect();
                    process.exit(0);
                });
                return [3 /*break*/, 3];
            case 2:
                err_2 = _a.sent();
                error = err_2;
                if (error.code === 'ECONNREFUSED') {
                    console.error('Error: Connection refused. Is the server running?');
                    console.error("  Try: agentchat serve --port 8080");
                }
                else {
                    console.error('Error:', error.message || error.code || err_2);
                }
                process.exit(1);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
// Channels command (list available channels)
commander_1.program
    .command('channels <server>')
    .description('List available channels on a server')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .action(function (server, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, channels, _i, channels_1, ch, err_3, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, name: options.name, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.listChannels()];
            case 2:
                channels = _a.sent();
                console.log('Available channels:');
                for (_i = 0, channels_1 = channels; _i < channels_1.length; _i++) {
                    ch = channels_1[_i];
                    console.log("  ".concat(ch.name, " (").concat(ch.agents, " agents)"));
                }
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_3 = _a.sent();
                error = err_3;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Agents command (list agents in a channel)
commander_1.program
    .command('agents <server> <channel>')
    .description('List agents in a channel')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .action(function (server, channel, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, agents, _i, agents_1, agent, status_1, err_4, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, name: options.name, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.listAgents(channel)];
            case 2:
                agents = _a.sent();
                console.log("Agents in ".concat(channel, ":"));
                for (_i = 0, agents_1 = agents; _i < agents_1.length; _i++) {
                    agent = agents_1[_i];
                    status_1 = agent.status_text ? " - ".concat(agent.status_text) : '';
                    console.log("  ".concat(agent.id, " (").concat(agent.name, ") [").concat(agent.presence, "]").concat(status_1));
                }
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_4 = _a.sent();
                error = err_4;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Create channel command
commander_1.program
    .command('create <server> <channel>')
    .description('Create a new channel')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .option('-p, --private', 'Make channel invite-only')
    .action(function (server, channel, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, err_5, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, name: options.name, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.createChannel(channel, options.private)];
            case 2:
                _a.sent();
                console.log("Created ".concat(channel).concat(options.private ? ' (invite-only)' : ''));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_5 = _a.sent();
                error = err_5;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Invite command
commander_1.program
    .command('invite <server> <channel> <agent>')
    .description('Invite an agent to a private channel')
    .option('-n, --name <name>', 'Agent name', "agent-".concat(process.pid))
    .option('-i, --identity <file>', 'Path to identity file')
    .action(function (server, channel, agent, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, err_6, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 4, , 5]);
                client = new client_js_1.AgentChatClient({ server: server, name: options.name, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.join(channel)];
            case 2:
                _a.sent();
                return [4 /*yield*/, client.invite(channel, agent)];
            case 3:
                _a.sent();
                console.log("Invited ".concat(agent, " to ").concat(channel));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 5];
            case 4:
                err_6 = _a.sent();
                error = err_6;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); });
// Propose command
commander_1.program
    .command('propose <server> <agent> <task>')
    .description('Send a work proposal to another agent')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-a, --amount <n>', 'Payment amount')
    .option('-c, --currency <code>', 'Currency (SOL, USDC, AKT, etc)')
    .option('-p, --payment-code <code>', 'Your payment code (BIP47, address)')
    .option('-e, --expires <seconds>', 'Expiration time in seconds', '300')
    .option('-t, --terms <terms>', 'Additional terms')
    .option('-s, --elo-stake <n>', 'ELO points to stake on this proposal')
    .action(function (server, agent, task, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, proposal, err_7, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.propose(agent, {
                        task: task,
                        amount: options.amount ? parseFloat(options.amount) : undefined,
                        currency: options.currency,
                        payment_code: options.paymentCode,
                        terms: options.terms,
                        expires: parseInt(options.expires),
                        elo_stake: options.eloStake ? parseInt(options.eloStake) : undefined
                    })];
            case 2:
                proposal = _a.sent();
                console.log('Proposal sent:');
                console.log("  ID: ".concat(proposal.id));
                console.log("  To: ".concat(proposal.to));
                console.log("  Task: ".concat(proposal.task));
                if (proposal.amount)
                    console.log("  Amount: ".concat(proposal.amount, " ").concat(proposal.currency || ''));
                if (proposal.elo_stake)
                    console.log("  ELO Stake: ".concat(proposal.elo_stake));
                if (proposal.expires)
                    console.log("  Expires: ".concat(new Date(proposal.expires).toISOString()));
                console.log("\nUse this ID to track responses.");
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_7 = _a.sent();
                error = err_7;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Accept proposal command
commander_1.program
    .command('accept <server> <proposal_id>')
    .description('Accept a proposal')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-p, --payment-code <code>', 'Your payment code for receiving payment')
    .option('-s, --elo-stake <n>', 'ELO points to stake (as acceptor)')
    .action(function (server, proposalId, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, eloStake, response, err_8, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                eloStake = options.eloStake ? parseInt(options.eloStake) : undefined;
                return [4 /*yield*/, client.accept(proposalId, options.paymentCode, eloStake)];
            case 2:
                response = _a.sent();
                console.log('Proposal accepted:');
                console.log("  Proposal ID: ".concat(response.proposal_id));
                console.log("  Status: ".concat(response.status));
                if (response.proposer_stake)
                    console.log("  Proposer Stake: ".concat(response.proposer_stake, " ELO"));
                if (response.acceptor_stake)
                    console.log("  Your Stake: ".concat(response.acceptor_stake, " ELO"));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_8 = _a.sent();
                error = err_8;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Reject proposal command
commander_1.program
    .command('reject <server> <proposal_id>')
    .description('Reject a proposal')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-r, --reason <reason>', 'Reason for rejection')
    .action(function (server, proposalId, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, response, err_9, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.reject(proposalId, options.reason)];
            case 2:
                response = _a.sent();
                console.log('Proposal rejected:');
                console.log("  Proposal ID: ".concat(response.proposal_id));
                console.log("  Status: ".concat(response.status));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_9 = _a.sent();
                error = err_9;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Complete proposal command
commander_1.program
    .command('complete <server> <proposal_id>')
    .description('Mark a proposal as complete')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-p, --proof <proof>', 'Proof of completion (tx hash, URL, etc)')
    .action(function (server, proposalId, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, response, err_10, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.complete(proposalId, options.proof)];
            case 2:
                response = _a.sent();
                console.log('Proposal completed:');
                console.log("  Proposal ID: ".concat(response.proposal_id));
                console.log("  Status: ".concat(response.status));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_10 = _a.sent();
                error = err_10;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Dispute proposal command
commander_1.program
    .command('dispute <server> <proposal_id> <reason>')
    .description('Dispute a proposal')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .action(function (server, proposalId, reason, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, response, err_11, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, client.dispute(proposalId, reason)];
            case 2:
                response = _a.sent();
                console.log('Proposal disputed:');
                console.log("  Proposal ID: ".concat(response.proposal_id));
                console.log("  Status: ".concat(response.status));
                console.log("  Reason: ".concat(reason));
                client.disconnect();
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_11 = _a.sent();
                error = err_11;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Verify agent identity command
commander_1.program
    .command('verify <server> <agent>')
    .description('Verify another agent\'s identity via challenge-response')
    .option('-i, --identity <file>', 'Path to identity file (required)', identity_js_1.DEFAULT_IDENTITY_PATH)
    .action(function (server, agent, options) { return __awaiter(void 0, void 0, void 0, function () {
    var client, result, err_12, error;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                client = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client.connect()];
            case 1:
                _a.sent();
                console.log("Verifying identity of ".concat(agent, "..."));
                return [4 /*yield*/, client.verify(agent)];
            case 2:
                result = _a.sent();
                if (result.verified) {
                    console.log('Identity verified!');
                    console.log("  Agent: ".concat(result.agent));
                    console.log("  Public Key:");
                    console.log(result.pubkey.split('\n').map(function (line) { return "    ".concat(line); }).join('\n'));
                }
                else {
                    console.log('Verification failed!');
                    console.log("  Target: ".concat(result.target));
                    console.log("  Reason: ".concat(result.reason));
                }
                client.disconnect();
                process.exit(result.verified ? 0 : 1);
                return [3 /*break*/, 4];
            case 3:
                err_12 = _a.sent();
                error = err_12;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Identity management command
commander_1.program
    .command('identity')
    .description('Manage agent identity (Ed25519 keypair)')
    .option('-g, --generate', 'Generate new keypair')
    .option('-s, --show', 'Show current identity')
    .option('-e, --export', 'Export public key for sharing (JSON to stdout)')
    .option('-r, --rotate', 'Rotate to new keypair (signs new key with old key)')
    .option('--verify-chain', 'Verify the rotation chain')
    .option('--revoke [reason]', 'Generate signed revocation notice (outputs JSON)')
    .option('--verify-revocation <file>', 'Verify a revocation notice file')
    .option('-f, --file <path>', 'Identity file path', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-n, --name <name>', 'Agent name (for --generate)', "agent-".concat(process.pid))
    .option('--force', 'Overwrite existing identity')
    .action(function (options) { return __awaiter(void 0, void 0, void 0, function () {
    var exists, identity, identity, identity, identity, oldAgentId, oldFingerprint, record, identity, result, _i, _a, error, identity, reason, notice, noticeData, notice, isValid, exists, identity, err_13, error;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 21, , 22]);
                if (!options.generate) return [3 /*break*/, 3];
                return [4 /*yield*/, identity_js_1.Identity.exists(options.file)];
            case 1:
                exists = _b.sent();
                if (exists && !options.force) {
                    console.error("Identity already exists at ".concat(options.file));
                    console.error('Use --force to overwrite');
                    process.exit(1);
                }
                identity = identity_js_1.Identity.generate(options.name);
                return [4 /*yield*/, identity.save(options.file)];
            case 2:
                _b.sent();
                console.log('Generated new identity:');
                console.log("  Name: ".concat(identity.name));
                console.log("  Fingerprint: ".concat(identity.getFingerprint()));
                console.log("  Agent ID: ".concat(identity.getAgentId()));
                console.log("  Saved to: ".concat(options.file));
                return [3 /*break*/, 20];
            case 3:
                if (!options.show) return [3 /*break*/, 5];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 4:
                identity = _b.sent();
                console.log('Current identity:');
                console.log("  Name: ".concat(identity.name));
                console.log("  Fingerprint: ".concat(identity.getFingerprint()));
                console.log("  Agent ID: ".concat(identity.getAgentId()));
                console.log("  Created: ".concat(identity.created));
                console.log("  File: ".concat(options.file));
                return [3 /*break*/, 20];
            case 5:
                if (!options.export) return [3 /*break*/, 7];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 6:
                identity = _b.sent();
                console.log(JSON.stringify(identity.export(), null, 2));
                return [3 /*break*/, 20];
            case 7:
                if (!options.rotate) return [3 /*break*/, 10];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 8:
                identity = _b.sent();
                oldAgentId = identity.getAgentId();
                oldFingerprint = identity.getFingerprint();
                console.log('Rotating identity...');
                console.log("  Old Agent ID: ".concat(oldAgentId));
                console.log("  Old Fingerprint: ".concat(oldFingerprint));
                record = identity.rotate();
                return [4 /*yield*/, identity.save(options.file)];
            case 9:
                _b.sent();
                console.log('');
                console.log('Rotation complete:');
                console.log("  New Agent ID: ".concat(identity.getAgentId()));
                console.log("  New Fingerprint: ".concat(identity.getFingerprint()));
                console.log("  Total rotations: ".concat(identity.rotations.length));
                console.log('');
                console.log('The new key has been signed by the old key for chain of custody.');
                console.log('Share the rotation record to prove key continuity.');
                return [3 /*break*/, 20];
            case 10:
                if (!options.verifyChain) return [3 /*break*/, 12];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 11:
                identity = _b.sent();
                if (identity.rotations.length === 0) {
                    console.log('No rotations to verify (original identity).');
                    console.log("  Agent ID: ".concat(identity.getAgentId()));
                    process.exit(0);
                }
                console.log("Verifying rotation chain (".concat(identity.rotations.length, " rotation(s))..."));
                result = identity.verifyRotationChain();
                if (result.valid) {
                    console.log('Chain verified successfully!');
                    console.log("  Original Agent ID: ".concat(identity.getOriginalAgentId()));
                    console.log("  Current Agent ID: ".concat(identity.getAgentId()));
                    console.log("  Rotations: ".concat(identity.rotations.length));
                }
                else {
                    console.error('Chain verification FAILED:');
                    for (_i = 0, _a = result.errors; _i < _a.length; _i++) {
                        error = _a[_i];
                        console.error("  - ".concat(error));
                    }
                    process.exit(1);
                }
                return [3 /*break*/, 20];
            case 12:
                if (!options.revoke) return [3 /*break*/, 14];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 13:
                identity = _b.sent();
                reason = typeof options.revoke === 'string' ? options.revoke : 'revoked';
                console.error("Generating revocation notice for identity...");
                console.error("  Agent ID: ".concat(identity.getAgentId()));
                console.error("  Reason: ".concat(reason));
                console.error('');
                console.error('WARNING: Publishing this notice declares your key as untrusted.');
                console.error('');
                notice = identity.revoke(reason);
                console.log(JSON.stringify(notice, null, 2));
                return [3 /*break*/, 20];
            case 14:
                if (!options.verifyRevocation) return [3 /*break*/, 16];
                return [4 /*yield*/, promises_1.default.readFile(options.verifyRevocation, 'utf-8')];
            case 15:
                noticeData = _b.sent();
                notice = JSON.parse(noticeData);
                console.log('Verifying revocation notice...');
                isValid = identity_js_1.Identity.verifyRevocation(notice);
                if (isValid) {
                    console.log('Revocation notice is VALID');
                    console.log("  Agent ID: ".concat(notice.agent_id));
                    console.log("  Fingerprint: ".concat(notice.fingerprint));
                    console.log("  Reason: ".concat(notice.reason));
                    console.log("  Timestamp: ".concat(notice.timestamp));
                    if (notice.original_agent_id) {
                        console.log("  Original Agent ID: ".concat(notice.original_agent_id));
                    }
                }
                else {
                    console.error('Revocation notice is INVALID');
                    process.exit(1);
                }
                return [3 /*break*/, 20];
            case 16: return [4 /*yield*/, identity_js_1.Identity.exists(options.file)];
            case 17:
                exists = _b.sent();
                if (!exists) return [3 /*break*/, 19];
                return [4 /*yield*/, identity_js_1.Identity.load(options.file)];
            case 18:
                identity = _b.sent();
                console.log('Current identity:');
                console.log("  Name: ".concat(identity.name));
                console.log("  Fingerprint: ".concat(identity.getFingerprint()));
                console.log("  Agent ID: ".concat(identity.getAgentId()));
                console.log("  Created: ".concat(identity.created));
                if (identity.rotations.length > 0) {
                    console.log("  Rotations: ".concat(identity.rotations.length));
                    console.log("  Original Agent ID: ".concat(identity.getOriginalAgentId()));
                }
                return [3 /*break*/, 20];
            case 19:
                console.log('No identity found.');
                console.log("Use --generate to create one at ".concat(options.file));
                _b.label = 20;
            case 20:
                process.exit(0);
                return [3 /*break*/, 22];
            case 21:
                err_13 = _b.sent();
                error = err_13;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 22];
            case 22: return [2 /*return*/];
        }
    });
}); });
// Daemon command
commander_1.program
    .command('daemon [server]')
    .description('Run persistent listener daemon with file-based inbox/outbox')
    .option('-n, --name <name>', 'Daemon instance name (allows multiple daemons)', daemon_js_1.DEFAULT_INSTANCE)
    .option('-i, --identity <file>', 'Path to identity file', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('-c, --channels <channels...>', 'Channels to join', daemon_js_1.DEFAULT_CHANNELS)
    .option('-b, --background', 'Run in background (daemonize)')
    .option('-s, --status', 'Show daemon status')
    .option('-l, --list', 'List all daemon instances')
    .option('--stop', 'Stop the daemon')
    .option('--stop-all', 'Stop all running daemons')
    .option('--max-reconnect-time <minutes>', 'Max time to attempt reconnection (default: 10 minutes)', '10')
    .action(function (server, options) { return __awaiter(void 0, void 0, void 0, function () {
    var instanceName, paths, needsSafetyCheck, instances, _i, instances_1, inst, status_2, results, _a, results_1, r, status_3, result, status_4, spawn, args, child, normalizedChannels, daemon, err_14, error;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 13, , 14]);
                instanceName = options.name;
                paths = (0, daemon_js_1.getDaemonPaths)(instanceName);
                needsSafetyCheck = !options.list && !options.status && !options.stop && !options.stopAll;
                if (needsSafetyCheck) {
                    (0, security_js_1.enforceDirectorySafety)(process.cwd(), { allowWarnings: true, silent: false });
                }
                if (!options.list) return [3 /*break*/, 2];
                return [4 /*yield*/, (0, daemon_js_1.listDaemons)()];
            case 1:
                instances = _b.sent();
                if (instances.length === 0) {
                    console.log('No daemon instances found');
                }
                else {
                    console.log('Daemon instances:');
                    for (_i = 0, instances_1 = instances; _i < instances_1.length; _i++) {
                        inst = instances_1[_i];
                        status_2 = inst.running ? "running (PID: ".concat(inst.pid, ")") : 'stopped';
                        console.log("  ".concat(inst.name, ": ").concat(status_2));
                    }
                }
                process.exit(0);
                _b.label = 2;
            case 2:
                if (!options.stopAll) return [3 /*break*/, 4];
                return [4 /*yield*/, (0, daemon_js_1.stopAllDaemons)()];
            case 3:
                results = _b.sent();
                if (results.length === 0) {
                    console.log('No running daemons to stop');
                }
                else {
                    for (_a = 0, results_1 = results; _a < results_1.length; _a++) {
                        r = results_1[_a];
                        console.log("Stopped ".concat(r.instance, " (PID: ").concat(r.pid, ")"));
                    }
                }
                process.exit(0);
                _b.label = 4;
            case 4:
                if (!options.status) return [3 /*break*/, 6];
                return [4 /*yield*/, (0, daemon_js_1.getDaemonStatus)(instanceName)];
            case 5:
                status_3 = _b.sent();
                if (!status_3.running) {
                    console.log("Daemon '".concat(instanceName, "' is not running"));
                }
                else {
                    console.log("Daemon '".concat(instanceName, "' is running:"));
                    console.log("  PID: ".concat(status_3.pid));
                    console.log("  Inbox: ".concat(status_3.inboxPath, " (").concat(status_3.inboxLines, " messages)"));
                    console.log("  Outbox: ".concat(status_3.outboxPath));
                    console.log("  Log: ".concat(status_3.logPath));
                    if (status_3.lastMessage) {
                        console.log("  Last message: ".concat(JSON.stringify(status_3.lastMessage).substring(0, 80), "..."));
                    }
                }
                process.exit(0);
                _b.label = 6;
            case 6:
                if (!options.stop) return [3 /*break*/, 8];
                return [4 /*yield*/, (0, daemon_js_1.stopDaemon)(instanceName)];
            case 7:
                result = _b.sent();
                if (result.stopped) {
                    console.log("Daemon '".concat(instanceName, "' stopped (PID: ").concat(result.pid, ")"));
                }
                else {
                    console.log(result.reason);
                }
                process.exit(0);
                _b.label = 8;
            case 8:
                // Start daemon requires server
                if (!server) {
                    console.error('Error: server URL required to start daemon');
                    console.error('Usage: agentchat daemon ws://localhost:6667 --name myagent');
                    process.exit(1);
                }
                return [4 /*yield*/, (0, daemon_js_1.isDaemonRunning)(instanceName)];
            case 9:
                status_4 = _b.sent();
                if (status_4.running) {
                    console.error("Daemon '".concat(instanceName, "' already running (PID: ").concat(status_4.pid, ")"));
                    console.error('Use --stop to stop it first, or use a different --name');
                    process.exit(1);
                }
                if (!options.background) return [3 /*break*/, 11];
                return [4 /*yield*/, Promise.resolve().then(function () { return require('child_process'); })];
            case 10:
                spawn = (_b.sent()).spawn;
                args = process.argv.slice(2).filter(function (a) { return a !== '-b' && a !== '--background'; });
                child = spawn(process.execPath, __spreadArray([process.argv[1]], args, true), {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
                console.log("Daemon '".concat(instanceName, "' started in background (PID: ").concat(child.pid, ")"));
                console.log("  Inbox: ".concat(paths.inbox));
                console.log("  Outbox: ".concat(paths.outbox));
                console.log("  Log: ".concat(paths.log));
                console.log('');
                console.log('To send messages, append to outbox:');
                console.log("  echo '{\"to\":\"#general\",\"content\":\"Hello!\"}' >> ".concat(paths.outbox));
                console.log('');
                console.log('To read messages:');
                console.log("  tail -f ".concat(paths.inbox));
                process.exit(0);
                _b.label = 11;
            case 11:
                // Foreground mode
                console.log('Starting daemon in foreground (Ctrl+C to stop)...');
                console.log("  Instance: ".concat(instanceName));
                console.log("  Server: ".concat(server));
                console.log("  Identity: ".concat(options.identity));
                normalizedChannels = options.channels
                    .flatMap(function (c) { return c.split(','); })
                    .map(function (c) { return c.trim(); })
                    .filter(function (c) { return c.length > 0; })
                    .map(function (c) { return c.startsWith('#') ? c : '#' + c; });
                console.log("  Channels: ".concat(normalizedChannels.join(', ')));
                console.log('');
                daemon = new daemon_js_1.AgentChatDaemon({
                    server: server,
                    name: instanceName,
                    identity: options.identity,
                    channels: normalizedChannels,
                    maxReconnectTime: parseInt(options.maxReconnectTime) * 60 * 1000 // Convert minutes to ms
                });
                return [4 /*yield*/, daemon.start()];
            case 12:
                _b.sent();
                // Keep process alive
                process.stdin.resume();
                return [3 /*break*/, 14];
            case 13:
                err_14 = _b.sent();
                error = err_14;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 14];
            case 14: return [2 /*return*/];
        }
    });
}); });
// Receipts command
commander_1.program
    .command('receipts [action]')
    .description('Manage completion receipts for portable reputation')
    .option('-f, --format <format>', 'Export format (json, yaml)', 'json')
    .option('-i, --identity <file>', 'Path to identity file', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('--file <path>', 'Receipts file path', receipts_js_1.DEFAULT_RECEIPTS_PATH)
    .action(function (action, options) { return __awaiter(void 0, void 0, void 0, function () {
    var store, receipts, agentId, identity, _a, _b, _i, receipts_1, r, output, stats, _c, _d, cp, currencies, _e, currencies_1, _f, currency, data, currencyData, err_15, error;
    var _g, _h;
    return __generator(this, function (_j) {
        switch (_j.label) {
            case 0:
                _j.trys.push([0, 13, , 14]);
                store = new receipts_js_1.ReceiptStore(options.file);
                return [4 /*yield*/, store.getAll()];
            case 1:
                receipts = _j.sent();
                agentId = null;
                _j.label = 2;
            case 2:
                _j.trys.push([2, 4, , 5]);
                return [4 /*yield*/, identity_js_1.Identity.load(options.identity)];
            case 3:
                identity = _j.sent();
                agentId = identity.getAgentId();
                return [3 /*break*/, 5];
            case 4:
                _a = _j.sent();
                return [3 /*break*/, 5];
            case 5:
                _b = action;
                switch (_b) {
                    case 'list': return [3 /*break*/, 6];
                    case 'export': return [3 /*break*/, 7];
                    case 'summary': return [3 /*break*/, 9];
                }
                return [3 /*break*/, 11];
            case 6:
                if (receipts.length === 0) {
                    console.log('No receipts found.');
                    console.log("\nReceipts are stored in: ".concat(options.file));
                    console.log('Receipts are automatically saved when COMPLETE messages are received via daemon.');
                }
                else {
                    console.log("Found ".concat(receipts.length, " receipt(s):\n"));
                    for (_i = 0, receipts_1 = receipts; _i < receipts_1.length; _i++) {
                        r = receipts_1[_i];
                        console.log("  Proposal: ".concat(r.proposal_id || 'unknown'));
                        console.log("    Completed: ".concat(r.completed_at ? new Date(r.completed_at).toISOString() : 'unknown'));
                        console.log("    By: ".concat(r.completed_by || 'unknown'));
                        if (r.proof)
                            console.log("    Proof: ".concat(r.proof));
                        if ((_g = r.proposal) === null || _g === void 0 ? void 0 : _g.task)
                            console.log("    Task: ".concat(r.proposal.task));
                        if ((_h = r.proposal) === null || _h === void 0 ? void 0 : _h.amount)
                            console.log("    Amount: ".concat(r.proposal.amount, " ").concat(r.proposal.currency || ''));
                        console.log('');
                    }
                }
                return [3 /*break*/, 12];
            case 7: return [4 /*yield*/, store.export(options.format, agentId)];
            case 8:
                output = _j.sent();
                console.log(output);
                return [3 /*break*/, 12];
            case 9: return [4 /*yield*/, store.getStats(agentId)];
            case 10:
                stats = _j.sent();
                console.log('Receipt Summary:');
                console.log("  Total receipts: ".concat(stats.count));
                if (stats.count > 0) {
                    if (stats.dateRange) {
                        console.log("  Date range: ".concat(stats.dateRange.oldest, " to ").concat(stats.dateRange.newest));
                    }
                    if (stats.counterparties.length > 0) {
                        console.log("  Counterparties (".concat(stats.counterparties.length, "):"));
                        for (_c = 0, _d = stats.counterparties; _c < _d.length; _c++) {
                            cp = _d[_c];
                            console.log("    - ".concat(cp));
                        }
                    }
                    currencies = Object.entries(stats.currencies);
                    if (currencies.length > 0) {
                        console.log('  By currency:');
                        for (_e = 0, currencies_1 = currencies; _e < currencies_1.length; _e++) {
                            _f = currencies_1[_e], currency = _f[0], data = _f[1];
                            currencyData = data;
                            if (currency !== 'unknown') {
                                console.log("    ".concat(currency, ": ").concat(currencyData.count, " receipts, ").concat(currencyData.totalAmount, " total"));
                            }
                            else {
                                console.log("    (no currency): ".concat(currencyData.count, " receipts"));
                            }
                        }
                    }
                }
                console.log("\nReceipts file: ".concat(options.file));
                if (agentId) {
                    console.log("Filtered for agent: @".concat(agentId));
                }
                return [3 /*break*/, 12];
            case 11:
                // Default: show help
                console.log('Receipt Management Commands:');
                console.log('');
                console.log('  agentchat receipts list      List all stored receipts');
                console.log('  agentchat receipts export    Export receipts (--format json|yaml)');
                console.log('  agentchat receipts summary   Show receipt statistics');
                console.log('');
                console.log('Options:');
                console.log('  --format <format>   Export format: json (default) or yaml');
                console.log('  --identity <file>   Identity file for filtering by agent');
                console.log('  --file <path>       Custom receipts file path');
                console.log('');
                console.log("Receipts are stored in: ".concat(receipts_js_1.DEFAULT_RECEIPTS_PATH));
                console.log('');
                console.log('Receipts are automatically saved by the daemon when');
                console.log('COMPLETE messages are received for proposals you are party to.');
                _j.label = 12;
            case 12:
                process.exit(0);
                return [3 /*break*/, 14];
            case 13:
                err_15 = _j.sent();
                error = err_15;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 14];
            case 14: return [2 /*return*/];
        }
    });
}); });
// Ratings command
commander_1.program
    .command('ratings [agent]')
    .description('View and manage ELO-based reputation ratings')
    .option('-i, --identity <file>', 'Path to identity file', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('--file <path>', 'Ratings file path', reputation_js_1.DEFAULT_RATINGS_PATH)
    .option('-e, --export', 'Export all ratings as JSON')
    .option('-r, --recalculate', 'Recalculate ratings from receipt history')
    .option('-l, --leaderboard [n]', 'Show top N agents by rating')
    .option('-s, --stats', 'Show rating system statistics')
    .action(function (agent, options) { return __awaiter(void 0, void 0, void 0, function () {
    var store, ratings, receipts, ratings, count, stats, limit, leaderboard, stats, rating, kFactor, agentId, identity, _a, rating, kFactor, err_16, error;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 22, , 23]);
                store = new reputation_js_1.ReputationStore(options.file);
                if (!options.export) return [3 /*break*/, 2];
                return [4 /*yield*/, store.exportRatings()];
            case 1:
                ratings = _b.sent();
                console.log(JSON.stringify(ratings, null, 2));
                process.exit(0);
                _b.label = 2;
            case 2:
                if (!options.recalculate) return [3 /*break*/, 6];
                console.log('Recalculating ratings from receipt history...');
                return [4 /*yield*/, (0, receipts_js_1.readReceipts)()];
            case 3:
                receipts = _b.sent();
                return [4 /*yield*/, store.recalculateFromReceipts(receipts)];
            case 4:
                ratings = _b.sent();
                count = Object.keys(ratings).length;
                console.log("Processed ".concat(receipts.length, " receipts, updated ").concat(count, " agents."));
                return [4 /*yield*/, store.getStats()];
            case 5:
                stats = _b.sent();
                console.log("\nRating Statistics:");
                console.log("  Total agents: ".concat(stats.totalAgents));
                console.log("  Average rating: ".concat(stats.averageRating));
                console.log("  Highest: ".concat(stats.highestRating));
                console.log("  Lowest: ".concat(stats.lowestRating));
                process.exit(0);
                _b.label = 6;
            case 6:
                if (!options.leaderboard) return [3 /*break*/, 8];
                limit = typeof options.leaderboard === 'string'
                    ? parseInt(options.leaderboard)
                    : 10;
                return [4 /*yield*/, store.getLeaderboard(limit)];
            case 7:
                leaderboard = _b.sent();
                if (leaderboard.length === 0) {
                    console.log('No ratings recorded yet.');
                }
                else {
                    console.log("Top ".concat(leaderboard.length, " agents by rating:\n"));
                    leaderboard.forEach(function (entry, i) {
                        console.log("  ".concat(i + 1, ". ").concat(entry.agentId));
                        console.log("     Rating: ".concat(entry.rating, " | Transactions: ").concat(entry.transactions));
                    });
                }
                process.exit(0);
                _b.label = 8;
            case 8:
                if (!options.stats) return [3 /*break*/, 10];
                return [4 /*yield*/, store.getStats()];
            case 9:
                stats = _b.sent();
                console.log('Rating System Statistics:');
                console.log("  Total agents: ".concat(stats.totalAgents));
                console.log("  Total transactions: ".concat(stats.totalTransactions));
                console.log("  Average rating: ".concat(stats.averageRating));
                console.log("  Highest rating: ".concat(stats.highestRating));
                console.log("  Lowest rating: ".concat(stats.lowestRating));
                console.log("  Default rating: ".concat(reputation_js_1.DEFAULT_RATING));
                console.log("\nRatings file: ".concat(options.file));
                process.exit(0);
                _b.label = 10;
            case 10:
                if (!agent) return [3 /*break*/, 13];
                return [4 /*yield*/, store.getRating(agent)];
            case 11:
                rating = _b.sent();
                console.log("Rating for ".concat(rating.agentId, ":"));
                console.log("  Rating: ".concat(rating.rating).concat(rating.isNew ? ' (new agent)' : ''));
                console.log("  Transactions: ".concat(rating.transactions));
                if (rating.updated) {
                    console.log("  Last updated: ".concat(rating.updated));
                }
                return [4 /*yield*/, store.getAgentKFactor(agent)];
            case 12:
                kFactor = _b.sent();
                console.log("  K-factor: ".concat(kFactor));
                process.exit(0);
                _b.label = 13;
            case 13:
                agentId = null;
                _b.label = 14;
            case 14:
                _b.trys.push([14, 16, , 17]);
                return [4 /*yield*/, identity_js_1.Identity.load(options.identity)];
            case 15:
                identity = _b.sent();
                agentId = "@".concat(identity.getAgentId());
                return [3 /*break*/, 17];
            case 16:
                _a = _b.sent();
                return [3 /*break*/, 17];
            case 17:
                if (!agentId) return [3 /*break*/, 20];
                return [4 /*yield*/, store.getRating(agentId)];
            case 18:
                rating = _b.sent();
                console.log("Your rating (".concat(agentId, "):"));
                console.log("  Rating: ".concat(rating.rating).concat(rating.isNew ? ' (new agent)' : ''));
                console.log("  Transactions: ".concat(rating.transactions));
                if (rating.updated) {
                    console.log("  Last updated: ".concat(rating.updated));
                }
                return [4 /*yield*/, store.getAgentKFactor(agentId)];
            case 19:
                kFactor = _b.sent();
                console.log("  K-factor: ".concat(kFactor));
                return [3 /*break*/, 21];
            case 20:
                // Show help
                console.log('ELO-based Reputation Rating System');
                console.log('');
                console.log('Usage:');
                console.log('  agentchat ratings              Show your rating (requires identity)');
                console.log('  agentchat ratings <agent-id>   Show specific agent rating');
                console.log('  agentchat ratings --leaderboard [n]  Show top N agents');
                console.log('  agentchat ratings --stats      Show system statistics');
                console.log('  agentchat ratings --export     Export all ratings as JSON');
                console.log('  agentchat ratings --recalculate  Rebuild ratings from receipts');
                console.log('');
                console.log('How it works:');
                console.log("  - New agents start at ".concat(reputation_js_1.DEFAULT_RATING));
                console.log('  - On COMPLETE: both parties gain rating');
                console.log('  - On DISPUTE: at-fault party loses rating');
                console.log('  - Completing with higher-rated agents = more gain');
                console.log('  - K-factor: 32 (new) -> 24 (intermediate) -> 16 (established)');
                console.log('');
                console.log("Ratings file: ".concat(options.file));
                _b.label = 21;
            case 21:
                process.exit(0);
                return [3 /*break*/, 23];
            case 22:
                err_16 = _b.sent();
                error = err_16;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 23];
            case 23: return [2 /*return*/];
        }
    });
}); });
// Skills command - skill discovery and announcement
commander_1.program
    .command('skills <action> [server]')
    .description('Manage skill discovery: announce, search, list')
    .option('-c, --capability <capability>', 'Skill capability for announce/search')
    .option('-r, --rate <rate>', 'Rate/price for the skill', parseFloat)
    .option('--currency <currency>', 'Currency for rate (e.g., SOL, TEST)', 'TEST')
    .option('--description <desc>', 'Description of skill')
    .option('-f, --file <file>', 'YAML file with skill definitions')
    .option('-i, --identity <file>', 'Path to identity file', identity_js_1.DEFAULT_IDENTITY_PATH)
    .option('--max-rate <rate>', 'Maximum rate for search', parseFloat)
    .option('-l, --limit <n>', 'Limit search results', parseInt)
    .option('--json', 'Output as JSON')
    .action(function (action, server, options) { return __awaiter(void 0, void 0, void 0, function () {
    var skills, yaml, content, data, identity, skillsContent, sig, client_2, response, query, client_3, queryId, response_1, _i, _a, skill, rate, err_17, error;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 15, , 16]);
                if (!(action === 'announce')) return [3 /*break*/, 9];
                if (!server) {
                    console.error('Server URL required: agentchat skills announce <server>');
                    process.exit(1);
                }
                skills = [];
                if (!options.file) return [3 /*break*/, 3];
                return [4 /*yield*/, Promise.resolve().then(function () { return require('js-yaml'); })];
            case 1:
                yaml = _b.sent();
                return [4 /*yield*/, promises_1.default.readFile(options.file, 'utf-8')];
            case 2:
                content = _b.sent();
                data = yaml.default.load(content);
                skills = data.skills || [data];
                return [3 /*break*/, 4];
            case 3:
                if (options.capability) {
                    // Single skill from CLI args
                    skills = [{
                            capability: options.capability,
                            rate: options.rate,
                            currency: options.currency,
                            description: options.description
                        }];
                }
                else {
                    console.error('Either --file or --capability required');
                    process.exit(1);
                }
                _b.label = 4;
            case 4: return [4 /*yield*/, identity_js_1.Identity.load(options.identity)];
            case 5:
                identity = _b.sent();
                skillsContent = JSON.stringify(skills);
                sig = identity.sign(skillsContent);
                client_2 = new client_js_1.AgentChatClient({ server: server, identity: options.identity });
                return [4 /*yield*/, client_2.connect()];
            case 6:
                _b.sent();
                return [4 /*yield*/, client_2.sendRaw({
                        type: 'REGISTER_SKILLS',
                        skills: skills,
                        sig: sig
                    })];
            case 7:
                _b.sent();
                return [4 /*yield*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () { return reject(new Error('Timeout')); }, 5000);
                        client_2.on('message', function (msg) {
                            var message = msg;
                            if (message.type === 'SKILLS_REGISTERED' || message.type === 'ERROR') {
                                clearTimeout(timeout);
                                resolve(message);
                            }
                        });
                    })];
            case 8:
                response = _b.sent();
                client_2.disconnect();
                if (response.type === 'ERROR') {
                    console.error('Error:', response.message);
                    process.exit(1);
                }
                console.log("Registered ".concat(response.skills_count, " skill(s) for ").concat(response.agent_id));
                return [3 /*break*/, 14];
            case 9:
                if (!(action === 'search')) return [3 /*break*/, 13];
                if (!server) {
                    console.error('Server URL required: agentchat skills search <server>');
                    process.exit(1);
                }
                query = {};
                if (options.capability)
                    query.capability = options.capability;
                if (options.maxRate !== undefined)
                    query.max_rate = options.maxRate;
                if (options.currency)
                    query.currency = options.currency;
                if (options.limit)
                    query.limit = options.limit;
                client_3 = new client_js_1.AgentChatClient({ server: server });
                return [4 /*yield*/, client_3.connect()];
            case 10:
                _b.sent();
                queryId = "q_".concat(Date.now());
                return [4 /*yield*/, client_3.sendRaw({
                        type: 'SEARCH_SKILLS',
                        query: query,
                        query_id: queryId
                    })];
            case 11:
                _b.sent();
                return [4 /*yield*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () { return reject(new Error('Timeout')); }, 5000);
                        client_3.on('message', function (msg) {
                            var message = msg;
                            if (message.type === 'SEARCH_RESULTS' || message.type === 'ERROR') {
                                clearTimeout(timeout);
                                resolve(message);
                            }
                        });
                    })];
            case 12:
                response_1 = _b.sent();
                client_3.disconnect();
                if (response_1.type === 'ERROR') {
                    console.error('Error:', response_1.message);
                    process.exit(1);
                }
                if (options.json) {
                    console.log(JSON.stringify(response_1.results, null, 2));
                }
                else {
                    console.log("Found ".concat(response_1.results.length, " skill(s) (").concat(response_1.total, " total):\n"));
                    for (_i = 0, _a = response_1.results; _i < _a.length; _i++) {
                        skill = _a[_i];
                        rate = skill.rate !== undefined ? "".concat(skill.rate, " ").concat(skill.currency || '') : 'negotiable';
                        console.log("  ".concat(skill.agent_id));
                        console.log("    Capability: ".concat(skill.capability));
                        console.log("    Rate: ".concat(rate));
                        if (skill.description)
                            console.log("    Description: ".concat(skill.description));
                        console.log('');
                    }
                }
                return [3 /*break*/, 14];
            case 13:
                if (action === 'list') {
                    // List own registered skills (if server supports it)
                    console.error('List action not yet implemented');
                    process.exit(1);
                }
                else {
                    console.error("Unknown action: ".concat(action));
                    console.error('Valid actions: announce, search, list');
                    process.exit(1);
                }
                _b.label = 14;
            case 14: return [3 /*break*/, 16];
            case 15:
                err_17 = _b.sent();
                error = err_17;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 16];
            case 16: return [2 /*return*/];
        }
    });
}); });
// Discover command - find public AgentChat servers
commander_1.program
    .command('discover')
    .description('Discover available AgentChat servers')
    .option('--add <url>', 'Add a server to the directory')
    .option('--remove <url>', 'Remove a server from the directory')
    .option('--name <name>', 'Server name (for --add)')
    .option('--description <desc>', 'Server description (for --add)')
    .option('--region <region>', 'Server region (for --add)')
    .option('--online', 'Only show online servers')
    .option('--json', 'Output as JSON')
    .option('--no-check', 'List servers without health check')
    .option('--directory <path>', 'Custom directory file path', server_directory_js_1.DEFAULT_DIRECTORY_PATH)
    .action(function (options) { return __awaiter(void 0, void 0, void 0, function () {
    var directory, servers, _i, servers_1, server, statusIcon, serverWithHealth, err_18, error;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 9, , 10]);
                directory = new server_directory_js_1.ServerDirectory({ directoryPath: options.directory });
                return [4 /*yield*/, directory.load()];
            case 1:
                _b.sent();
                if (!options.add) return [3 /*break*/, 3];
                return [4 /*yield*/, directory.addServer({
                        url: options.add,
                        name: options.name || options.add,
                        description: options.description || '',
                        region: options.region || 'unknown'
                    })];
            case 2:
                _b.sent();
                console.log("Added server: ".concat(options.add));
                process.exit(0);
                _b.label = 3;
            case 3:
                if (!options.remove) return [3 /*break*/, 5];
                return [4 /*yield*/, directory.removeServer(options.remove)];
            case 4:
                _b.sent();
                console.log("Removed server: ".concat(options.remove));
                process.exit(0);
                _b.label = 5;
            case 5:
                servers = void 0;
                if (!(options.check === false)) return [3 /*break*/, 6];
                servers = directory.list().map(function (s) { return (__assign(__assign({}, s), { status: 'unknown' })); });
                return [3 /*break*/, 8];
            case 6:
                console.error('Checking server status...');
                return [4 /*yield*/, directory.discover({ onlineOnly: options.online })];
            case 7:
                servers = _b.sent();
                _b.label = 8;
            case 8:
                if (options.json) {
                    console.log(JSON.stringify(servers, null, 2));
                }
                else {
                    if (servers.length === 0) {
                        console.log('No servers found.');
                    }
                    else {
                        console.log("\nFound ".concat(servers.length, " server(s):\n"));
                        for (_i = 0, servers_1 = servers; _i < servers_1.length; _i++) {
                            server = servers_1[_i];
                            statusIcon = server.status === 'online' ? '\u2713' :
                                server.status === 'offline' ? '\u2717' : '?';
                            console.log("  ".concat(statusIcon, " ").concat(server.name));
                            console.log("    URL: ".concat(server.url));
                            console.log("    Status: ".concat(server.status));
                            if (server.description) {
                                console.log("    Description: ".concat(server.description));
                            }
                            if (server.region) {
                                console.log("    Region: ".concat(server.region));
                            }
                            serverWithHealth = server;
                            if (serverWithHealth.health) {
                                console.log("    Agents: ".concat(((_a = serverWithHealth.health.agents) === null || _a === void 0 ? void 0 : _a.connected) || 0));
                                console.log("    Uptime: ".concat(serverWithHealth.health.uptime_seconds || 0, "s"));
                            }
                            if (serverWithHealth.error) {
                                console.log("    Error: ".concat(serverWithHealth.error));
                            }
                            console.log('');
                        }
                    }
                    console.log("Directory: ".concat(options.directory));
                }
                process.exit(0);
                return [3 /*break*/, 10];
            case 9:
                err_18 = _b.sent();
                error = err_18;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 10];
            case 10: return [2 /*return*/];
        }
    });
}); });
// Deploy command
commander_1.program
    .command('deploy')
    .description('Generate deployment files for agentchat server')
    .option('--provider <provider>', 'Deployment target (docker, akash)', 'docker')
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
    // Akash-specific options
    .option('--generate-wallet', 'Generate a new Akash wallet')
    .option('--wallet <file>', 'Path to wallet file', index_js_1.AKASH_WALLET_PATH)
    .option('--balance', 'Check wallet balance')
    .option('--testnet', 'Use Akash testnet (default)')
    .option('--mainnet', 'Use Akash mainnet (real funds!)')
    .option('--create', 'Create deployment on Akash')
    .option('--status', 'Show deployment status')
    .option('--close <dseq>', 'Close a deployment by dseq')
    .option('--generate-sdl', 'Generate SDL file without deploying')
    .option('--force', 'Overwrite existing wallet')
    .option('--bids <dseq>', 'Query bids for a deployment')
    .option('--accept-bid <dseq>', 'Accept a bid (use with --provider-address)')
    .option('--provider-address <address>', 'Provider address for --accept-bid')
    .option('--dseq-status <dseq>', 'Get detailed status for a specific deployment')
    .action(function (options) { return __awaiter(void 0, void 0, void 0, function () {
    var isAkash, akashNetwork, wallet, err_19, error, result, sdl, outputDir_1, sdlPath, result, err_20, error, deployments, _i, _a, d, bids, _b, _c, b, bid, price, state, provider, lease, status_5, _d, _e, bid, configPath, config, fileConfig, outputDir, compose, composePath, dockerfile, dockerfilePath, err_21, error;
    var _f, _g;
    return __generator(this, function (_h) {
        switch (_h.label) {
            case 0:
                _h.trys.push([0, 38, , 39]);
                isAkash = options.provider === 'akash';
                akashNetwork = options.mainnet ? 'mainnet' : 'testnet';
                if (!(isAkash && options.generateWallet)) return [3 /*break*/, 4];
                _h.label = 1;
            case 1:
                _h.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, index_js_1.generateWallet)(akashNetwork, options.wallet)];
            case 2:
                wallet = _h.sent();
                console.log('Generated new Akash wallet:');
                console.log("  Network:  ".concat(wallet.network));
                console.log("  Address:  ".concat(wallet.address));
                console.log("  Saved to: ".concat(options.wallet));
                console.log('');
                console.log('IMPORTANT: Back up your wallet file!');
                console.log('The mnemonic inside is the only way to recover your funds.');
                console.log('');
                if (akashNetwork === 'testnet') {
                    console.log('To get testnet tokens, visit: https://faucet.sandbox-01.aksh.pw/');
                }
                else {
                    console.log('To fund your wallet, send AKT to the address above.');
                }
                process.exit(0);
                return [3 /*break*/, 4];
            case 3:
                err_19 = _h.sent();
                error = err_19;
                if (error.message.includes('already exists') && !options.force) {
                    console.error(error.message);
                    process.exit(1);
                }
                throw err_19;
            case 4:
                if (!(isAkash && options.balance)) return [3 /*break*/, 6];
                return [4 /*yield*/, (0, index_js_1.checkBalance)(options.wallet)];
            case 5:
                result = _h.sent();
                console.log('Wallet Balance:');
                console.log("  Network: ".concat(result.wallet.network));
                console.log("  Address: ".concat(result.wallet.address));
                console.log("  Balance: ".concat(result.balance.akt, " AKT (").concat(result.balance.uakt, " uakt)"));
                console.log("  Status:  ".concat(result.balance.sufficient ? 'Sufficient for deployment' : 'Insufficient - need at least 5 AKT'));
                process.exit(0);
                _h.label = 6;
            case 6:
                if (!(isAkash && options.generateSdl)) return [3 /*break*/, 9];
                sdl = (0, index_js_1.generateAkashSDL)({
                    name: options.name,
                    port: options.port ? parseInt(options.port) : undefined
                });
                outputDir_1 = path_1.default.resolve(options.output);
                return [4 /*yield*/, promises_1.default.mkdir(outputDir_1, { recursive: true })];
            case 7:
                _h.sent();
                sdlPath = path_1.default.join(outputDir_1, 'deploy.yaml');
                return [4 /*yield*/, promises_1.default.writeFile(sdlPath, sdl)];
            case 8:
                _h.sent();
                console.log("Generated: ".concat(sdlPath));
                console.log('\nThis SDL can be used with the Akash CLI or Console.');
                process.exit(0);
                _h.label = 9;
            case 9:
                if (!(isAkash && options.create)) return [3 /*break*/, 14];
                console.log('Creating Akash deployment...');
                _h.label = 10;
            case 10:
                _h.trys.push([10, 12, , 13]);
                return [4 /*yield*/, (0, index_js_1.createDeployment)({
                        walletPath: options.wallet,
                        name: options.name,
                        port: options.port ? parseInt(options.port) : undefined
                    })];
            case 11:
                result = _h.sent();
                console.log('Deployment created:');
                console.log("  DSEQ: ".concat(result.dseq));
                console.log("  Status: ".concat(result.status));
                if (result.endpoint) {
                    console.log("  Endpoint: ".concat(result.endpoint));
                }
                return [3 /*break*/, 13];
            case 12:
                err_20 = _h.sent();
                error = err_20;
                console.error('Deployment failed:', error.message);
                process.exit(1);
                return [3 /*break*/, 13];
            case 13:
                process.exit(0);
                _h.label = 14;
            case 14:
                if (!(isAkash && options.status)) return [3 /*break*/, 16];
                return [4 /*yield*/, (0, index_js_1.listDeployments)(options.wallet)];
            case 15:
                deployments = _h.sent();
                if (deployments.length === 0) {
                    console.log('No active deployments.');
                }
                else {
                    console.log('Active deployments:');
                    for (_i = 0, _a = deployments; _i < _a.length; _i++) {
                        d = _a[_i];
                        console.log("  DSEQ ".concat(d.dseq, ": ").concat(d.status, " - ").concat(d.endpoint || 'pending'));
                    }
                }
                process.exit(0);
                _h.label = 16;
            case 16:
                if (!(isAkash && options.close)) return [3 /*break*/, 18];
                console.log("Closing deployment ".concat(options.close, "..."));
                return [4 /*yield*/, (0, index_js_1.closeDeployment)(options.close, options.wallet)];
            case 17:
                _h.sent();
                console.log('Deployment closed.');
                process.exit(0);
                _h.label = 18;
            case 18:
                if (!(isAkash && options.bids)) return [3 /*break*/, 20];
                console.log("Querying bids for deployment ".concat(options.bids, "..."));
                return [4 /*yield*/, (0, index_js_1.queryBids)(options.bids, options.wallet)];
            case 19:
                bids = _h.sent();
                if (bids.length === 0) {
                    console.log('No bids received yet.');
                }
                else {
                    console.log('Available bids:');
                    for (_b = 0, _c = bids; _b < _c.length; _b++) {
                        b = _c[_b];
                        bid = b.bid || {};
                        price = ((_f = bid.price) === null || _f === void 0 ? void 0 : _f.amount) || 'unknown';
                        state = bid.state || 'unknown';
                        provider = ((_g = bid.bidId) === null || _g === void 0 ? void 0 : _g.provider) || 'unknown';
                        console.log("  Provider: ".concat(provider));
                        console.log("    Price: ".concat(price, " uakt/block"));
                        console.log("    State: ".concat(state));
                        console.log('');
                    }
                }
                process.exit(0);
                _h.label = 20;
            case 20:
                if (!(isAkash && options.acceptBid)) return [3 /*break*/, 22];
                if (!options.providerAddress) {
                    console.error('Error: --provider-address is required with --accept-bid');
                    process.exit(1);
                }
                console.log("Accepting bid from ".concat(options.providerAddress, "..."));
                return [4 /*yield*/, (0, index_js_1.acceptBid)(options.acceptBid, options.providerAddress, options.wallet)];
            case 21:
                lease = _h.sent();
                console.log('Lease created:');
                console.log("  DSEQ: ".concat(lease.dseq));
                console.log("  Provider: ".concat(lease.provider));
                console.log("  TX: ".concat(lease.txHash));
                process.exit(0);
                _h.label = 22;
            case 22:
                if (!(isAkash && options.dseqStatus)) return [3 /*break*/, 24];
                console.log("Getting status for deployment ".concat(options.dseqStatus, "..."));
                return [4 /*yield*/, (0, index_js_1.getDeploymentStatus)(options.dseqStatus, options.wallet)];
            case 23:
                status_5 = _h.sent();
                console.log('Deployment status:');
                console.log("  DSEQ: ".concat(status_5.dseq));
                console.log("  Status: ".concat(status_5.status));
                console.log("  Created: ".concat(status_5.createdAt));
                if (status_5.provider) {
                    console.log("  Provider: ".concat(status_5.provider));
                }
                if (status_5.bids) {
                    console.log("  Bids: ".concat(status_5.bids.length));
                    for (_d = 0, _e = status_5.bids; _d < _e.length; _d++) {
                        bid = _e[_d];
                        console.log("    - ".concat(bid.provider, ": ").concat(bid.price, " uakt (").concat(bid.state, ")"));
                    }
                }
                if (status_5.leaseStatus) {
                    console.log('  Lease Status:', JSON.stringify(status_5.leaseStatus, null, 2));
                }
                if (status_5.leaseStatusError) {
                    console.log("  Lease Status Error: ".concat(status_5.leaseStatusError));
                }
                process.exit(0);
                _h.label = 24;
            case 24:
                // Akash: Default action - show help
                if (isAkash) {
                    console.log('Akash Deployment Options:');
                    console.log('');
                    console.log('  Setup:');
                    console.log('    --generate-wallet  Generate a new wallet');
                    console.log('    --balance          Check wallet balance');
                    console.log('');
                    console.log('  Deployment:');
                    console.log('    --generate-sdl     Generate SDL file');
                    console.log('    --create           Create deployment (auto-accepts best bid)');
                    console.log('    --status           Show all deployments');
                    console.log('    --dseq-status <n>  Get detailed status for deployment');
                    console.log('    --close <dseq>     Close a deployment');
                    console.log('');
                    console.log('  Manual bid selection:');
                    console.log('    --bids <dseq>      Query bids for a deployment');
                    console.log('    --accept-bid <dseq> --provider-address <addr>');
                    console.log('                       Accept a specific bid');
                    console.log('');
                    console.log('  Options:');
                    console.log('    --testnet          Use testnet (default)');
                    console.log('    --mainnet          Use mainnet (real AKT)');
                    console.log('    --wallet <file>    Custom wallet path');
                    console.log('');
                    console.log('Example workflow:');
                    console.log('  1. agentchat deploy --provider akash --generate-wallet');
                    console.log('  2. Fund wallet with AKT tokens');
                    console.log('  3. agentchat deploy --provider akash --balance');
                    console.log('  4. agentchat deploy --provider akash --create');
                    console.log('');
                    console.log('Manual workflow (select your own provider):');
                    console.log('  1. agentchat deploy --provider akash --generate-sdl');
                    console.log('  2. agentchat deploy --provider akash --create');
                    console.log('  3. agentchat deploy --provider akash --bids <dseq>');
                    console.log('  4. agentchat deploy --provider akash --accept-bid <dseq> --provider-address <addr>');
                    process.exit(0);
                }
                if (!options.initConfig) return [3 /*break*/, 27];
                configPath = path_1.default.resolve(options.output, 'deploy.yaml');
                return [4 /*yield*/, promises_1.default.mkdir(path_1.default.dirname(configPath), { recursive: true })];
            case 25:
                _h.sent();
                return [4 /*yield*/, promises_1.default.writeFile(configPath, (0, config_js_1.generateExampleConfig)())];
            case 26:
                _h.sent();
                console.log("Generated: ".concat(configPath));
                process.exit(0);
                _h.label = 27;
            case 27:
                config = __assign({}, config_js_1.DEFAULT_CONFIG);
                if (!options.config) return [3 /*break*/, 29];
                return [4 /*yield*/, (0, config_js_1.loadConfig)(options.config)];
            case 28:
                fileConfig = _h.sent();
                config = __assign(__assign({}, config), fileConfig);
                _h.label = 29;
            case 29:
                // Override with CLI options
                if (options.port)
                    config.port = parseInt(options.port);
                if (options.name)
                    config.name = options.name;
                if (options.volumes)
                    config.volumes = true;
                if (options.healthCheck === false)
                    config.healthCheck = false;
                if (options.network)
                    config.network = options.network;
                if (options.cert && options.key) {
                    config.tls = { cert: options.cert, key: options.key };
                }
                // Validate TLS
                if ((options.cert && !options.key) || (!options.cert && options.key)) {
                    console.error('Error: Both --cert and --key must be provided for TLS');
                    process.exit(1);
                }
                outputDir = path_1.default.resolve(options.output);
                return [4 /*yield*/, promises_1.default.mkdir(outputDir, { recursive: true })];
            case 30:
                _h.sent();
                if (!(options.provider === 'docker' || config.provider === 'docker')) return [3 /*break*/, 36];
                return [4 /*yield*/, (0, index_js_1.deployToDocker)(config)];
            case 31:
                compose = _h.sent();
                composePath = path_1.default.join(outputDir, 'docker-compose.yml');
                return [4 /*yield*/, promises_1.default.writeFile(composePath, compose)];
            case 32:
                _h.sent();
                console.log("Generated: ".concat(composePath));
                if (!options.dockerfile) return [3 /*break*/, 35];
                return [4 /*yield*/, (0, index_js_1.generateDockerfile)(config)];
            case 33:
                dockerfile = _h.sent();
                dockerfilePath = path_1.default.join(outputDir, 'Dockerfile.generated');
                return [4 /*yield*/, promises_1.default.writeFile(dockerfilePath, dockerfile)];
            case 34:
                _h.sent();
                console.log("Generated: ".concat(dockerfilePath));
                _h.label = 35;
            case 35:
                console.log('\nTo deploy:');
                console.log("  cd ".concat(outputDir));
                console.log('  docker-compose up -d');
                return [3 /*break*/, 37];
            case 36:
                console.error("Unknown provider: ".concat(options.provider));
                process.exit(1);
                _h.label = 37;
            case 37:
                process.exit(0);
                return [3 /*break*/, 39];
            case 38:
                err_21 = _h.sent();
                error = err_21;
                console.error('Error:', error.message);
                process.exit(1);
                return [3 /*break*/, 39];
            case 39: return [2 /*return*/];
        }
    });
}); });
// Launcher mode: if no subcommand or just a name, setup MCP + launch Claude
var subcommands = [
    'serve', 'send', 'listen', 'channels', 'agents', 'create', 'invite',
    'propose', 'accept', 'reject', 'complete', 'dispute', 'verify',
    'identity', 'daemon', 'receipts', 'ratings', 'skills', 'discover', 'deploy',
    'help', '--help', '-h', '--version', '-V'
];
var firstArg = process.argv[2];
if (!firstArg || !subcommands.includes(firstArg)) {
    // Launcher mode
    // Security check: prevent running in root/system directories
    var safetyCheck = (0, security_js_1.checkDirectorySafety)(process.cwd());
    if (safetyCheck.level === 'error') {
        console.error("\n\u274C ERROR: ".concat(safetyCheck.error));
        process.exit(1);
    }
    if (safetyCheck.level === 'warning') {
        console.error("\n\u26A0\uFE0F  WARNING: ".concat(safetyCheck.warning));
    }
    Promise.resolve().then(function () { return require('child_process'); }).then(function (_a) {
        var execSync = _a.execSync, spawn = _a.spawn;
        var name = firstArg; // May be undefined (anonymous) or a name
        // 1. Check if MCP is configured
        var mcpConfigured = false;
        try {
            var mcpList = execSync('claude mcp list 2>&1', { encoding: 'utf-8' });
            mcpConfigured = mcpList.includes('agentchat');
        }
        catch (_b) {
            // claude command might not exist
        }
        // 2. Setup MCP if needed
        if (!mcpConfigured) {
            console.log('Setting up AgentChat for Claude Code...');
            try {
                execSync('claude mcp add -s user agentchat -- npx -y @tjamescouch/agentchat-mcp', {
                    stdio: 'inherit'
                });
                console.log('');
                console.log('AgentChat installed! Starting Claude Code...');
                console.log('');
            }
            catch (_c) {
                console.error('Failed to setup MCP. Is Claude Code installed?');
                console.error('Install from: https://claude.ai/download');
                process.exit(1);
            }
        }
        // 3. Launch Claude with prompt
        var prompt = name
            ? "Connect to agentchat with name \"".concat(name, "\" and introduce yourself in #general. Read SKILL.md if you need help.")
            : "Connect to agentchat and introduce yourself in #general. Read SKILL.md if you need help.";
        var claude = spawn('claude', [prompt], {
            stdio: 'inherit'
        });
        claude.on('error', function (err) {
            console.error('Failed to start Claude Code:', err.message);
            process.exit(1);
        });
        claude.on('close', function (code) {
            process.exit(code || 0);
        });
    });
}
else {
    // Normal CLI mode
    commander_1.program.parse();
}
