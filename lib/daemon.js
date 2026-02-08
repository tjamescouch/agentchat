"use strict";
/**
 * AgentChat Daemon
 * Persistent connection with file-based inbox/outbox
 * Supports multiple instances with different identities
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
exports.DEFAULT_INSTANCE = exports.DEFAULT_CHANNELS = exports.PID_PATH = exports.LOG_PATH = exports.OUTBOX_PATH = exports.INBOX_PATH = exports.AgentChatDaemon = void 0;
exports.getDaemonPaths = getDaemonPaths;
exports.isDaemonRunning = isDaemonRunning;
exports.stopDaemon = stopDaemon;
exports.getDaemonStatus = getDaemonStatus;
exports.listDaemons = listDaemons;
exports.stopAllDaemons = stopAllDaemons;
var fs_1 = require("fs");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var client_js_1 = require("./client.js");
var identity_js_1 = require("./identity.js");
var receipts_js_1 = require("./receipts.js");
var security_js_1 = require("./security.js");
// ============ Constants ============
// Base directory (cwd-relative for project-local storage)
var AGENTCHAT_DIR = path_1.default.join(process.cwd(), '.agentchat');
var DAEMONS_DIR = path_1.default.join(AGENTCHAT_DIR, 'daemons');
// Default instance name
var DEFAULT_INSTANCE = 'default';
exports.DEFAULT_INSTANCE = DEFAULT_INSTANCE;
var DEFAULT_CHANNELS = ['#general', '#agents', '#code-review', '#servers'];
exports.DEFAULT_CHANNELS = DEFAULT_CHANNELS;
var MAX_INBOX_LINES = 1000;
var RECONNECT_DELAY = 5000; // 5 seconds
var MAX_RECONNECT_TIME = 10 * 60 * 1000; // 10 minutes default
var OUTBOX_POLL_INTERVAL = 500; // 500ms
// ============ Helper Functions ============
/**
 * Validate instance name to prevent path traversal
 * Only allows alphanumeric, hyphens, and underscores
 */
function validateInstanceName(name) {
    if (!name || typeof name !== 'string') {
        return 'default';
    }
    // Strip any path separators and dangerous characters
    var sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
    return sanitized || 'default';
}
/**
 * Get paths for a daemon instance
 */
function getDaemonPaths(instanceName) {
    if (instanceName === void 0) { instanceName = DEFAULT_INSTANCE; }
    var safeName = validateInstanceName(instanceName);
    var instanceDir = path_1.default.join(DAEMONS_DIR, safeName);
    return {
        dir: instanceDir,
        inbox: path_1.default.join(instanceDir, 'inbox.jsonl'),
        outbox: path_1.default.join(instanceDir, 'outbox.jsonl'),
        log: path_1.default.join(instanceDir, 'daemon.log'),
        pid: path_1.default.join(instanceDir, 'daemon.pid'),
        newdata: path_1.default.join(instanceDir, 'newdata') // Semaphore for new messages
    };
}
// ============ AgentChatDaemon Class ============
var AgentChatDaemon = /** @class */ (function () {
    function AgentChatDaemon(options) {
        this.server = options.server;
        this.identityPath = options.identity || identity_js_1.DEFAULT_IDENTITY_PATH;
        this.channels = options.channels || DEFAULT_CHANNELS;
        this.instanceName = options.name || DEFAULT_INSTANCE;
        this.maxReconnectTime = options.maxReconnectTime || MAX_RECONNECT_TIME;
        // Get instance-specific paths
        this.paths = getDaemonPaths(this.instanceName);
        this.client = null;
        this.running = false;
        this.reconnecting = false;
        this.reconnectStartTime = null;
        this.outboxWatcher = null;
        this.outboxPollInterval = null;
        this.lastOutboxSize = 0;
    }
    AgentChatDaemon.prototype._ensureDir = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, promises_1.default.mkdir(this.paths.dir, { recursive: true })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._log = function (level, message) {
        var timestamp = new Date().toISOString();
        var line = "[".concat(timestamp, "] [").concat(level.toUpperCase(), "] ").concat(message, "\n");
        // Append to log file
        try {
            fs_1.default.appendFileSync(this.paths.log, line);
        }
        catch (_a) {
            // Directory might not exist yet
        }
        // Also output to console if not background
        if (level === 'error') {
            console.error(line.trim());
        }
        else {
            console.log(line.trim());
        }
    };
    AgentChatDaemon.prototype._appendToInbox = function (msg) {
        return __awaiter(this, void 0, void 0, function () {
            var line;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        line = JSON.stringify(msg) + '\n';
                        // Append to inbox
                        return [4 /*yield*/, promises_1.default.appendFile(this.paths.inbox, line)];
                    case 1:
                        // Append to inbox
                        _a.sent();
                        // Touch semaphore file to signal new data
                        return [4 /*yield*/, promises_1.default.writeFile(this.paths.newdata, Date.now().toString())];
                    case 2:
                        // Touch semaphore file to signal new data
                        _a.sent();
                        // Check if we need to truncate (ring buffer)
                        return [4 /*yield*/, this._truncateInbox()];
                    case 3:
                        // Check if we need to truncate (ring buffer)
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._truncateInbox = function () {
        return __awaiter(this, void 0, void 0, function () {
            var content, lines, newLines, err_1, error;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 4, , 5]);
                        return [4 /*yield*/, promises_1.default.readFile(this.paths.inbox, 'utf-8')];
                    case 1:
                        content = _a.sent();
                        lines = content.trim().split('\n');
                        if (!(lines.length > MAX_INBOX_LINES)) return [3 /*break*/, 3];
                        newLines = lines.slice(-MAX_INBOX_LINES);
                        return [4 /*yield*/, promises_1.default.writeFile(this.paths.inbox, newLines.join('\n') + '\n')];
                    case 2:
                        _a.sent();
                        this._log('info', "Truncated inbox to ".concat(MAX_INBOX_LINES, " lines"));
                        _a.label = 3;
                    case 3: return [3 /*break*/, 5];
                    case 4:
                        err_1 = _a.sent();
                        error = err_1;
                        if (error.code !== 'ENOENT') {
                            this._log('error', "Failed to truncate inbox: ".concat(error.message));
                        }
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._saveReceiptIfParty = function (completeMsg) {
        return __awaiter(this, void 0, void 0, function () {
            var ourAgentId, err_2, error;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 3, , 4]);
                        ourAgentId = (_a = this.client) === null || _a === void 0 ? void 0 : _a.agentId;
                        if (!ourAgentId) {
                            return [2 /*return*/];
                        }
                        if (!(0, receipts_js_1.shouldStoreReceipt)(completeMsg, ourAgentId)) return [3 /*break*/, 2];
                        return [4 /*yield*/, (0, receipts_js_1.appendReceipt)(completeMsg, receipts_js_1.DEFAULT_RECEIPTS_PATH)];
                    case 1:
                        _b.sent();
                        this._log('info', "Saved receipt for proposal ".concat(completeMsg.proposal_id));
                        _b.label = 2;
                    case 2: return [3 /*break*/, 4];
                    case 3:
                        err_2 = _b.sent();
                        error = err_2;
                        this._log('error', "Failed to save receipt: ".concat(error.message));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._processOutbox = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, content, lines, _i, lines_1, line, msg, err_3, error, err_4, error;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 18, , 19]);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, promises_1.default.access(this.paths.outbox)];
                    case 2:
                        _b.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/]; // No outbox file
                    case 4: return [4 /*yield*/, promises_1.default.readFile(this.paths.outbox, 'utf-8')];
                    case 5:
                        content = _b.sent();
                        if (!content.trim())
                            return [2 /*return*/];
                        lines = content.trim().split('\n');
                        _i = 0, lines_1 = lines;
                        _b.label = 6;
                    case 6:
                        if (!(_i < lines_1.length)) return [3 /*break*/, 16];
                        line = lines_1[_i];
                        if (!line.trim())
                            return [3 /*break*/, 15];
                        _b.label = 7;
                    case 7:
                        _b.trys.push([7, 14, , 15]);
                        msg = JSON.parse(line);
                        if (!(msg.to && msg.content)) return [3 /*break*/, 12];
                        if (!(msg.to.startsWith('#') && this.client && !this.client.channels.has(msg.to))) return [3 /*break*/, 9];
                        return [4 /*yield*/, this.client.join(msg.to)];
                    case 8:
                        _b.sent();
                        this._log('info', "Joined ".concat(msg.to, " for outbound message"));
                        _b.label = 9;
                    case 9:
                        if (!this.client) return [3 /*break*/, 11];
                        return [4 /*yield*/, this.client.send(msg.to, msg.content)];
                    case 10:
                        _b.sent();
                        this._log('info', "Sent message to ".concat(msg.to, ": ").concat(msg.content.substring(0, 50), "..."));
                        _b.label = 11;
                    case 11: return [3 /*break*/, 13];
                    case 12:
                        this._log('warn', "Invalid outbox message: ".concat(line));
                        _b.label = 13;
                    case 13: return [3 /*break*/, 15];
                    case 14:
                        err_3 = _b.sent();
                        error = err_3;
                        this._log('error', "Failed to process outbox line: ".concat(error.message));
                        return [3 /*break*/, 15];
                    case 15:
                        _i++;
                        return [3 /*break*/, 6];
                    case 16: 
                    // Truncate outbox after processing
                    return [4 /*yield*/, promises_1.default.writeFile(this.paths.outbox, '')];
                    case 17:
                        // Truncate outbox after processing
                        _b.sent();
                        return [3 /*break*/, 19];
                    case 18:
                        err_4 = _b.sent();
                        error = err_4;
                        if (error.code !== 'ENOENT') {
                            this._log('error', "Outbox error: ".concat(error.message));
                        }
                        return [3 /*break*/, 19];
                    case 19: return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._startOutboxWatcher = function () {
        var _this = this;
        // Use polling instead of fs.watch for reliability
        this.outboxPollInterval = setInterval(function () {
            if (_this.client && _this.client.connected) {
                _this._processOutbox();
            }
        }, OUTBOX_POLL_INTERVAL);
        // Also try fs.watch for immediate response (may not work on all platforms)
        try {
            // Ensure outbox file exists
            if (!fs_1.default.existsSync(this.paths.outbox)) {
                fs_1.default.writeFileSync(this.paths.outbox, '');
            }
            this.outboxWatcher = fs_1.default.watch(this.paths.outbox, function (eventType) {
                if (eventType === 'change' && _this.client && _this.client.connected) {
                    _this._processOutbox();
                }
            });
        }
        catch (err) {
            var error = err;
            this._log('warn', "fs.watch not available, using polling only: ".concat(error.message));
        }
    };
    AgentChatDaemon.prototype._stopOutboxWatcher = function () {
        if (this.outboxPollInterval) {
            clearInterval(this.outboxPollInterval);
            this.outboxPollInterval = null;
        }
        if (this.outboxWatcher) {
            this.outboxWatcher.close();
            this.outboxWatcher = null;
        }
    };
    AgentChatDaemon.prototype._connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, channel, err_5, error, err_6, error;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this._log('info', "Connecting to ".concat(this.server, "..."));
                        this.client = new client_js_1.AgentChatClient({
                            server: this.server,
                            identity: this.identityPath
                        });
                        // Set up event handlers
                        this.client.on('message', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('agent_joined', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('agent_left', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('proposal', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('accept', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('reject', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('complete', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        // Save receipt if we're a party to this completion
                                        return [4 /*yield*/, this._saveReceiptIfParty(msg)];
                                    case 2:
                                        // Save receipt if we're a party to this completion
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('dispute', function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, this._appendToInbox(msg)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.client.on('disconnect', function () {
                            _this._log('warn', 'Disconnected from server');
                            if (_this.running && !_this.reconnecting) {
                                _this._scheduleReconnect();
                            }
                        });
                        this.client.on('error', function (err) {
                            var message = err instanceof Error ? err.message : (err.message || JSON.stringify(err));
                            _this._log('error', "Client error: ".concat(message));
                        });
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 9, , 10]);
                        return [4 /*yield*/, this.client.connect()];
                    case 2:
                        _b.sent();
                        this._log('info', "Connected as ".concat(this.client.agentId));
                        _i = 0, _a = this.channels;
                        _b.label = 3;
                    case 3:
                        if (!(_i < _a.length)) return [3 /*break*/, 8];
                        channel = _a[_i];
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, this.client.join(channel)];
                    case 5:
                        _b.sent();
                        this._log('info', "Joined ".concat(channel));
                        return [3 /*break*/, 7];
                    case 6:
                        err_5 = _b.sent();
                        error = err_5;
                        this._log('error', "Failed to join ".concat(channel, ": ").concat(error.message));
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 3];
                    case 8: return [2 /*return*/, true];
                    case 9:
                        err_6 = _b.sent();
                        error = err_6;
                        this._log('error', "Connection failed: ".concat(error.message));
                        return [2 /*return*/, false];
                    case 10: return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype._scheduleReconnect = function () {
        var _this = this;
        if (!this.running || this.reconnecting)
            return;
        // Start tracking reconnect time if this is the first attempt
        if (!this.reconnectStartTime) {
            this.reconnectStartTime = Date.now();
        }
        // Check if we've exceeded max reconnect time
        var elapsed = Date.now() - this.reconnectStartTime;
        if (elapsed >= this.maxReconnectTime) {
            this._log('error', "Max reconnect time (".concat(this.maxReconnectTime / 1000 / 60, " minutes) exceeded. Giving up."));
            this._log('info', 'Daemon will exit. Restart manually or use a process manager.');
            this.stop();
            return;
        }
        this.reconnecting = true;
        var remaining = Math.round((this.maxReconnectTime - elapsed) / 1000);
        this._log('info', "Reconnecting in ".concat(RECONNECT_DELAY / 1000, " seconds... (").concat(remaining, "s until timeout)"));
        setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
            var connected;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.reconnecting = false;
                        if (!this.running) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._connect()];
                    case 1:
                        connected = _a.sent();
                        if (connected) {
                            // Reset reconnect timer on successful connection
                            this.reconnectStartTime = null;
                            this._log('info', 'Reconnected successfully');
                        }
                        else {
                            this._scheduleReconnect();
                        }
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        }); }, RECONNECT_DELAY);
    };
    AgentChatDaemon.prototype.start = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, connected;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        // Security check: prevent running in root/system directories
                        (0, security_js_1.enforceDirectorySafety)(process.cwd(), { allowWarnings: true, silent: false });
                        this.running = true;
                        // Ensure instance directory exists
                        return [4 /*yield*/, this._ensureDir()];
                    case 1:
                        // Ensure instance directory exists
                        _b.sent();
                        // Write PID file
                        return [4 /*yield*/, promises_1.default.writeFile(this.paths.pid, process.pid.toString())];
                    case 2:
                        // Write PID file
                        _b.sent();
                        this._log('info', "Daemon starting (PID: ".concat(process.pid, ", instance: ").concat(this.instanceName, ")"));
                        _b.label = 3;
                    case 3:
                        _b.trys.push([3, 5, , 7]);
                        return [4 /*yield*/, promises_1.default.access(this.paths.inbox)];
                    case 4:
                        _b.sent();
                        return [3 /*break*/, 7];
                    case 5:
                        _a = _b.sent();
                        return [4 /*yield*/, promises_1.default.writeFile(this.paths.inbox, '')];
                    case 6:
                        _b.sent();
                        return [3 /*break*/, 7];
                    case 7: return [4 /*yield*/, this._connect()];
                    case 8:
                        connected = _b.sent();
                        if (!connected) {
                            this._scheduleReconnect();
                        }
                        // Start watching outbox
                        this._startOutboxWatcher();
                        // Handle shutdown signals
                        process.on('SIGINT', function () { return _this.stop(); });
                        process.on('SIGTERM', function () { return _this.stop(); });
                        this._log('info', 'Daemon started');
                        this._log('info', "Inbox: ".concat(this.paths.inbox));
                        this._log('info', "Outbox: ".concat(this.paths.outbox));
                        this._log('info', "Log: ".concat(this.paths.log));
                        return [2 /*return*/];
                }
            });
        });
    };
    AgentChatDaemon.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this._log('info', 'Daemon stopping...');
                        this.running = false;
                        this._stopOutboxWatcher();
                        if (this.client) {
                            this.client.disconnect();
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, promises_1.default.unlink(this.paths.pid)];
                    case 2:
                        _b.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        this._log('info', 'Daemon stopped');
                        process.exit(0);
                        return [2 /*return*/];
                }
            });
        });
    };
    return AgentChatDaemon;
}());
exports.AgentChatDaemon = AgentChatDaemon;
// ============ Utility Functions ============
/**
 * Check if daemon instance is running
 */
function isDaemonRunning() {
    return __awaiter(this, arguments, void 0, function (instanceName) {
        var paths, pid, pidNum, _a, _b;
        if (instanceName === void 0) { instanceName = DEFAULT_INSTANCE; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    paths = getDaemonPaths(instanceName);
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, promises_1.default.readFile(paths.pid, 'utf-8')];
                case 2:
                    pid = _c.sent();
                    pidNum = parseInt(pid.trim());
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 4, , 6]);
                    process.kill(pidNum, 0);
                    return [2 /*return*/, { running: true, pid: pidNum, instance: instanceName }];
                case 4:
                    _a = _c.sent();
                    // Process not running, clean up stale PID file
                    return [4 /*yield*/, promises_1.default.unlink(paths.pid)];
                case 5:
                    // Process not running, clean up stale PID file
                    _c.sent();
                    return [2 /*return*/, { running: false, instance: instanceName }];
                case 6: return [3 /*break*/, 8];
                case 7:
                    _b = _c.sent();
                    return [2 /*return*/, { running: false, instance: instanceName }];
                case 8: return [2 /*return*/];
            }
        });
    });
}
/**
 * Stop a daemon instance
 */
function stopDaemon() {
    return __awaiter(this, arguments, void 0, function (instanceName) {
        var status, paths, _a, err_7, error;
        if (instanceName === void 0) { instanceName = DEFAULT_INSTANCE; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, isDaemonRunning(instanceName)];
                case 1:
                    status = _b.sent();
                    if (!status.running) {
                        return [2 /*return*/, { stopped: false, reason: 'Daemon not running', instance: instanceName }];
                    }
                    paths = getDaemonPaths(instanceName);
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 8, , 9]);
                    process.kill(status.pid, 'SIGTERM');
                    // Wait a bit for clean shutdown
                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 1000); })];
                case 3:
                    // Wait a bit for clean shutdown
                    _b.sent();
                    // Check if still running
                    try {
                        process.kill(status.pid, 0);
                        // Still running, force kill
                        process.kill(status.pid, 'SIGKILL');
                    }
                    catch (_c) {
                        // Process gone, good
                    }
                    _b.label = 4;
                case 4:
                    _b.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, promises_1.default.unlink(paths.pid)];
                case 5:
                    _b.sent();
                    return [3 /*break*/, 7];
                case 6:
                    _a = _b.sent();
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/, { stopped: true, pid: status.pid, instance: instanceName }];
                case 8:
                    err_7 = _b.sent();
                    error = err_7;
                    return [2 /*return*/, { stopped: false, reason: error.message, instance: instanceName }];
                case 9: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get daemon instance status
 */
function getDaemonStatus() {
    return __awaiter(this, arguments, void 0, function (instanceName) {
        var status, paths, inboxLines, lastMessage, content, lines, _a;
        if (instanceName === void 0) { instanceName = DEFAULT_INSTANCE; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, isDaemonRunning(instanceName)];
                case 1:
                    status = _b.sent();
                    paths = getDaemonPaths(instanceName);
                    if (!status.running) {
                        return [2 /*return*/, {
                                running: false,
                                instance: instanceName
                            }];
                    }
                    inboxLines = 0;
                    lastMessage = null;
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.readFile(paths.inbox, 'utf-8')];
                case 3:
                    content = _b.sent();
                    lines = content.trim().split('\n').filter(function (l) { return l; });
                    inboxLines = lines.length;
                    if (lines.length > 0) {
                        try {
                            lastMessage = JSON.parse(lines[lines.length - 1]);
                        }
                        catch (_c) {
                            // Ignore parse errors
                        }
                    }
                    return [3 /*break*/, 5];
                case 4:
                    _a = _b.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/, {
                        running: true,
                        instance: instanceName,
                        pid: status.pid,
                        inboxPath: paths.inbox,
                        outboxPath: paths.outbox,
                        logPath: paths.log,
                        inboxLines: inboxLines,
                        lastMessage: lastMessage
                    }];
            }
        });
    });
}
/**
 * List all daemon instances
 */
function listDaemons() {
    return __awaiter(this, void 0, void 0, function () {
        var instances, entries, _i, entries_1, entry, status_1, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    instances = [];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, promises_1.default.readdir(DAEMONS_DIR, { withFileTypes: true })];
                case 2:
                    entries = _b.sent();
                    _i = 0, entries_1 = entries;
                    _b.label = 3;
                case 3:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 6];
                    entry = entries_1[_i];
                    if (!entry.isDirectory()) return [3 /*break*/, 5];
                    return [4 /*yield*/, isDaemonRunning(entry.name)];
                case 4:
                    status_1 = _b.sent();
                    instances.push({
                        name: entry.name,
                        running: status_1.running,
                        pid: status_1.pid || null
                    });
                    _b.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 3];
                case 6: return [3 /*break*/, 8];
                case 7:
                    _a = _b.sent();
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/, instances];
            }
        });
    });
}
/**
 * Stop all running daemons
 */
function stopAllDaemons() {
    return __awaiter(this, void 0, void 0, function () {
        var instances, results, _i, instances_1, instance, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, listDaemons()];
                case 1:
                    instances = _a.sent();
                    results = [];
                    _i = 0, instances_1 = instances;
                    _a.label = 2;
                case 2:
                    if (!(_i < instances_1.length)) return [3 /*break*/, 5];
                    instance = instances_1[_i];
                    if (!instance.running) return [3 /*break*/, 4];
                    return [4 /*yield*/, stopDaemon(instance.name)];
                case 3:
                    result = _a.sent();
                    results.push(result);
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, results];
            }
        });
    });
}
// Export for CLI (backwards compatibility with default paths)
exports.INBOX_PATH = getDaemonPaths(DEFAULT_INSTANCE).inbox;
exports.OUTBOX_PATH = getDaemonPaths(DEFAULT_INSTANCE).outbox;
exports.LOG_PATH = getDaemonPaths(DEFAULT_INSTANCE).log;
exports.PID_PATH = getDaemonPaths(DEFAULT_INSTANCE).pid;
