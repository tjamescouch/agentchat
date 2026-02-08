"use strict";
/**
 * Message Handlers
 * Handles message routing, join, leave, and channel operations
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
exports.handleMsg = handleMsg;
exports.handleJoin = handleJoin;
exports.handleLeave = handleLeave;
exports.handleListChannels = handleListChannels;
exports.handleListAgents = handleListAgents;
exports.handleCreateChannel = handleCreateChannel;
exports.handleInvite = handleInvite;
var protocol_js_1 = require("../../protocol.js");
/**
 * Handle MSG command - route messages to channels or agents
 */
function handleMsg(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    // Rate limiting: 1 message per second per agent
    var now = Date.now();
    var lastTime = server.lastMessageTime.get(ws) || 0;
    if (now - lastTime < server.rateLimitMs) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.RATE_LIMITED, 'Rate limit exceeded (max 1 message per second)'));
        return;
    }
    server.lastMessageTime.set(ws, now);
    // Redact secrets from message content (agentseenoevil)
    var redactResult = server.redactor.redact(msg.content);
    if (redactResult.count > 0) {
        server._log('secrets_redacted', {
            agent: agent.id,
            matched: redactResult.matched,
            count: redactResult.count,
        });
    }
    var outMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, __assign({ from: "@".concat(agent.id), from_name: agent.name, to: msg.to, content: redactResult.text }, (msg.sig && { sig: msg.sig })));
    if ((0, protocol_js_1.isChannel)(msg.to)) {
        // Channel message
        var channel = server.channels.get(msg.to);
        if (!channel) {
            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.CHANNEL_NOT_FOUND, "Channel ".concat(msg.to, " not found")));
            return;
        }
        if (!agent.channels.has(msg.to)) {
            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NOT_INVITED, "Not a member of ".concat(msg.to)));
            return;
        }
        // Broadcast to channel including sender
        server._broadcast(msg.to, outMsg);
        // Buffer the message for replay to future joiners
        server._bufferMessage(msg.to, outMsg);
        // Update channel activity timestamp (for idle detection)
        server.channelLastActivity.set(msg.to, Date.now());
    }
    else if ((0, protocol_js_1.isAgent)(msg.to)) {
        // Direct message
        var targetId = msg.to.slice(1);
        var targetWs = server.agentById.get(targetId);
        if (!targetWs) {
            server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AGENT_NOT_FOUND, "Agent ".concat(msg.to, " not found")));
            return;
        }
        // Send to target
        server._send(targetWs, outMsg);
        // Echo back to sender
        server._send(ws, outMsg);
    }
}
/**
 * Handle JOIN command - add agent to channel
 */
function handleJoin(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var channel = server.channels.get(msg.channel);
    if (!channel) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.CHANNEL_NOT_FOUND, "Channel ".concat(msg.channel, " not found")));
        return;
    }
    // Check invite-only
    if (channel.inviteOnly && !channel.invited.has(agent.id)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NOT_INVITED, "Channel ".concat(msg.channel, " is invite-only")));
        return;
    }
    // Check if this is a rejoin (agent already in channel)
    var isRejoin = channel.agents.has(ws);
    // Add to channel (idempotent for Sets)
    channel.agents.add(ws);
    agent.channels.add(msg.channel);
    server._log('join', { agent: agent.id, channel: msg.channel, rejoin: isRejoin });
    if (!isRejoin) {
        // Notify others (only on first join, not rejoin)
        server._broadcast(msg.channel, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.AGENT_JOINED, {
            channel: msg.channel,
            agent: "@".concat(agent.id),
            name: agent.name,
            verified: !!agent.verified
        }), ws);
    }
    // Send confirmation with agent list (always, even on rejoin)
    var agentList = [];
    for (var _i = 0, _a = channel.agents; _i < _a.length; _i++) {
        var memberWs = _a[_i];
        var member = server.agents.get(memberWs);
        if (member)
            agentList.push({ id: "@".concat(member.id), name: member.name, verified: !!member.verified });
    }
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.JOINED, {
        channel: msg.channel,
        agents: agentList
    }));
    // Replay recent messages (always, even on rejoin — this is how agents catch up)
    server._replayMessages(ws, msg.channel);
    if (!isRejoin) {
        // Send welcome prompt to the new joiner (only on first join)
        server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
            from: '@server',
            from_name: 'Server',
            to: msg.channel,
            content: "Welcome to ".concat(msg.channel, ", ").concat(agent.name, " (@").concat(agent.id, ")! Say hello to introduce yourself and start collaborating with other agents.")
        }));
        // Prompt existing agents to engage with the new joiner (if there are others)
        var otherAgents = [];
        for (var _b = 0, _c = channel.agents; _b < _c.length; _b++) {
            var memberWs = _c[_b];
            if (memberWs !== ws) {
                var member = server.agents.get(memberWs);
                if (member)
                    otherAgents.push({ ws: memberWs, id: member.id, name: member.name });
            }
        }
        if (otherAgents.length > 0) {
            var welcomePrompt = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
                from: '@server',
                from_name: 'Server',
                to: msg.channel,
                content: "Hey ".concat(otherAgents.map(function (a) { return "".concat(a.name, " (@").concat(a.id, ")"); }).join(', '), " - new agent ").concat(agent.name, " (@").concat(agent.id, ") just joined! Say hi and share what you're working on.")
            });
            for (var _d = 0, otherAgents_1 = otherAgents; _d < otherAgents_1.length; _d++) {
                var other = otherAgents_1[_d];
                server._send(other.ws, welcomePrompt);
            }
        }
    }
    // Update channel activity
    server.channelLastActivity.set(msg.channel, Date.now());
}
/**
 * Handle LEAVE command - remove agent from channel
 */
function handleLeave(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var channel = server.channels.get(msg.channel);
    if (!channel)
        return;
    channel.agents.delete(ws);
    agent.channels.delete(msg.channel);
    server._log('leave', { agent: agent.id, channel: msg.channel });
    // Notify others
    server._broadcast(msg.channel, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.AGENT_LEFT, {
        channel: msg.channel,
        agent: "@".concat(agent.id),
        name: agent.name
    }));
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.LEFT, {
        channel: msg.channel
    }));
}
/**
 * Handle LIST_CHANNELS command
 * Unauthenticated: returns channel names and agent count only
 * Authenticated: returns full details
 */
function handleListChannels(server, ws) {
    var list = [];
    for (var _i = 0, _a = server.channels; _i < _a.length; _i++) {
        var _b = _a[_i], name_1 = _b[0], channel = _b[1];
        if (!channel.inviteOnly) {
            list.push({
                name: name_1,
                agents: channel.agents.size
            });
        }
    }
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.CHANNELS, { list: list }));
}
/**
 * Handle LIST_AGENTS command
 * Requires authentication to see agent details
 */
function handleListAgents(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var channel = server.channels.get(msg.channel);
    if (!channel) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.CHANNEL_NOT_FOUND, "Channel ".concat(msg.channel, " not found")));
        return;
    }
    var list = [];
    for (var _i = 0, _a = channel.agents; _i < _a.length; _i++) {
        var memberWs = _a[_i];
        var member = server.agents.get(memberWs);
        if (member) {
            list.push({
                id: "@".concat(member.id),
                name: member.name,
                presence: member.presence || 'online',
                status_text: member.status_text || null,
                verified: !!member.verified
            });
        }
    }
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.AGENTS, {
        channel: msg.channel,
        list: list
    }));
}
/**
 * Handle CREATE_CHANNEL command
 */
function handleCreateChannel(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    if (server.channels.has(msg.channel)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.CHANNEL_EXISTS, "Channel ".concat(msg.channel, " already exists")));
        return;
    }
    var channel = server._createChannel(msg.channel, msg.invite_only || false);
    // Creator is automatically invited and joined
    if (channel.inviteOnly) {
        channel.invited.add(agent.id);
    }
    server._log('create_channel', { agent: agent.id, channel: msg.channel, inviteOnly: channel.inviteOnly });
    // Auto-join creator
    channel.agents.add(ws);
    agent.channels.add(msg.channel);
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.JOINED, {
        channel: msg.channel,
        agents: ["@".concat(agent.id)]
    }));
}
/**
 * Handle INVITE command
 */
function handleInvite(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var channel = server.channels.get(msg.channel);
    if (!channel) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.CHANNEL_NOT_FOUND, "Channel ".concat(msg.channel, " not found")));
        return;
    }
    // Must be a member to invite
    if (!agent.channels.has(msg.channel)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.NOT_INVITED, "Not a member of ".concat(msg.channel)));
        return;
    }
    var targetId = msg.agent.slice(1);
    channel.invited.add(targetId);
    server._log('invite', { agent: agent.id, target: targetId, channel: msg.channel });
    // Notify target if connected
    var targetWs = server.agentById.get(targetId);
    if (targetWs) {
        server._send(targetWs, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
            from: "@".concat(agent.id),
            from_name: agent.name,
            to: msg.agent,
            content: "You have been invited to ".concat(msg.channel)
        }));
    }
}
