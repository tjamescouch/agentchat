"use strict";
/**
 * Presence Handlers
 * Handles presence status updates
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSetPresence = handleSetPresence;
var protocol_js_1 = require("../../protocol.js");
/**
 * Handle SET_PRESENCE command
 */
function handleSetPresence(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    var oldPresence = agent.presence;
    agent.presence = msg.status;
    agent.status_text = msg.status_text || null;
    server._log('presence_changed', {
        agent: agent.id,
        from: oldPresence,
        to: msg.status,
        statusText: agent.status_text
    });
    // Broadcast presence change to all channels the agent is in
    var presenceMsg = (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.PRESENCE_CHANGED, {
        agent_id: "@".concat(agent.id),
        name: agent.name,
        presence: agent.presence,
        status_text: agent.status_text
    });
    for (var _i = 0, _a = agent.channels; _i < _a.length; _i++) {
        var channelName = _a[_i];
        server._broadcast(channelName, presenceMsg);
    }
}
