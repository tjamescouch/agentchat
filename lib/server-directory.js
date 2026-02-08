"use strict";
/**
 * Server Directory
 * Registry of known AgentChat servers for discovery
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
exports.ServerDirectory = exports.DEFAULT_DIRECTORY_PATH = exports.DEFAULT_SERVERS = void 0;
var http_1 = require("http");
var https_1 = require("https");
var promises_1 = require("fs/promises");
var path_1 = require("path");
// Default public servers (can be extended)
exports.DEFAULT_SERVERS = process.env.AGENTCHAT_PUBLIC === 'true'
    ? [
        {
            name: 'AgentChat Public',
            url: 'wss://agentchat-server.fly.dev',
            description: 'Official public AgentChat server',
            region: 'global'
        }
    ]
    : [
        {
            name: 'AgentChat Local',
            url: 'ws://localhost:6667',
            description: 'Local AgentChat server',
            region: 'local'
        }
    ];
// Default directory file path
exports.DEFAULT_DIRECTORY_PATH = path_1.default.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentchat', 'servers.json');
/**
 * Server Directory for discovering AgentChat servers
 */
var ServerDirectory = /** @class */ (function () {
    function ServerDirectory(options) {
        if (options === void 0) { options = {}; }
        this.directoryPath = options.directoryPath || exports.DEFAULT_DIRECTORY_PATH;
        this.servers = __spreadArray([], exports.DEFAULT_SERVERS, true);
        this.timeout = options.timeout || 5000;
    }
    /**
     * Load servers from directory file
     */
    ServerDirectory.prototype.load = function () {
        return __awaiter(this, void 0, void 0, function () {
            var data, loaded, urls, _i, _a, server, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, promises_1.default.readFile(this.directoryPath, 'utf8')];
                    case 1:
                        data = _c.sent();
                        loaded = JSON.parse(data);
                        if (Array.isArray(loaded.servers)) {
                            urls = new Set(this.servers.map(function (s) { return s.url; }));
                            for (_i = 0, _a = loaded.servers; _i < _a.length; _i++) {
                                server = _a[_i];
                                if (!urls.has(server.url)) {
                                    this.servers.push(server);
                                    urls.add(server.url);
                                }
                            }
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        _b = _c.sent();
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/, this];
                }
            });
        });
    };
    /**
     * Save servers to directory file
     */
    ServerDirectory.prototype.save = function () {
        return __awaiter(this, void 0, void 0, function () {
            var dir;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        dir = path_1.default.dirname(this.directoryPath);
                        return [4 /*yield*/, promises_1.default.mkdir(dir, { recursive: true })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, promises_1.default.writeFile(this.directoryPath, JSON.stringify({
                                version: 1,
                                updated_at: new Date().toISOString(),
                                servers: this.servers
                            }, null, 2))];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Add a server to the directory
     */
    ServerDirectory.prototype.addServer = function (server) {
        return __awaiter(this, void 0, void 0, function () {
            var existing;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        existing = this.servers.find(function (s) { return s.url === server.url; });
                        if (existing) {
                            Object.assign(existing, server);
                        }
                        else {
                            this.servers.push(server);
                        }
                        return [4 /*yield*/, this.save()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Remove a server from the directory
     */
    ServerDirectory.prototype.removeServer = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.servers = this.servers.filter(function (s) { return s.url !== url; });
                        return [4 /*yield*/, this.save()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check health of a single server
     * @param server - Server object with url
     * @returns Server with health status
     */
    ServerDirectory.prototype.checkHealth = function (server) {
        return __awaiter(this, void 0, void 0, function () {
            var wsUrl, httpUrl, health, err_1, error;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        wsUrl = server.url;
                        httpUrl = wsUrl
                            .replace('wss://', 'https://')
                            .replace('ws://', 'http://');
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this._fetchHealth(httpUrl + '/health')];
                    case 2:
                        health = _a.sent();
                        return [2 /*return*/, __assign(__assign({}, server), { status: 'online', health: health, checked_at: new Date().toISOString() })];
                    case 3:
                        err_1 = _a.sent();
                        error = err_1;
                        return [2 /*return*/, __assign(__assign({}, server), { status: 'offline', error: error.message || error.code || 'Unknown error', checked_at: new Date().toISOString() })];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Fetch health endpoint
     */
    ServerDirectory.prototype._fetchHealth = function (url) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var protocol = url.startsWith('https') ? https_1.default : http_1.default;
            var req = protocol.get(url, { timeout: _this.timeout }, function (res) {
                var data = '';
                res.on('data', function (chunk) { return data += chunk; });
                res.on('end', function () {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch (_a) {
                            reject(new Error('Invalid health response'));
                        }
                    }
                    else {
                        reject(new Error("HTTP ".concat(res.statusCode)));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', function () {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    };
    /**
     * Discover available servers (check health of all known servers)
     * @param options
     * @param options.onlineOnly - Only return online servers
     * @returns List of servers with status
     */
    ServerDirectory.prototype.discover = function () {
        return __awaiter(this, arguments, void 0, function (options) {
            var results;
            var _this = this;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.all(this.servers.map(function (server) { return _this.checkHealth(server); }))];
                    case 1:
                        results = _a.sent();
                        if (options.onlineOnly) {
                            return [2 /*return*/, results.filter(function (s) { return s.status === 'online'; })];
                        }
                        return [2 /*return*/, results];
                }
            });
        });
    };
    /**
     * Get list of known servers without health check
     */
    ServerDirectory.prototype.list = function () {
        return __spreadArray([], this.servers, true);
    };
    return ServerDirectory;
}());
exports.ServerDirectory = ServerDirectory;
exports.default = ServerDirectory;
