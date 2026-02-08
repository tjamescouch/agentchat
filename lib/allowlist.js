"use strict";
/**
 * Allowlist Module
 * Controls which public keys can connect to the server.
 * Opt-in via ALLOWLIST_ENABLED=true env var.
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
exports.Allowlist = void 0;
var crypto_1 = require("crypto");
var fs_1 = require("fs");
var path_1 = require("path");
var protocol_js_1 = require("./protocol.js");
var Allowlist = /** @class */ (function () {
    function Allowlist(options) {
        if (options === void 0) { options = {}; }
        this.enabled = options.enabled || false;
        this.strict = options.strict || false;
        this.adminKey = options.adminKey || null;
        this.filePath = options.filePath || path_1.default.join(process.cwd(), 'allowlist.json');
        this.entries = new Map();
        if (this.enabled) {
            this._load();
        }
    }
    /**
     * Check if a pubkey is allowed to connect.
     */
    Allowlist.prototype.check = function (pubkey) {
        if (!this.enabled) {
            return { allowed: true, reason: 'allowlist disabled' };
        }
        if (!pubkey) {
            if (this.strict) {
                return { allowed: false, reason: 'ephemeral connections blocked in strict mode' };
            }
            return { allowed: true, reason: 'ephemeral allowed (non-strict mode)' };
        }
        if (this.entries.has(pubkey)) {
            return { allowed: true, reason: 'pubkey approved' };
        }
        return { allowed: false, reason: 'pubkey not in allowlist' };
    };
    /**
     * Approve a pubkey for connection.
     * Requires valid admin key.
     */
    Allowlist.prototype.approve = function (pubkey, adminKey, note) {
        if (note === void 0) { note = ''; }
        if (!this._validateAdminKey(adminKey)) {
            return { success: false, error: 'invalid admin key' };
        }
        var agentId = (0, protocol_js_1.pubkeyToAgentId)(pubkey);
        this.entries.set(pubkey, {
            agentId: agentId,
            approvedAt: new Date().toISOString(),
            approvedBy: 'admin',
            note: note,
        });
        this._save();
        return { success: true, agentId: agentId };
    };
    /**
     * Revoke a pubkey from the allowlist.
     * Can revoke by pubkey or agentId.
     */
    Allowlist.prototype.revoke = function (identifier, adminKey) {
        if (!this._validateAdminKey(adminKey)) {
            return { success: false, error: 'invalid admin key' };
        }
        // Try by pubkey first
        if (this.entries.has(identifier)) {
            this.entries.delete(identifier);
            this._save();
            return { success: true };
        }
        // Try by agentId
        for (var _i = 0, _a = this.entries; _i < _a.length; _i++) {
            var _b = _a[_i], pubkey = _b[0], entry = _b[1];
            if (entry.agentId === identifier) {
                this.entries.delete(pubkey);
                this._save();
                return { success: true };
            }
        }
        return { success: false, error: 'not found' };
    };
    /**
     * List all approved entries.
     */
    Allowlist.prototype.list = function () {
        var result = [];
        for (var _i = 0, _a = this.entries; _i < _a.length; _i++) {
            var _b = _a[_i], pubkey = _b[0], entry = _b[1];
            result.push({
                agentId: "@".concat(entry.agentId),
                pubkeyPrefix: pubkey.slice(0, 40) + '...',
                approvedAt: entry.approvedAt,
                note: entry.note,
            });
        }
        return result;
    };
    /**
     * Validate admin key using timing-safe comparison.
     * Hash both values first to ensure equal length (avoids length timing oracle).
     */
    Allowlist.prototype._validateAdminKey = function (key) {
        if (!this.adminKey || !key)
            return false;
        if (typeof key !== 'string')
            return false;
        var a = crypto_1.default.createHash('sha256').update(this.adminKey).digest();
        var b = crypto_1.default.createHash('sha256').update(key).digest();
        return crypto_1.default.timingSafeEqual(a, b);
    };
    /**
     * Load allowlist from disk.
     */
    Allowlist.prototype._load = function () {
        try {
            if (fs_1.default.existsSync(this.filePath)) {
                var data = JSON.parse(fs_1.default.readFileSync(this.filePath, 'utf8'));
                for (var _i = 0, data_1 = data; _i < data_1.length; _i++) {
                    var entry = data_1[_i];
                    this.entries.set(entry.pubkey, {
                        agentId: entry.agentId,
                        approvedAt: entry.approvedAt,
                        approvedBy: entry.approvedBy || 'admin',
                        note: entry.note || '',
                    });
                }
            }
        }
        catch (err) {
            console.error("Failed to load allowlist from ".concat(this.filePath, ": ").concat(err.message));
        }
    };
    /**
     * Save allowlist to disk.
     */
    Allowlist.prototype._save = function () {
        try {
            var data = [];
            for (var _i = 0, _a = this.entries; _i < _a.length; _i++) {
                var _b = _a[_i], pubkey = _b[0], entry = _b[1];
                data.push(__assign({ pubkey: pubkey }, entry));
            }
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        }
        catch (err) {
            console.error("Failed to save allowlist to ".concat(this.filePath, ": ").concat(err.message));
        }
    };
    return Allowlist;
}());
exports.Allowlist = Allowlist;
