"use strict";
/**
 * Admin Handlers
 * Handles allowlist administration commands
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAdminApprove = handleAdminApprove;
exports.handleAdminRevoke = handleAdminRevoke;
exports.handleAdminList = handleAdminList;
var protocol_js_1 = require("../../protocol.js");
/**
 * Handle ADMIN_APPROVE command - add a pubkey to the allowlist
 */
function handleAdminApprove(server, ws, msg) {
    if (!server.allowlist) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Allowlist not configured'));
        return;
    }
    if (!msg.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Missing pubkey'));
        return;
    }
    var result = server.allowlist.approve(msg.pubkey, msg.admin_key, msg.note || '');
    if (!result.success) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, result.error));
        return;
    }
    server._log('admin_approve', { agentId: result.agentId });
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ADMIN_RESULT, {
        action: 'approve',
        success: true,
        agentId: "@".concat(result.agentId),
    }));
}
/**
 * Handle ADMIN_REVOKE command - remove a pubkey from the allowlist
 */
function handleAdminRevoke(server, ws, msg) {
    if (!server.allowlist) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Allowlist not configured'));
        return;
    }
    var identifier = msg.pubkey || msg.agent_id;
    if (!identifier) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Missing pubkey or agent_id'));
        return;
    }
    var result = server.allowlist.revoke(identifier, msg.admin_key);
    if (!result.success) {
        var code = result.error === 'invalid admin key' ? protocol_js_1.ErrorCode.AUTH_REQUIRED : protocol_js_1.ErrorCode.AGENT_NOT_FOUND;
        server._send(ws, (0, protocol_js_1.createError)(code, result.error));
        return;
    }
    server._log('admin_revoke', { identifier: identifier });
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ADMIN_RESULT, {
        action: 'revoke',
        success: true,
    }));
}
/**
 * Handle ADMIN_LIST command - list all approved entries
 */
function handleAdminList(server, ws, msg) {
    if (!server.allowlist) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.INVALID_MSG, 'Allowlist not configured'));
        return;
    }
    // Validate admin key
    if (!server.allowlist._validateAdminKey(msg.admin_key)) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Invalid admin key'));
        return;
    }
    var entries = server.allowlist.list();
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.ADMIN_RESULT, {
        action: 'list',
        entries: entries,
        enabled: server.allowlist.enabled,
        strict: server.allowlist.strict,
    }));
}
