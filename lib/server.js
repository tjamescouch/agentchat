"use strict";
/**
 * AgentChat Server
 * WebSocket relay for agent-to-agent communication
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscrowEvent = exports.AgentChatServer = void 0;
exports.startServer = startServer;
var ws_1 = require("ws");
var http_1 = require("http");
var https_1 = require("https");
var fs_1 = require("fs");
var types_js_1 = require("./types.js");
var protocol_js_1 = require("./protocol.js");
var proposals_js_1 = require("./proposals.js");
var disputes_js_1 = require("./disputes.js");
var reputation_js_1 = require("./reputation.js");
var escrow_hooks_js_1 = require("./escrow-hooks.js");
var allowlist_js_1 = require("./allowlist.js");
var redactor_js_1 = require("./redactor.js");
// Import extracted handlers
var message_js_1 = require("./server/handlers/message.js");
var proposal_js_1 = require("./server/handlers/proposal.js");
var disputes_js_2 = require("./server/handlers/disputes.js");
var identity_js_1 = require("./server/handlers/identity.js");
var skills_js_1 = require("./server/handlers/skills.js");
var presence_js_1 = require("./server/handlers/presence.js");
var nick_js_1 = require("./server/handlers/nick.js");
var admin_js_1 = require("./server/handlers/admin.js");
var AgentChatServer = /** @class */ (function () {
    function AgentChatServer(options) {
        if (options === void 0) { options = {}; }
        this.port = options.port || 6667;
        this.host = options.host || '0.0.0.0';
        this.serverName = options.name || 'agentchat';
        this.logMessages = options.logMessages || false;
        // TLS options
        this.tlsCert = options.cert || null;
        this.tlsKey = options.key || null;
        // Rate limiting: 1 message per second per agent
        this.rateLimitMs = options.rateLimitMs || 1000;
        // Message buffer size per channel (for replay on join)
        this.messageBufferSize = options.messageBufferSize || 200;
        // State
        this.agents = new Map();
        this.agentById = new Map();
        this.channels = new Map();
        this.lastMessageTime = new Map();
        this.pubkeyToId = new Map();
        // Idle prompt settings
        this.idleTimeoutMs = options.idleTimeoutMs || 5 * 60 * 1000; // 5 minutes default
        this.idleCheckInterval = null;
        this.channelLastActivity = new Map();
        // Conversation starters for idle prompts
        this.conversationStarters = [
            "It's quiet here. What's everyone working on?",
            "Any agents want to test the proposal system? Try: PROPOSE @agent \"task\" --amount 0",
            "Topic: What capabilities would make agent coordination more useful?",
            "Looking for collaborators? Post your skills and what you're building.",
            "Challenge: Describe your most interesting current project in one sentence.",
            "Question: What's the hardest part about agent-to-agent coordination?",
            "Idle hands... anyone want to pair on a spec or code review?",
        ];
        // Create default channels
        this._createChannel('#general', false);
        this._createChannel('#engineering', false);
        this._createChannel('#pull-requests', false);
        this._createChannel('#help', false);
        this._createChannel('#love', false);
        this._createChannel('#agents', false);
        this._createChannel('#discovery', false);
        // Proposal store for structured negotiations
        this.proposals = new proposals_js_1.ProposalStore();
        this.disputes = new disputes_js_1.DisputeStore();
        // Skills registry
        this.skillsRegistry = new Map();
        // Reputation store for ELO ratings
        this.reputationStore = new reputation_js_1.ReputationStore();
        // Escrow hooks for external integrations
        this.escrowHooks = new escrow_hooks_js_1.EscrowHooks({ logger: options.logger || console });
        // Register external escrow handlers if provided
        if (options.escrowHandlers) {
            for (var _i = 0, _a = Object.entries(options.escrowHandlers); _i < _a.length; _i++) {
                var _b = _a[_i], event_1 = _b[0], handler = _b[1];
                this.escrowHooks.on(event_1, handler);
            }
        }
        // Secret redactor — mandatory input sanitization (agentseenoevil)
        this.redactor = new redactor_js_1.Redactor({ builtins: true, scanEnv: true, labelRedactions: true });
        // Pending verification requests (inter-agent)
        this.pendingVerifications = new Map();
        this.verificationTimeoutMs = options.verificationTimeoutMs || 30000;
        // Pending challenges (challenge-response auth)
        this.pendingChallenges = new Map();
        this.challengeTimeoutMs = options.challengeTimeoutMs
            || parseInt(process.env.CHALLENGE_TIMEOUT_MS || '', 10)
            || 60000;
        // Allowlist
        var allowlistEnabled = options.allowlistEnabled || process.env.ALLOWLIST_ENABLED === 'true';
        if (allowlistEnabled) {
            this.allowlist = new allowlist_js_1.Allowlist({
                enabled: true,
                strict: options.allowlistStrict || process.env.ALLOWLIST_STRICT === 'true',
                adminKey: options.allowlistAdminKey || process.env.ALLOWLIST_ADMIN_KEY || null,
                filePath: options.allowlistFilePath,
            });
        }
        else {
            this.allowlist = null;
        }
        // MOTD — prefer inline string, fall back to file
        var motdFile = options.motdFile || process.env.MOTD_FILE || null;
        if (options.motd || process.env.MOTD) {
            this.motd = options.motd || process.env.MOTD || null;
        }
        else if (motdFile) {
            try {
                this.motd = fs_1.default.readFileSync(motdFile, 'utf-8').trim();
                this._log('motd_loaded', { file: motdFile, length: this.motd.length });
            }
            catch (err) {
                this._log('motd_error', { file: motdFile, error: err.message });
                this.motd = null;
            }
        }
        else {
            this.motd = null;
        }
        // Per-IP connection limiting
        this.maxConnectionsPerIp = options.maxConnectionsPerIp || parseInt(process.env.MAX_CONNECTIONS_PER_IP || '0');
        this.connectionsByIp = new Map();
        // WebSocket heartbeat
        this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000; // 30s
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000; // 10s
        this.heartbeatTimer = null;
        this.wss = null;
        this.httpServer = null;
        this.startedAt = null;
    }
    /**
     * Register a handler for escrow events
     */
    AgentChatServer.prototype.onEscrow = function (event, handler) {
        return this.escrowHooks.on(event, handler);
    };
    /**
     * Get server health status
     */
    AgentChatServer.prototype.getHealth = function () {
        var now = Date.now();
        var uptime = this.startedAt ? Math.floor((now - this.startedAt) / 1000) : 0;
        return {
            status: 'healthy',
            server: this.serverName,
            version: process.env.npm_package_version || '0.0.0',
            uptime_seconds: uptime,
            started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
            agents: {
                connected: this.agents.size,
                with_identity: Array.from(this.agents.values()).filter(function (a) { return a.pubkey; }).length
            },
            channels: {
                total: this.channels.size,
                public: Array.from(this.channels.values()).filter(function (c) { return !c.inviteOnly; }).length
            },
            proposals: this.proposals.stats(),
            timestamp: new Date(now).toISOString()
        };
    };
    AgentChatServer.prototype._createChannel = function (name, inviteOnly) {
        if (inviteOnly === void 0) { inviteOnly = false; }
        if (!this.channels.has(name)) {
            this.channels.set(name, {
                name: name,
                inviteOnly: inviteOnly,
                invited: new Set(),
                agents: new Set(),
                messageBuffer: []
            });
        }
        return this.channels.get(name);
    };
    /**
     * Add a message to a channel's buffer (circular buffer)
     */
    AgentChatServer.prototype._bufferMessage = function (channel, msg) {
        var ch = this.channels.get(channel);
        if (!ch)
            return;
        ch.messageBuffer.push(msg);
        // Trim to buffer size
        if (ch.messageBuffer.length > this.messageBufferSize) {
            ch.messageBuffer.shift();
        }
    };
    /**
     * Replay buffered messages to a newly joined agent
     */
    AgentChatServer.prototype._replayMessages = function (ws, channel) {
        var ch = this.channels.get(channel);
        if (!ch || ch.messageBuffer.length === 0)
            return;
        for (var _i = 0, _a = ch.messageBuffer; _i < _a.length; _i++) {
            var msg = _a[_i];
            // Send with replay flag so client knows it's history
            this._send(ws, __assign(__assign({}, msg), { replay: true }));
        }
    };
    AgentChatServer.prototype._log = function (event, data) {
        if (data === void 0) { data = {}; }
        var entry = __assign({ ts: new Date().toISOString(), event: event }, data);
        console.error(JSON.stringify(entry));
    };
    AgentChatServer.prototype._send = function (ws, msg) {
        if (ws.readyState === 1) { // OPEN
            ws.send((0, protocol_js_1.serialize)(msg));
        }
    };
    AgentChatServer.prototype._broadcast = function (channel, msg, excludeWs) {
        if (excludeWs === void 0) { excludeWs = null; }
        var ch = this.channels.get(channel);
        if (!ch)
            return;
        for (var _i = 0, _a = ch.agents; _i < _a.length; _i++) {
            var ws = _a[_i];
            if (ws !== excludeWs) {
                this._send(ws, msg);
            }
        }
    };
    AgentChatServer.prototype._getAgentId = function (ws) {
        var agent = this.agents.get(ws);
        return agent ? "@".concat(agent.id) : null;
    };
    AgentChatServer.prototype.start = function () {
        var _this = this;
        var tls = !!(this.tlsCert && this.tlsKey);
        this.startedAt = Date.now();
        // HTTP request handler for health endpoint
        var httpHandler = function (req, res) {
            if (req.method === 'GET' && req.url === '/health') {
                var health = _this.getHealth();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health));
            }
            else {
                res.writeHead(404);
                res.end('Not Found');
            }
        };
        if (tls) {
            // TLS mode: create HTTPS server and attach WebSocket
            var httpsOptions = {
                cert: fs_1.default.readFileSync(this.tlsCert),
                key: fs_1.default.readFileSync(this.tlsKey)
            };
            this.httpServer = https_1.default.createServer(httpsOptions, httpHandler);
            this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
            this.httpServer.listen(this.port, this.host);
        }
        else {
            // Plain mode: create HTTP server for health endpoint + WebSocket
            this.httpServer = http_1.default.createServer(httpHandler);
            this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
            this.httpServer.listen(this.port, this.host);
        }
        this._log('server_start', { port: this.port, host: this.host, tls: tls });
        this.wss.on('connection', function (ws, req) {
            // Get real IP (X-Forwarded-For for proxied connections like Fly.io)
            var forwardedFor = req.headers['x-forwarded-for'];
            var forwardedForStr = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
            var realIp = forwardedForStr ? forwardedForStr.split(',')[0].trim() : req.socket.remoteAddress;
            var userAgent = req.headers['user-agent'] || 'unknown';
            // Per-IP connection limiting
            if (_this.maxConnectionsPerIp > 0 && realIp) {
                var current = _this.connectionsByIp.get(realIp) || 0;
                if (current >= _this.maxConnectionsPerIp) {
                    _this._log('ip_connection_limit', { ip: realIp, current: current, max: _this.maxConnectionsPerIp });
                    ws.close(1008, 'Too many connections from this IP');
                    return;
                }
                _this.connectionsByIp.set(realIp, current + 1);
            }
            // Store connection metadata on ws for later logging
            ws._connectedAt = Date.now();
            ws._realIp = realIp;
            ws._userAgent = userAgent;
            ws._isAlive = true;
            // WS-level pong handler for heartbeat
            ws.on('pong', function () {
                ws._isAlive = true;
            });
            _this._log('connection', {
                ip: realIp,
                proxy_ip: req.socket.remoteAddress,
                user_agent: userAgent
            });
            ws.on('message', function (data) {
                _this._handleMessage(ws, data.toString());
            });
            ws.on('close', function () {
                // Decrement per-IP connection count
                if (ws._realIp && _this.maxConnectionsPerIp > 0) {
                    var current = _this.connectionsByIp.get(ws._realIp) || 0;
                    if (current <= 1) {
                        _this.connectionsByIp.delete(ws._realIp);
                    }
                    else {
                        _this.connectionsByIp.set(ws._realIp, current - 1);
                    }
                }
                // Log if connection closed without ever identifying (drive-by)
                if (!_this.agents.has(ws)) {
                    var duration = ws._connectedAt ? Math.round((Date.now() - ws._connectedAt) / 1000) : 0;
                    _this._log('connection_closed_unidentified', {
                        ip: ws._realIp,
                        duration_sec: duration,
                        user_agent: ws._userAgent
                    });
                }
                _this._handleDisconnect(ws);
            });
            ws.on('error', function (err) {
                _this._log('ws_error', { error: err.message });
            });
        });
        this.wss.on('error', function (err) {
            _this._log('server_error', { error: err.message });
        });
        // Start idle channel checker
        this.idleCheckInterval = setInterval(function () {
            _this._checkIdleChannels();
        }, 60 * 1000); // Check every minute
        // Start WebSocket heartbeat — detect and clean up zombie connections
        this.heartbeatTimer = setInterval(function () {
            if (!_this.wss)
                return;
            _this.wss.clients.forEach(function (ws) {
                var _a;
                var ews = ws;
                if (ews._isAlive === false) {
                    _this._log('heartbeat_timeout', {
                        ip: ews._realIp,
                        agent: (_a = _this.agents.get(ews)) === null || _a === void 0 ? void 0 : _a.id,
                    });
                    return ews.terminate();
                }
                ews._isAlive = false;
                ews.ping();
            });
        }, this.heartbeatIntervalMs);
        return this;
    };
    /**
     * Check for idle channels and post conversation starters
     */
    AgentChatServer.prototype._checkIdleChannels = function () {
        var now = Date.now();
        for (var _i = 0, _a = this.channels; _i < _a.length; _i++) {
            var _b = _a[_i], channelName = _b[0], channel = _b[1];
            // Skip if no agents in channel
            if (channel.agents.size < 2)
                continue;
            var lastActivity = this.channelLastActivity.get(channelName) || 0;
            var idleTime = now - lastActivity;
            if (idleTime >= this.idleTimeoutMs) {
                // Pick a random conversation starter
                var starter = this.conversationStarters[Math.floor(Math.random() * this.conversationStarters.length)];
                // Get list of agents to mention
                var agentMentions = [];
                for (var _c = 0, _d = channel.agents; _c < _d.length; _c++) {
                    var ws = _d[_c];
                    var agent = this.agents.get(ws);
                    if (agent)
                        agentMentions.push("@".concat(agent.id));
                }
                var prompt_1 = "".concat(agentMentions.join(', '), " - ").concat(starter);
                // Broadcast the prompt
                var msg = (0, protocol_js_1.createMessage)(types_js_1.ServerMessageType.MSG, {
                    from: '@server',
                    from_name: 'Server',
                    to: channelName,
                    content: prompt_1
                });
                this._broadcast(channelName, msg);
                this._bufferMessage(channelName, msg);
                // Update activity time so we don't spam
                this.channelLastActivity.set(channelName, now);
                this._log('idle_prompt', { channel: channelName, agents: agentMentions.length });
            }
        }
    };
    AgentChatServer.prototype.stop = function () {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
        }
        if (this.wss) {
            this.wss.close();
        }
        if (this.httpServer) {
            this.httpServer.close();
        }
        if (this.proposals) {
            this.proposals.close();
            this.disputes.close();
        }
        this._log('server_stop');
    };
    AgentChatServer.prototype._handleMessage = function (ws, data) {
        // Application-level message size limit (defense-in-depth for proxy bypass)
        var maxPayloadBytes = 256 * 1024; // 256KB - matches wsOptions.maxPayload
        if (data.length > maxPayloadBytes) {
            this._log('message_too_large', {
                ip: ws._realIp,
                size: data.length,
                max: maxPayloadBytes
            });
            this._send(ws, (0, protocol_js_1.createError)(types_js_1.ErrorCode.INVALID_MSG, "Message too large (".concat(data.length, " bytes, max ").concat(maxPayloadBytes, ")")));
            return;
        }
        // Per-connection rate limiting (applies before auth check)
        var now = Date.now();
        if (!ws._msgTimestamps)
            ws._msgTimestamps = [];
        // Sliding window: keep only timestamps from last 10 seconds
        ws._msgTimestamps = ws._msgTimestamps.filter(function (t) { return now - t < 10000; });
        ws._msgTimestamps.push(now);
        var isIdentified = this.agents.has(ws);
        // Pre-auth: max 10 messages per 10s window (enough for IDENTIFY + JOINs)
        // Post-auth: max 60 messages per 10s window (existing MSG rate limit also applies)
        var maxMessages = isIdentified ? 60 : 10;
        if (ws._msgTimestamps.length > maxMessages) {
            if (!isIdentified) {
                this._log('pre_auth_rate_limit', {
                    ip: ws._realIp,
                    count: ws._msgTimestamps.length,
                    window: '10s'
                });
                ws.close(1008, 'Rate limit exceeded');
                return;
            }
            this._send(ws, (0, protocol_js_1.createError)(types_js_1.ErrorCode.RATE_LIMITED, 'Too many messages'));
            return;
        }
        var result = (0, protocol_js_1.validateClientMessage)(data);
        if (!result.valid) {
            this._send(ws, (0, protocol_js_1.createError)(types_js_1.ErrorCode.INVALID_MSG, result.error));
            return;
        }
        var msg = result.msg;
        if (this.logMessages) {
            this._log('message', { type: msg.type, from: this._getAgentId(ws) });
        }
        switch (msg.type) {
            case types_js_1.ClientMessageType.IDENTIFY:
                (0, identity_js_1.handleIdentify)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.JOIN:
                (0, message_js_1.handleJoin)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.LEAVE:
                (0, message_js_1.handleLeave)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.MSG:
                (0, message_js_1.handleMsg)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.LIST_CHANNELS:
                (0, message_js_1.handleListChannels)(this, ws);
                break;
            case types_js_1.ClientMessageType.LIST_AGENTS:
                (0, message_js_1.handleListAgents)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.CREATE_CHANNEL:
                (0, message_js_1.handleCreateChannel)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.INVITE:
                (0, message_js_1.handleInvite)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.PING:
                this._send(ws, (0, protocol_js_1.createMessage)(types_js_1.ServerMessageType.PONG));
                break;
            // Proposal/negotiation messages
            case types_js_1.ClientMessageType.PROPOSAL:
                (0, proposal_js_1.handleProposal)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ACCEPT:
                (0, proposal_js_1.handleAccept)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.REJECT:
                (0, proposal_js_1.handleReject)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.COMPLETE:
                (0, proposal_js_1.handleComplete)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.DISPUTE:
                (0, proposal_js_1.handleDispute)(this, ws, msg);
                break;
            // Agentcourt dispute messages
            case types_js_1.ClientMessageType.DISPUTE_INTENT:
                (0, disputes_js_2.handleDisputeIntent)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.DISPUTE_REVEAL:
                (0, disputes_js_2.handleDisputeReveal)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.EVIDENCE:
                (0, disputes_js_2.handleEvidence)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ARBITER_ACCEPT:
                (0, disputes_js_2.handleArbiterAccept)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ARBITER_DECLINE:
                (0, disputes_js_2.handleArbiterDecline)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ARBITER_VOTE:
                (0, disputes_js_2.handleArbiterVote)(this, ws, msg);
                break;
            // Skill discovery messages
            case types_js_1.ClientMessageType.REGISTER_SKILLS:
                (0, skills_js_1.handleRegisterSkills)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.SEARCH_SKILLS:
                (0, skills_js_1.handleSearchSkills)(this, ws, msg);
                break;
            // Presence messages
            case types_js_1.ClientMessageType.SET_PRESENCE:
                (0, presence_js_1.handleSetPresence)(this, ws, msg);
                break;
            // Identity verification messages
            case types_js_1.ClientMessageType.VERIFY_REQUEST:
                (0, identity_js_1.handleVerifyRequest)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.VERIFY_RESPONSE:
                (0, identity_js_1.handleVerifyResponse)(this, ws, msg);
                break;
            // Challenge-response auth
            case types_js_1.ClientMessageType.VERIFY_IDENTITY:
                (0, identity_js_1.handleVerifyIdentity)(this, ws, msg);
                break;
            // Nick
            case types_js_1.ClientMessageType.SET_NICK:
                (0, nick_js_1.handleSetNick)(this, ws, msg);
                break;
            // Admin messages
            case types_js_1.ClientMessageType.ADMIN_APPROVE:
                (0, admin_js_1.handleAdminApprove)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ADMIN_REVOKE:
                (0, admin_js_1.handleAdminRevoke)(this, ws, msg);
                break;
            case types_js_1.ClientMessageType.ADMIN_LIST:
                (0, admin_js_1.handleAdminList)(this, ws, msg);
                break;
            // Typing indicator
            case types_js_1.ClientMessageType.TYPING: {
                var typingAgent = this.agents.get(ws);
                if (!typingAgent || !msg.channel)
                    break;
                var typingChannel = this.channels.get(msg.channel);
                if (!typingChannel)
                    break;
                var typingMsg = (0, protocol_js_1.createMessage)(types_js_1.ServerMessageType.TYPING, {
                    from: "@".concat(typingAgent.id),
                    from_name: typingAgent.name,
                    channel: msg.channel
                });
                for (var _i = 0, _a = typingChannel.agents; _i < _a.length; _i++) {
                    var memberWs = _a[_i];
                    if (memberWs !== ws)
                        this._send(memberWs, typingMsg);
                }
                break;
            }
        }
    };
    AgentChatServer.prototype._handleDisconnect = function (ws) {
        var agent = this.agents.get(ws);
        if (!agent)
            return;
        // Calculate connection duration
        var duration = ws._connectedAt ? Math.round((Date.now() - ws._connectedAt) / 1000) : 0;
        var channelCount = agent.channels.size;
        this._log('disconnect', {
            agent: agent.id,
            duration_sec: duration,
            channels_joined: channelCount,
            had_pubkey: !!agent.pubkey,
            ip: ws._realIp
        });
        // Leave all channels
        for (var _i = 0, _a = agent.channels; _i < _a.length; _i++) {
            var channelName = _a[_i];
            var channel = this.channels.get(channelName);
            if (channel) {
                channel.agents.delete(ws);
                this._broadcast(channelName, (0, protocol_js_1.createMessage)(types_js_1.ServerMessageType.AGENT_LEFT, {
                    channel: channelName,
                    agent: "@".concat(agent.id)
                }));
            }
        }
        // Remove from state
        this.agentById.delete(agent.id);
        this.agents.delete(ws);
        this.lastMessageTime.delete(ws);
    };
    return AgentChatServer;
}());
exports.AgentChatServer = AgentChatServer;
// Allow running directly
function startServer(options) {
    if (options === void 0) { options = {}; }
    // Support environment variable overrides (for Docker)
    var config = {
        port: parseInt(String(options.port || process.env.PORT || 6667)),
        host: options.host || process.env.HOST || '0.0.0.0',
        name: options.name || process.env.SERVER_NAME || 'agentchat',
        logMessages: options.logMessages || process.env.LOG_MESSAGES === 'true',
        cert: options.cert || process.env.TLS_CERT || null,
        key: options.key || process.env.TLS_KEY || null,
        rateLimitMs: options.rateLimitMs || parseInt(process.env.RATE_LIMIT_MS || '1000'),
        messageBufferSize: options.messageBufferSize || parseInt(process.env.MESSAGE_BUFFER_SIZE || '200')
    };
    var server = new AgentChatServer(config);
    server.start();
    var protocol = (config.cert && config.key) ? 'wss' : 'ws';
    console.log("AgentChat server running on ".concat(protocol, "://").concat(server.host, ":").concat(server.port));
    console.log('Default channels: #general, #engineering, #pull-requests, #help, #love, #agents, #discovery');
    if (config.cert && config.key) {
        console.log('TLS enabled');
    }
    console.log('Press Ctrl+C to stop');
    process.on('SIGINT', function () {
        server.stop();
        process.exit(0);
    });
    return server;
}
// Re-export EscrowEvent for consumers
var escrow_hooks_js_2 = require("./escrow-hooks.js");
Object.defineProperty(exports, "EscrowEvent", { enumerable: true, get: function () { return escrow_hooks_js_2.EscrowEvent; } });
