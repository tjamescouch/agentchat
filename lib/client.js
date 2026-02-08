"use strict";
/**
 * AgentChat Client
 * Connect to agentchat servers from Node.js or CLI
 */
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceDirectorySafety = exports.checkDirectorySafety = exports.AgentChatClient = void 0;
exports.quickSend = quickSend;
exports.listen = listen;
var ws_1 = require("ws");
var events_1 = require("events");
var types_js_1 = require("./types.js");
var protocol_js_1 = require("./protocol.js");
var identity_js_1 = require("./identity.js");
var proposals_js_1 = require("./proposals.js");
// ============ AgentChatClient Class ============
var AgentChatClient = /** @class */ (function (_super) {
    __extends(AgentChatClient, _super);
    function AgentChatClient(options) {
        var _this = _super.call(this) || this;
        _this.server = options.server;
        _this.name = options.name || "agent-".concat(Date.now());
        _this.pubkey = options.pubkey || null;
        // Identity support
        _this.identityPath = options.identity || null;
        _this._identity = null;
        _this.ws = null;
        _this.agentId = null;
        _this.connected = false;
        _this.channels = new Set();
        _this._pendingRequests = new Map();
        _this._requestId = 0;
        _this._autoVerifyHandler = null;
        return _this;
    }
    /**
     * Load identity from file, or create new one if it doesn't exist
     */
    AgentChatClient.prototype._loadIdentity = function () {
        return __awaiter(this, void 0, void 0, function () {
            var exists, _a, err_1, error;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.identityPath) return [3 /*break*/, 8];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, , 8]);
                        return [4 /*yield*/, identity_js_1.Identity.exists(this.identityPath)];
                    case 2:
                        exists = _b.sent();
                        if (!exists) return [3 /*break*/, 4];
                        _a = this;
                        return [4 /*yield*/, identity_js_1.Identity.load(this.identityPath)];
                    case 3:
                        _a._identity = _b.sent();
                        return [3 /*break*/, 6];
                    case 4:
                        // Generate new identity and save it
                        this._identity = identity_js_1.Identity.generate(this.name);
                        return [4 /*yield*/, this._identity.save(this.identityPath)];
                    case 5:
                        _b.sent();
                        _b.label = 6;
                    case 6:
                        this.name = this._identity.name || this.name;
                        this.pubkey = this._identity.pubkey;
                        return [3 /*break*/, 8];
                    case 7:
                        err_1 = _b.sent();
                        error = err_1;
                        throw new Error("Failed to load/create identity at ".concat(this.identityPath, ": ").concat(error.message));
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Connect to the server and identify
     *
     * For pubkey agents: IDENTIFY → CHALLENGE → VERIFY_IDENTITY → WELCOME
     * For ephemeral agents: IDENTIFY → WELCOME
     */
    AgentChatClient.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: 
                    // Load identity if path provided
                    return [4 /*yield*/, this._loadIdentity()];
                    case 1:
                        // Load identity if path provided
                        _a.sent();
                        return [2 /*return*/, new Promise(function (resolve, reject) {
                                _this.ws = new ws_1.default(_this.server);
                                _this.ws.on('open', function () {
                                    // Send identify
                                    _this._send({
                                        type: types_js_1.ClientMessageType.IDENTIFY,
                                        name: _this.name,
                                        pubkey: _this.pubkey
                                    });
                                });
                                _this.ws.on('message', function (data) {
                                    _this._handleMessage(data.toString());
                                });
                                _this.ws.on('close', function () {
                                    _this.connected = false;
                                    _this.emit('disconnect');
                                });
                                _this.ws.on('error', function (err) {
                                    _this.emit('error', err);
                                    if (!_this.connected) {
                                        reject(err);
                                    }
                                });
                                // Handle CHALLENGE (for pubkey agents)
                                _this.once('challenge', function (challenge) {
                                    if (!_this._identity || !_this._identity.privkey) {
                                        reject(new Error('Received challenge but no identity loaded for signing'));
                                        return;
                                    }
                                    var timestamp = Date.now();
                                    var signingContent = (0, protocol_js_1.generateAuthSigningContent)(challenge.nonce, challenge.challenge_id, timestamp);
                                    var signature = _this._identity.sign(signingContent);
                                    _this._send({
                                        type: types_js_1.ClientMessageType.VERIFY_IDENTITY,
                                        challenge_id: challenge.challenge_id,
                                        signature: signature,
                                        timestamp: timestamp
                                    });
                                });
                                // Wait for WELCOME
                                _this.once('welcome', function (info) {
                                    _this.connected = true;
                                    _this.agentId = info.agent_id;
                                    resolve(info);
                                });
                                // Handle connection error
                                _this.once('error', function (err) {
                                    if (!_this.connected) {
                                        reject(err);
                                    }
                                });
                            })];
                }
            });
        });
    };
    /**
     * Disconnect from server
     */
    AgentChatClient.prototype.disconnect = function () {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    };
    /**
     * Join a channel
     */
    AgentChatClient.prototype.join = function (channel) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                this._send({
                    type: types_js_1.ClientMessageType.JOIN,
                    channel: channel
                });
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var onJoined = function (msg) {
                            if (msg.channel === channel) {
                                _this.removeListener('error', onError);
                                _this.channels.add(channel);
                                resolve(msg);
                            }
                        };
                        var onError = function (msg) {
                            _this.removeListener('joined', onJoined);
                            reject(new Error(msg.message));
                        };
                        _this.once('joined', onJoined);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Leave a channel
     */
    AgentChatClient.prototype.leave = function (channel) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this._send({
                    type: types_js_1.ClientMessageType.LEAVE,
                    channel: channel
                });
                this.channels.delete(channel);
                return [2 /*return*/];
            });
        });
    };
    /**
     * Send a message to a channel or agent
     */
    AgentChatClient.prototype.send = function (to, content) {
        return __awaiter(this, void 0, void 0, function () {
            var msg, dataToSign;
            return __generator(this, function (_a) {
                msg = {
                    type: types_js_1.ClientMessageType.MSG,
                    to: to,
                    content: content
                };
                // Sign message if identity available
                if (this._identity && this._identity.privkey) {
                    msg.ts = Date.now();
                    dataToSign = JSON.stringify({
                        to: msg.to,
                        content: msg.content,
                        ts: msg.ts
                    });
                    msg.sig = this._identity.sign(dataToSign);
                }
                this._send(msg);
                return [2 /*return*/];
            });
        });
    };
    /**
     * Send a direct message (alias for send with @target)
     */
    AgentChatClient.prototype.dm = function (agent, content) {
        return __awaiter(this, void 0, void 0, function () {
            var target;
            return __generator(this, function (_a) {
                target = agent.startsWith('@') ? agent : "@".concat(agent);
                return [2 /*return*/, this.send(target, content)];
            });
        });
    };
    /**
     * List available channels
     */
    AgentChatClient.prototype.listChannels = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                this._send({
                    type: types_js_1.ClientMessageType.LIST_CHANNELS
                });
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.once('channels', function (msg) {
                            resolve(msg.list);
                        });
                    })];
            });
        });
    };
    /**
     * List agents in a channel
     */
    AgentChatClient.prototype.listAgents = function (channel) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                this._send({
                    type: types_js_1.ClientMessageType.LIST_AGENTS,
                    channel: channel
                });
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.once('agents', function (msg) {
                            resolve(msg.list);
                        });
                    })];
            });
        });
    };
    /**
     * Set a nickname
     */
    AgentChatClient.prototype.setNick = function (nick) {
        this._send({
            type: types_js_1.ClientMessageType.SET_NICK,
            nick: nick
        });
    };
    /**
     * Create a new channel
     */
    AgentChatClient.prototype.createChannel = function (channel_1) {
        return __awaiter(this, arguments, void 0, function (channel, inviteOnly) {
            var _this = this;
            if (inviteOnly === void 0) { inviteOnly = false; }
            return __generator(this, function (_a) {
                this._send({
                    type: types_js_1.ClientMessageType.CREATE_CHANNEL,
                    channel: channel,
                    invite_only: inviteOnly
                });
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var onJoined = function (msg) {
                            if (msg.channel === channel) {
                                _this.removeListener('error', onError);
                                _this.channels.add(channel);
                                resolve(msg);
                            }
                        };
                        var onError = function (msg) {
                            _this.removeListener('joined', onJoined);
                            reject(new Error(msg.message));
                        };
                        _this.once('joined', onJoined);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Invite an agent to a channel
     */
    AgentChatClient.prototype.invite = function (channel, agent) {
        return __awaiter(this, void 0, void 0, function () {
            var target;
            return __generator(this, function (_a) {
                target = agent.startsWith('@') ? agent : "@".concat(agent);
                this._send({
                    type: types_js_1.ClientMessageType.INVITE,
                    channel: channel,
                    agent: target
                });
                return [2 /*return*/];
            });
        });
    };
    /**
     * Send ping to server
     */
    AgentChatClient.prototype.ping = function () {
        this._send({ type: types_js_1.ClientMessageType.PING });
    };
    // ===== PROPOSAL/NEGOTIATION METHODS =====
    /**
     * Send a proposal to another agent
     * Requires persistent identity for signing
     */
    AgentChatClient.prototype.propose = function (to, proposal) {
        return __awaiter(this, void 0, void 0, function () {
            var target, proposalData, sigContent, msg;
            var _this = this;
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Proposals require persistent identity. Use --identity flag.');
                }
                target = to.startsWith('@') ? to : "@".concat(to);
                proposalData = {
                    to: target,
                    task: proposal.task,
                    amount: proposal.amount,
                    currency: proposal.currency,
                    payment_code: proposal.payment_code,
                    terms: proposal.terms,
                    expires: proposal.expires,
                    elo_stake: proposal.elo_stake
                };
                sigContent = (0, proposals_js_1.getProposalSigningContent)(proposalData);
                msg = __assign(__assign({ type: types_js_1.ClientMessageType.PROPOSAL }, proposalData), { sig: this._identity.sign(sigContent) });
                this._send(msg);
                // Wait for the proposal response with ID
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('proposal', onProposal);
                            _this.removeListener('error', onError);
                            reject(new Error('Proposal timeout'));
                        }, 10000);
                        var onProposal = function (p) {
                            if (p.to === target && p.from === _this.agentId) {
                                clearTimeout(timeout);
                                _this.removeListener('error', onError);
                                resolve(p);
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('proposal', onProposal);
                            reject(new Error(err.message));
                        };
                        _this.once('proposal', onProposal);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Accept a proposal
     */
    AgentChatClient.prototype.accept = function (proposalId_1) {
        return __awaiter(this, arguments, void 0, function (proposalId, payment_code, elo_stake) {
            var sigContent, sig, msg;
            var _this = this;
            if (payment_code === void 0) { payment_code = null; }
            if (elo_stake === void 0) { elo_stake = null; }
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Accepting proposals requires persistent identity.');
                }
                sigContent = (0, proposals_js_1.getAcceptSigningContent)(proposalId, payment_code || '', elo_stake || '');
                sig = this._identity.sign(sigContent);
                msg = {
                    type: types_js_1.ClientMessageType.ACCEPT,
                    proposal_id: proposalId,
                    payment_code: payment_code,
                    elo_stake: elo_stake,
                    sig: sig
                };
                this._send(msg);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('accept', onAccept);
                            _this.removeListener('error', onError);
                            reject(new Error('Accept timeout'));
                        }, 10000);
                        var onAccept = function (response) {
                            if (response.proposal_id === proposalId) {
                                clearTimeout(timeout);
                                _this.removeListener('error', onError);
                                resolve(response);
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('accept', onAccept);
                            reject(new Error(err.message));
                        };
                        _this.once('accept', onAccept);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Reject a proposal
     */
    AgentChatClient.prototype.reject = function (proposalId_1) {
        return __awaiter(this, arguments, void 0, function (proposalId, reason) {
            var sigContent, sig, msg;
            var _this = this;
            if (reason === void 0) { reason = null; }
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Rejecting proposals requires persistent identity.');
                }
                sigContent = (0, proposals_js_1.getRejectSigningContent)(proposalId, reason || '');
                sig = this._identity.sign(sigContent);
                msg = {
                    type: types_js_1.ClientMessageType.REJECT,
                    proposal_id: proposalId,
                    reason: reason,
                    sig: sig
                };
                this._send(msg);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('reject', onReject);
                            _this.removeListener('error', onError);
                            reject(new Error('Reject timeout'));
                        }, 10000);
                        var onReject = function (response) {
                            if (response.proposal_id === proposalId) {
                                clearTimeout(timeout);
                                _this.removeListener('error', onError);
                                resolve(response);
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('reject', onReject);
                            reject(new Error(err.message));
                        };
                        _this.once('reject', onReject);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Mark a proposal as complete
     */
    AgentChatClient.prototype.complete = function (proposalId_1) {
        return __awaiter(this, arguments, void 0, function (proposalId, proof) {
            var sigContent, sig, msg;
            var _this = this;
            if (proof === void 0) { proof = null; }
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Completing proposals requires persistent identity.');
                }
                sigContent = (0, proposals_js_1.getCompleteSigningContent)(proposalId, proof || '');
                sig = this._identity.sign(sigContent);
                msg = {
                    type: types_js_1.ClientMessageType.COMPLETE,
                    proposal_id: proposalId,
                    proof: proof,
                    sig: sig
                };
                this._send(msg);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('complete', onComplete);
                            _this.removeListener('error', onError);
                            reject(new Error('Complete timeout'));
                        }, 10000);
                        var onComplete = function (response) {
                            if (response.proposal_id === proposalId) {
                                clearTimeout(timeout);
                                _this.removeListener('error', onError);
                                resolve(response);
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('complete', onComplete);
                            reject(new Error(err.message));
                        };
                        _this.once('complete', onComplete);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Dispute a proposal
     */
    AgentChatClient.prototype.dispute = function (proposalId, reason) {
        return __awaiter(this, void 0, void 0, function () {
            var sigContent, sig, msg;
            var _this = this;
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Disputing proposals requires persistent identity.');
                }
                if (!reason) {
                    throw new Error('Dispute reason is required');
                }
                sigContent = (0, proposals_js_1.getDisputeSigningContent)(proposalId, reason);
                sig = this._identity.sign(sigContent);
                msg = {
                    type: types_js_1.ClientMessageType.DISPUTE,
                    proposal_id: proposalId,
                    reason: reason,
                    sig: sig
                };
                this._send(msg);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('dispute', onDispute);
                            _this.removeListener('error', onError);
                            reject(new Error('Dispute timeout'));
                        }, 10000);
                        var onDispute = function (response) {
                            if (response.proposal_id === proposalId) {
                                clearTimeout(timeout);
                                _this.removeListener('error', onError);
                                resolve(response);
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('dispute', onDispute);
                            reject(new Error(err.message));
                        };
                        _this.once('dispute', onDispute);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    // ===== IDENTITY VERIFICATION METHODS =====
    /**
     * Request identity verification from another agent
     * Sends a challenge nonce that the target must sign to prove they control their identity
     */
    AgentChatClient.prototype.verify = function (target) {
        return __awaiter(this, void 0, void 0, function () {
            var targetAgent, nonce, msg;
            var _this = this;
            return __generator(this, function (_a) {
                targetAgent = target.startsWith('@') ? target : "@".concat(target);
                nonce = (0, protocol_js_1.generateNonce)();
                msg = {
                    type: types_js_1.ClientMessageType.VERIFY_REQUEST,
                    target: targetAgent,
                    nonce: nonce
                };
                this._send(msg);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            _this.removeListener('verify_success', onSuccess);
                            _this.removeListener('verify_failed', onFailed);
                            _this.removeListener('error', onError);
                            reject(new Error('Verification timeout'));
                        }, 35000); // Slightly longer than server timeout
                        var onSuccess = function (response) {
                            if (response.agent === targetAgent || response.target === targetAgent) {
                                clearTimeout(timeout);
                                _this.removeListener('verify_failed', onFailed);
                                _this.removeListener('error', onError);
                                resolve({
                                    verified: true,
                                    agent: response.agent,
                                    pubkey: response.pubkey,
                                    request_id: response.request_id
                                });
                            }
                        };
                        var onFailed = function (response) {
                            if (response.target === targetAgent) {
                                clearTimeout(timeout);
                                _this.removeListener('verify_success', onSuccess);
                                _this.removeListener('error', onError);
                                resolve({
                                    verified: false,
                                    target: response.target,
                                    reason: response.reason,
                                    request_id: response.request_id
                                });
                            }
                        };
                        var onError = function (err) {
                            clearTimeout(timeout);
                            _this.removeListener('verify_success', onSuccess);
                            _this.removeListener('verify_failed', onFailed);
                            reject(new Error(err.message));
                        };
                        _this.on('verify_success', onSuccess);
                        _this.on('verify_failed', onFailed);
                        _this.once('error', onError);
                    })];
            });
        });
    };
    /**
     * Respond to a verification request by signing the nonce
     * This is typically called automatically when a VERIFY_REQUEST is received
     */
    AgentChatClient.prototype.respondToVerification = function (requestId, nonce) {
        return __awaiter(this, void 0, void 0, function () {
            var sig, msg;
            return __generator(this, function (_a) {
                if (!this._identity || !this._identity.privkey) {
                    throw new Error('Responding to verification requires persistent identity.');
                }
                sig = this._identity.sign(nonce);
                msg = {
                    type: types_js_1.ClientMessageType.VERIFY_RESPONSE,
                    request_id: requestId,
                    nonce: nonce,
                    sig: sig
                };
                this._send(msg);
                return [2 /*return*/];
            });
        });
    };
    /**
     * Enable automatic verification response
     * When enabled, the client will automatically respond to VERIFY_REQUEST messages
     */
    AgentChatClient.prototype.enableAutoVerification = function (enabled) {
        var _this = this;
        if (enabled === void 0) { enabled = true; }
        if (enabled) {
            this._autoVerifyHandler = function (msg) {
                if (msg.request_id && msg.nonce && msg.from) {
                    _this.respondToVerification(msg.request_id, msg.nonce)
                        .catch(function (err) { return _this.emit('error', { message: "Auto-verification failed: ".concat(err.message) }); });
                }
            };
            this.on('verify_request', this._autoVerifyHandler);
        }
        else if (this._autoVerifyHandler) {
            this.removeListener('verify_request', this._autoVerifyHandler);
            this._autoVerifyHandler = null;
        }
    };
    AgentChatClient.prototype._send = function (msg) {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send((0, protocol_js_1.serialize)(msg));
        }
    };
    /**
     * Send a raw message (for protocol extensions)
     */
    AgentChatClient.prototype.sendRaw = function (msg) {
        this._send(msg);
    };
    AgentChatClient.prototype._handleMessage = function (data) {
        var msg;
        try {
            msg = (0, protocol_js_1.parse)(data);
        }
        catch (e) {
            this.emit('error', { message: 'Invalid JSON from server' });
            return;
        }
        // Emit raw message
        this.emit('raw', msg);
        // Handle by type
        switch (msg.type) {
            case types_js_1.ServerMessageType.WELCOME:
                this.emit('welcome', msg);
                break;
            case types_js_1.ServerMessageType.CHALLENGE:
                this.emit('challenge', msg);
                break;
            case types_js_1.ServerMessageType.MSG:
                this.emit('message', msg);
                break;
            case types_js_1.ServerMessageType.JOINED:
                this.emit('joined', msg);
                break;
            case types_js_1.ServerMessageType.LEFT:
                this.emit('left', msg);
                break;
            case types_js_1.ServerMessageType.AGENT_JOINED:
                this.emit('agent_joined', msg);
                break;
            case types_js_1.ServerMessageType.AGENT_LEFT:
                this.emit('agent_left', msg);
                break;
            case types_js_1.ServerMessageType.NICK_CHANGED:
                this.emit('nick_changed', msg);
                break;
            case types_js_1.ServerMessageType.CHANNELS:
                this.emit('channels', msg);
                break;
            case types_js_1.ServerMessageType.AGENTS:
                this.emit('agents', msg);
                break;
            case types_js_1.ServerMessageType.ERROR:
                this.emit('error', msg);
                break;
            case types_js_1.ServerMessageType.PONG:
                this.emit('pong', msg);
                break;
            // Proposal/negotiation messages
            case types_js_1.ServerMessageType.PROPOSAL:
                this.emit('proposal', msg);
                break;
            case types_js_1.ServerMessageType.ACCEPT:
                this.emit('accept', msg);
                break;
            case types_js_1.ServerMessageType.REJECT:
                this.emit('reject', msg);
                break;
            case types_js_1.ServerMessageType.COMPLETE:
                this.emit('complete', msg);
                break;
            case types_js_1.ServerMessageType.DISPUTE:
                this.emit('dispute', msg);
                break;
            // Skills discovery messages
            case types_js_1.ServerMessageType.SKILLS_REGISTERED:
                this.emit('skills_registered', msg);
                this.emit('message', msg);
                break;
            case types_js_1.ServerMessageType.SEARCH_RESULTS:
                this.emit('search_results', msg);
                this.emit('message', msg);
                break;
            // Identity verification messages
            case types_js_1.ServerMessageType.VERIFY_REQUEST:
                this.emit('verify_request', msg);
                break;
            case types_js_1.ServerMessageType.VERIFY_RESPONSE:
                this.emit('verify_response', msg);
                break;
            case types_js_1.ServerMessageType.VERIFY_SUCCESS:
                this.emit('verify_success', msg);
                break;
            case types_js_1.ServerMessageType.VERIFY_FAILED:
                this.emit('verify_failed', msg);
                break;
            case types_js_1.ServerMessageType.SESSION_DISPLACED:
                this.emit('session_displaced', msg);
                break;
        }
    };
    return AgentChatClient;
}(events_1.EventEmitter));
exports.AgentChatClient = AgentChatClient;
/**
 * Quick send - connect, send message, disconnect
 */
function quickSend(server_1, name_1, to_1, content_1) {
    return __awaiter(this, arguments, void 0, function (server, name, to, content, identityPath) {
        var client;
        if (identityPath === void 0) { identityPath = null; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new AgentChatClient({ server: server, name: name, identity: identityPath });
                    return [4 /*yield*/, client.connect()];
                case 1:
                    _a.sent();
                    if (!to.startsWith('#')) return [3 /*break*/, 3];
                    return [4 /*yield*/, client.join(to)];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3: return [4 /*yield*/, client.send(to, content)];
                case 4:
                    _a.sent();
                    // Small delay to ensure message is sent
                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 100); })];
                case 5:
                    // Small delay to ensure message is sent
                    _a.sent();
                    client.disconnect();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Listen mode - connect, join channels, stream messages
 */
function listen(server_1, name_1, channels_1, callback_1) {
    return __awaiter(this, arguments, void 0, function (server, name, channels, callback, identityPath) {
        var client, _i, channels_2, channel;
        if (identityPath === void 0) { identityPath = null; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new AgentChatClient({ server: server, name: name, identity: identityPath });
                    return [4 /*yield*/, client.connect()];
                case 1:
                    _a.sent();
                    _i = 0, channels_2 = channels;
                    _a.label = 2;
                case 2:
                    if (!(_i < channels_2.length)) return [3 /*break*/, 5];
                    channel = channels_2[_i];
                    return [4 /*yield*/, client.join(channel)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    client.on('message', callback);
                    client.on('agent_joined', callback);
                    client.on('agent_left', callback);
                    // Also stream proposal events
                    client.on('proposal', callback);
                    client.on('accept', callback);
                    client.on('reject', callback);
                    client.on('complete', callback);
                    client.on('dispute', callback);
                    return [2 /*return*/, client];
            }
        });
    });
}
// Re-export security utilities
var security_js_1 = require("./security.js");
Object.defineProperty(exports, "checkDirectorySafety", { enumerable: true, get: function () { return security_js_1.checkDirectorySafety; } });
Object.defineProperty(exports, "enforceDirectorySafety", { enumerable: true, get: function () { return security_js_1.enforceDirectorySafety; } });
