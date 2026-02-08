"use strict";
/**
 * Skills Handlers
 * Handles skill registration and search
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
exports.handleRegisterSkills = handleRegisterSkills;
exports.handleSearchSkills = handleSearchSkills;
var protocol_js_1 = require("../../protocol.js");
var identity_js_1 = require("../../identity.js");
var crypto_1 = require("crypto");
/**
 * Create signing content for skill registration
 */
function getRegisterSkillsSigningContent(skills) {
    var hash = crypto_1.default.createHash('sha256')
        .update(JSON.stringify(skills))
        .digest('hex');
    return "REGISTER_SKILLS|".concat(hash);
}
/**
 * Handle REGISTER_SKILLS command
 */
function handleRegisterSkills(server, ws, msg) {
    var agent = server.agents.get(ws);
    if (!agent) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
        return;
    }
    if (!agent.pubkey) {
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.SIGNATURE_REQUIRED, 'Skill registration requires persistent identity'));
        return;
    }
    // Verify signature
    var sigContent = getRegisterSkillsSigningContent(msg.skills);
    if (!identity_js_1.Identity.verify(sigContent, msg.sig, agent.pubkey)) {
        server._log('sig_verification_failed', { agent: agent.id, msg_type: 'REGISTER_SKILLS' });
        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.VERIFICATION_FAILED, 'Invalid signature'));
        return;
    }
    // Store skills for this agent
    var registration = {
        agent_id: "@".concat(agent.id),
        skills: msg.skills,
        registered_at: Date.now(),
        sig: msg.sig
    };
    server.skillsRegistry.set(agent.id, registration);
    server._log('skills_registered', { agent: agent.id, count: msg.skills.length });
    // Notify the registering agent
    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.SKILLS_REGISTERED, {
        agent_id: "@".concat(agent.id),
        skills_count: msg.skills.length,
        registered_at: registration.registered_at
    }));
    // Optionally broadcast to #discovery channel if it exists
    if (server.channels.has('#discovery')) {
        server._broadcast('#discovery', (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.MSG, {
            from: '@server',
            from_name: 'Server',
            to: '#discovery',
            content: "Agent @".concat(agent.id, " registered ").concat(msg.skills.length, " skill(s): ").concat(msg.skills.map(function (s) { return s.capability; }).join(', '))
        }));
    }
}
/**
 * Handle SEARCH_SKILLS command
 */
function handleSearchSkills(server, ws, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var agent, query, results, _i, _a, _b, registration, _c, _d, skill, matches, cap, search, uniqueAgentIds, ratingCache, _e, uniqueAgentIds_1, agentId, ratingInfo, _f, results_1, result, ratingInfo, limit, limitedResults;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    agent = server.agents.get(ws);
                    if (!agent) {
                        server._send(ws, (0, protocol_js_1.createError)(protocol_js_1.ErrorCode.AUTH_REQUIRED, 'Must IDENTIFY first'));
                        return [2 /*return*/];
                    }
                    query = msg.query || {};
                    results = [];
                    // Search through all registered skills
                    for (_i = 0, _a = server.skillsRegistry; _i < _a.length; _i++) {
                        _b = _a[_i], registration = _b[1];
                        for (_c = 0, _d = registration.skills; _c < _d.length; _c++) {
                            skill = _d[_c];
                            matches = true;
                            // Filter by capability (substring match, case-insensitive)
                            if (query.capability) {
                                cap = skill.capability.toLowerCase();
                                search = query.capability.toLowerCase();
                                if (!cap.includes(search)) {
                                    matches = false;
                                }
                            }
                            // Filter by max_rate
                            if (query.max_rate !== undefined && skill.rate !== undefined) {
                                if (skill.rate > query.max_rate) {
                                    matches = false;
                                }
                            }
                            // Filter by currency
                            if (query.currency && skill.currency) {
                                if (skill.currency.toLowerCase() !== query.currency.toLowerCase()) {
                                    matches = false;
                                }
                            }
                            if (matches) {
                                results.push(__assign(__assign({ agent_id: registration.agent_id }, skill), { registered_at: registration.registered_at }));
                            }
                        }
                    }
                    uniqueAgentIds = __spreadArray([], new Set(results.map(function (r) { return r.agent_id; })), true);
                    ratingCache = new Map();
                    _e = 0, uniqueAgentIds_1 = uniqueAgentIds;
                    _g.label = 1;
                case 1:
                    if (!(_e < uniqueAgentIds_1.length)) return [3 /*break*/, 4];
                    agentId = uniqueAgentIds_1[_e];
                    return [4 /*yield*/, server.reputationStore.getRating(agentId)];
                case 2:
                    ratingInfo = _g.sent();
                    ratingCache.set(agentId, ratingInfo);
                    _g.label = 3;
                case 3:
                    _e++;
                    return [3 /*break*/, 1];
                case 4:
                    // Add rating info to each result
                    for (_f = 0, results_1 = results; _f < results_1.length; _f++) {
                        result = results_1[_f];
                        ratingInfo = ratingCache.get(result.agent_id);
                        if (ratingInfo) {
                            result.rating = ratingInfo.rating;
                            result.transactions = ratingInfo.transactions;
                        }
                    }
                    // Sort by rating (highest first), then by registration time
                    results.sort(function (a, b) {
                        if ((b.rating || 0) !== (a.rating || 0))
                            return (b.rating || 0) - (a.rating || 0);
                        return b.registered_at - a.registered_at;
                    });
                    limit = query.limit || 50;
                    limitedResults = results.slice(0, limit);
                    server._log('skills_search', { agent: agent.id, query: query, results_count: limitedResults.length });
                    server._send(ws, (0, protocol_js_1.createMessage)(protocol_js_1.ServerMessageType.SEARCH_RESULTS, {
                        query_id: msg.query_id || null,
                        query: query,
                        results: limitedResults,
                        total: results.length
                    }));
                    return [2 /*return*/];
            }
        });
    });
}
