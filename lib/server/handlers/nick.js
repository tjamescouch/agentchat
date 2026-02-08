"use strict";
/**
 * Nick Handler
 * Handles SET_NICK command — allows agents to change their display name
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSetNick = handleSetNick;
var protocol_js_1 = require("../../protocol.js");
// Reserved nicks that cannot be claimed
var RESERVED_NICKS = new Set([
    'server', 'admin', 'system', 'root', 'moderator', 'mod',
    'bot', 'agentchat', 'operator', 'shadow',
]);
// Rate limit: one nick change per 30 seconds
var NICK_RATE_LIMIT_MS = 30000;
/**
 * Handle SET_NICK command
 */
function handleSetNick(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var nick = msg.nick.trim();
    // Check reserved nicks
    if (RESERVED_NICKS.has(nick.toLowerCase())) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_NAME, "Nick \"".concat(nick, "\" is reserved")));
        return;
    }
    // Rate limit
    var now = Date.now();
    if (ws._lastNickChange && (now - ws._lastNickChange) < NICK_RATE_LIMIT_MS) {
        var waitSec = Math.ceil((NICK_RATE_LIMIT_MS - (now - ws._lastNickChange)) / 1000);
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.RATE_LIMITED, "Nick change rate limited. Try again in ".concat(waitSec, "s")));
        return;
    }
    var oldNick = agent.name || "anon_".concat(agent.id);
    // Update name
    agent.name = nick;
    ws._lastNickChange = now;
    server._log('nick_change', { agent: agent.id, old: oldNick, new: nick });
    // Broadcast NICK_CHANGED to all channels the agent is in
    var notification = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.NICK_CHANGED, {
        agent_id: "@".concat(agent.id),
        old_nick: oldNick,
        new_nick: nick,
    });
    for (var _i = 0, _a = agent.channels; _i < _a.length; _i++) {
        var channelName = _a[_i];
        server._broadcast(channelName, notification);
    }
    // Confirm to the sender
    server._send(ws, notification);
}
