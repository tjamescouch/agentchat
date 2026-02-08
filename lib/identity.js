"use strict";
/**
 * AgentChat Identity Module
 * Ed25519 key generation, storage, and signing
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Identity = exports.DEFAULT_IDENTITY_PATH = void 0;
exports.pubkeyToAgentId = pubkeyToAgentId;
exports.isValidPubkey = isValidPubkey;
var crypto_1 = require("crypto");
var promises_1 = require("fs/promises");
var path_1 = require("path");
// Default identity file location
exports.DEFAULT_IDENTITY_PATH = path_1.default.join(process.cwd(), '.agentchat', 'identity.json');
/**
 * Generate stable agent ID from pubkey
 * Returns first 8 chars of SHA256 hash (hex)
 */
function pubkeyToAgentId(pubkey) {
    var hash = crypto_1.default.createHash('sha256').update(pubkey).digest('hex');
    return hash.substring(0, 8);
}
/**
 * Validate Ed25519 public key in PEM format
 */
function isValidPubkey(pubkey) {
    if (!pubkey || typeof pubkey !== 'string')
        return false;
    try {
        var keyObj = crypto_1.default.createPublicKey(pubkey);
        return keyObj.asymmetricKeyType === 'ed25519';
    }
    catch (_a) {
        return false;
    }
}
/**
 * AgentChat Identity
 * Represents an agent's Ed25519 keypair and associated metadata
 */
var Identity = /** @class */ (function () {
    function Identity(data) {
        // Lazy-load crypto key objects
        this._publicKey = null;
        this._privateKey = null;
        this.name = data.name;
        this.pubkey = data.pubkey;
        this.privkey = data.privkey || null;
        this.created = data.created;
        this.rotations = data.rotations || [];
    }
    /**
     * Generate new Ed25519 keypair
     */
    Identity.generate = function (name) {
        var _a = crypto_1.default.generateKeyPairSync('ed25519'), publicKey = _a.publicKey, privateKey = _a.privateKey;
        return new Identity({
            name: name,
            pubkey: publicKey.export({ type: 'spki', format: 'pem' }),
            privkey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
            created: new Date().toISOString()
        });
    };
    /**
     * Load identity from JSON file
     */
    Identity.load = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var data, parsed;
            if (filePath === void 0) { filePath = exports.DEFAULT_IDENTITY_PATH; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, promises_1.default.readFile(filePath, 'utf-8')];
                    case 1:
                        data = _a.sent();
                        parsed = JSON.parse(data);
                        // Handle both old format (publicKey/privateKey) and new format (pubkey/privkey)
                        return [2 /*return*/, new Identity({
                                name: parsed.name,
                                pubkey: parsed.pubkey || parsed.publicKey,
                                privkey: parsed.privkey || parsed.privateKey,
                                created: parsed.created,
                                rotations: parsed.rotations
                            })];
                }
            });
        });
    };
    /**
     * Save identity to JSON file
     */
    Identity.prototype.save = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var dir, data;
            if (filePath === void 0) { filePath = exports.DEFAULT_IDENTITY_PATH; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        dir = path_1.default.dirname(filePath);
                        return [4 /*yield*/, promises_1.default.mkdir(dir, { recursive: true })];
                    case 1:
                        _a.sent();
                        data = {
                            publicKey: this.pubkey,
                            privateKey: this.privkey || '',
                            agentId: this.getAgentId(),
                            name: this.name,
                            created: this.created,
                            rotations: this.rotations.length > 0 ? this.rotations : undefined
                        };
                        return [4 /*yield*/, promises_1.default.writeFile(filePath, JSON.stringify(data, null, 2), {
                                mode: 384 // Owner read/write only
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if identity file exists
     */
    Identity.exists = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var _a;
            if (filePath === void 0) { filePath = exports.DEFAULT_IDENTITY_PATH; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, promises_1.default.access(filePath)];
                    case 1:
                        _b.sent();
                        return [2 /*return*/, true];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get fingerprint (first 16 chars of SHA256 hash of pubkey)
     */
    Identity.prototype.getFingerprint = function () {
        var hash = crypto_1.default.createHash('sha256').update(this.pubkey).digest('hex');
        return hash.substring(0, 16);
    };
    /**
     * Get stable agent ID (first 8 chars of fingerprint)
     */
    Identity.prototype.getAgentId = function () {
        return pubkeyToAgentId(this.pubkey);
    };
    /**
     * Sign data with private key
     * Returns base64-encoded signature
     */
    Identity.prototype.sign = function (data) {
        if (!this.privkey) {
            throw new Error('Private key not available (identity was loaded from export)');
        }
        if (!this._privateKey) {
            this._privateKey = crypto_1.default.createPrivateKey(this.privkey);
        }
        var buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        var signature = crypto_1.default.sign(null, buffer, this._privateKey);
        return signature.toString('base64');
    };
    /**
     * Verify a signature
     * Static method for verifying any message
     */
    Identity.verify = function (data, signature, pubkey) {
        try {
            var keyObj = crypto_1.default.createPublicKey(pubkey);
            var buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            var sigBuffer = Buffer.from(signature, 'base64');
            return crypto_1.default.verify(null, buffer, keyObj, sigBuffer);
        }
        catch (_a) {
            return false;
        }
    };
    /**
     * Export for sharing (pubkey only, no private key)
     */
    Identity.prototype.export = function () {
        return {
            name: this.name,
            pubkey: this.pubkey,
            created: this.created,
            rotations: this.rotations
        };
    };
    /**
     * Rotate to a new keypair
     * Signs the new public key with the old private key for chain of custody
     * @returns Rotation record with old_pubkey, new_pubkey, signature, timestamp
     */
    Identity.prototype.rotate = function () {
        if (!this.privkey) {
            throw new Error('Private key not available - cannot rotate');
        }
        // Generate new keypair
        var _a = crypto_1.default.generateKeyPairSync('ed25519'), publicKey = _a.publicKey, privateKey = _a.privateKey;
        var newPubkey = publicKey.export({ type: 'spki', format: 'pem' });
        var newPrivkey = privateKey.export({ type: 'pkcs8', format: 'pem' });
        // Use same timestamp for both signing and record
        var timestamp = new Date().toISOString();
        // Create rotation record content to sign
        var rotationContent = JSON.stringify({
            old_pubkey: this.pubkey,
            new_pubkey: newPubkey,
            timestamp: timestamp
        });
        // Sign with old private key
        var signature = this.sign(rotationContent);
        // Create rotation record
        var rotationRecord = {
            old_pubkey: this.pubkey,
            old_agent_id: this.getAgentId(),
            new_pubkey: newPubkey,
            new_agent_id: pubkeyToAgentId(newPubkey),
            signature: signature,
            timestamp: timestamp
        };
        // Update identity with new keys
        this.rotations.push(rotationRecord);
        this.pubkey = newPubkey;
        this.privkey = newPrivkey;
        this._publicKey = null;
        this._privateKey = null;
        return rotationRecord;
    };
    /**
     * Verify a rotation record
     * Checks that the signature is valid using the old public key
     */
    Identity.verifyRotation = function (record) {
        try {
            var rotationContent = JSON.stringify({
                old_pubkey: record.old_pubkey,
                new_pubkey: record.new_pubkey,
                timestamp: record.timestamp
            });
            return Identity.verify(rotationContent, record.signature, record.old_pubkey);
        }
        catch (_a) {
            return false;
        }
    };
    /**
     * Verify the entire rotation chain
     */
    Identity.prototype.verifyRotationChain = function () {
        var errors = [];
        if (this.rotations.length === 0) {
            return { valid: true, errors: [] };
        }
        // Verify each rotation in sequence
        for (var i = 0; i < this.rotations.length; i++) {
            var record = this.rotations[i];
            // Verify signature
            if (!Identity.verifyRotation(record)) {
                errors.push("Rotation ".concat(i + 1, ": Invalid signature"));
                continue;
            }
            // Verify chain continuity (each new_pubkey should match next old_pubkey)
            if (i < this.rotations.length - 1) {
                var nextRecord = this.rotations[i + 1];
                if (record.new_pubkey !== nextRecord.old_pubkey) {
                    errors.push("Rotation ".concat(i + 1, ": Chain break - new_pubkey doesn't match next old_pubkey"));
                }
            }
        }
        // Verify final pubkey matches current identity
        var lastRotation = this.rotations[this.rotations.length - 1];
        if (lastRotation.new_pubkey !== this.pubkey) {
            errors.push('Final rotation new_pubkey does not match current identity pubkey');
        }
        return {
            valid: errors.length === 0,
            errors: errors
        };
    };
    /**
     * Get the original (genesis) public key before any rotations
     */
    Identity.prototype.getOriginalPubkey = function () {
        if (this.rotations.length === 0) {
            return this.pubkey;
        }
        return this.rotations[0].old_pubkey;
    };
    /**
     * Get the original (genesis) agent ID
     */
    Identity.prototype.getOriginalAgentId = function () {
        return pubkeyToAgentId(this.getOriginalPubkey());
    };
    /**
     * Generate a signed revocation notice for this identity
     * A revocation notice declares that the key should no longer be trusted
     */
    Identity.prototype.revoke = function (reason) {
        if (reason === void 0) { reason = 'revoked'; }
        if (!this.privkey) {
            throw new Error('Private key not available - cannot create revocation notice');
        }
        var timestamp = new Date().toISOString();
        // Create revocation content to sign
        var revocationContent = JSON.stringify({
            type: 'REVOCATION',
            pubkey: this.pubkey,
            agent_id: this.getAgentId(),
            reason: reason,
            timestamp: timestamp
        });
        // Sign with the key being revoked (proves ownership)
        var signature = this.sign(revocationContent);
        var notice = {
            type: 'REVOCATION',
            pubkey: this.pubkey,
            agent_id: this.getAgentId(),
            fingerprint: this.getFingerprint(),
            reason: reason,
            timestamp: timestamp,
            signature: signature,
            rotations: this.rotations.length > 0 ? this.rotations : undefined,
            original_agent_id: this.rotations.length > 0 ? this.getOriginalAgentId() : undefined
        };
        return notice;
    };
    /**
     * Verify a revocation notice
     * Checks that the signature is valid using the pubkey in the notice
     */
    Identity.verifyRevocation = function (notice) {
        if (!notice || notice.type !== 'REVOCATION') {
            return false;
        }
        try {
            var revocationContent = JSON.stringify({
                type: 'REVOCATION',
                pubkey: notice.pubkey,
                agent_id: notice.agent_id,
                reason: notice.reason,
                timestamp: notice.timestamp
            });
            return Identity.verify(revocationContent, notice.signature, notice.pubkey);
        }
        catch (_a) {
            return false;
        }
    };
    /**
     * Check if a pubkey has been revoked by checking against a revocation notice
     */
    Identity.isRevoked = function (pubkey, notice) {
        if (!Identity.verifyRevocation(notice)) {
            return false;
        }
        return notice.pubkey === pubkey;
    };
    return Identity;
}());
exports.Identity = Identity;
