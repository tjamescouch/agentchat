"use strict";
/**
 * AgentChat Receipts Module
 * Stores and manages COMPLETE receipts for portable reputation
 *
 * Receipts are proof of completed work between agents.
 * They can be exported for reputation aggregation.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptStore = exports.DEFAULT_RECEIPTS_PATH = void 0;
exports.appendReceipt = appendReceipt;
exports.readReceipts = readReceipts;
exports.filterByAgent = filterByAgent;
exports.getCounterparties = getCounterparties;
exports.getStats = getStats;
exports.exportReceipts = exportReceipts;
exports.shouldStoreReceipt = shouldStoreReceipt;
var promises_1 = require("fs/promises");
var path_1 = require("path");
var reputation_js_1 = require("./reputation.js");
// ============ Constants ============
// Default receipts file location
var AGENTCHAT_DIR = path_1.default.join(process.cwd(), '.agentchat');
exports.DEFAULT_RECEIPTS_PATH = path_1.default.join(AGENTCHAT_DIR, 'receipts.jsonl');
// ============ Functions ============
/**
 * Append a receipt to the receipts file
 * @param receipt - The COMPLETE message/receipt to store
 * @param receiptsPath - Path to receipts file
 * @param options - Options
 * @param options.updateRatings - Whether to update ELO ratings (default: true)
 */
function appendReceipt(receipt_1) {
    return __awaiter(this, arguments, void 0, function (receipt, receiptsPath, options) {
        var _a, updateRatings, storedReceipt, line, store, ratingChanges, err_1;
        if (receiptsPath === void 0) { receiptsPath = exports.DEFAULT_RECEIPTS_PATH; }
        if (options === void 0) { options = {}; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = options.updateRatings, updateRatings = _a === void 0 ? true : _a;
                    // Ensure directory exists
                    return [4 /*yield*/, promises_1.default.mkdir(path_1.default.dirname(receiptsPath), { recursive: true })];
                case 1:
                    // Ensure directory exists
                    _b.sent();
                    storedReceipt = __assign(__assign({}, receipt), { stored_at: Date.now() });
                    line = JSON.stringify(storedReceipt) + '\n';
                    return [4 /*yield*/, promises_1.default.appendFile(receiptsPath, line)];
                case 2:
                    _b.sent();
                    if (!updateRatings) return [3 /*break*/, 6];
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, , 6]);
                    store = (0, reputation_js_1.getDefaultStore)();
                    return [4 /*yield*/, store.updateRatings(storedReceipt)];
                case 4:
                    ratingChanges = _b.sent();
                    if (ratingChanges) {
                        storedReceipt._ratingChanges = ratingChanges;
                    }
                    return [3 /*break*/, 6];
                case 5:
                    err_1 = _b.sent();
                    // Log but don't fail receipt storage if rating update fails
                    console.error("Warning: Failed to update ratings: ".concat(err_1.message));
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/, storedReceipt];
            }
        });
    });
}
/**
 * Read all receipts from the receipts file
 * @param receiptsPath - Path to receipts file
 * @returns Array of receipt objects
 */
function readReceipts() {
    return __awaiter(this, arguments, void 0, function (receiptsPath) {
        var content, lines, err_2;
        if (receiptsPath === void 0) { receiptsPath = exports.DEFAULT_RECEIPTS_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.readFile(receiptsPath, 'utf-8')];
                case 1:
                    content = _a.sent();
                    lines = content.trim().split('\n').filter(function (l) { return l.trim(); });
                    return [2 /*return*/, lines.map(function (line) {
                            try {
                                return JSON.parse(line);
                            }
                            catch (_a) {
                                return null;
                            }
                        }).filter(function (r) { return r !== null; })];
                case 2:
                    err_2 = _a.sent();
                    if (err_2.code === 'ENOENT') {
                        return [2 /*return*/, []]; // No receipts file yet
                    }
                    throw err_2;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Filter receipts by agent ID (where agent is a party)
 * @param receipts - Array of receipts
 * @param agentId - Agent ID to filter by
 * @returns Filtered receipts
 */
function filterByAgent(receipts, agentId) {
    var normalizedId = agentId.startsWith('@') ? agentId : "@".concat(agentId);
    return receipts.filter(function (r) {
        var _a, _b;
        return r.from === normalizedId ||
            r.to === normalizedId ||
            r.completed_by === normalizedId ||
            // Also check proposal parties if available
            ((_a = r.proposal) === null || _a === void 0 ? void 0 : _a.from) === normalizedId ||
            ((_b = r.proposal) === null || _b === void 0 ? void 0 : _b.to) === normalizedId;
    });
}
/**
 * Get unique counterparties from receipts
 * @param receipts - Array of receipts
 * @param agentId - Our agent ID
 * @returns Array of unique counterparty IDs
 */
function getCounterparties(receipts, agentId) {
    var _a, _b;
    var normalizedId = agentId.startsWith('@') ? agentId : "@".concat(agentId);
    var counterparties = new Set();
    for (var _i = 0, receipts_1 = receipts; _i < receipts_1.length; _i++) {
        var r = receipts_1[_i];
        // Check from/to fields
        if (r.from && r.from !== normalizedId)
            counterparties.add(r.from);
        if (r.to && r.to !== normalizedId)
            counterparties.add(r.to);
        // Check proposal parties
        if (((_a = r.proposal) === null || _a === void 0 ? void 0 : _a.from) && r.proposal.from !== normalizedId) {
            counterparties.add(r.proposal.from);
        }
        if (((_b = r.proposal) === null || _b === void 0 ? void 0 : _b.to) && r.proposal.to !== normalizedId) {
            counterparties.add(r.proposal.to);
        }
    }
    return Array.from(counterparties);
}
/**
 * Get receipt statistics
 * @param receipts - Array of receipts
 * @param agentId - Optional agent ID for filtering
 * @returns Statistics object
 */
function getStats(receipts, agentId) {
    var _a, _b;
    if (agentId === void 0) { agentId = null; }
    var filtered = receipts;
    if (agentId) {
        filtered = filterByAgent(receipts, agentId);
    }
    if (filtered.length === 0) {
        return {
            count: 0,
            counterparties: [],
            dateRange: null,
            currencies: {}
        };
    }
    // Get date range
    var timestamps = filtered
        .map(function (r) { return r.completed_at || r.ts || r.stored_at; })
        .filter(function (t) { return t !== undefined; })
        .sort(function (a, b) { return a - b; });
    // Count currencies/amounts
    var currencies = {};
    for (var _i = 0, filtered_1 = filtered; _i < filtered_1.length; _i++) {
        var r = filtered_1[_i];
        var currency = ((_a = r.proposal) === null || _a === void 0 ? void 0 : _a.currency) || r.currency || 'unknown';
        var amount = ((_b = r.proposal) === null || _b === void 0 ? void 0 : _b.amount) || r.amount || 0;
        if (!currencies[currency]) {
            currencies[currency] = { count: 0, totalAmount: 0 };
        }
        currencies[currency].count++;
        currencies[currency].totalAmount += amount;
    }
    return {
        count: filtered.length,
        counterparties: agentId ? getCounterparties(filtered, agentId) : [],
        dateRange: timestamps.length > 0 ? {
            oldest: new Date(timestamps[0]).toISOString(),
            newest: new Date(timestamps[timestamps.length - 1]).toISOString()
        } : null,
        currencies: currencies
    };
}
/**
 * Export receipts in specified format
 * @param receipts - Array of receipts
 * @param format - 'json' or 'yaml'
 * @returns Formatted output
 */
function exportReceipts(receipts, format) {
    if (format === void 0) { format = 'json'; }
    if (format === 'yaml') {
        // Simple YAML-like output
        var output = 'receipts:\n';
        for (var _i = 0, receipts_2 = receipts; _i < receipts_2.length; _i++) {
            var r = receipts_2[_i];
            output += "  - proposal_id: ".concat(r.proposal_id || 'unknown', "\n");
            output += "    completed_at: ".concat(r.completed_at ? new Date(r.completed_at).toISOString() : 'unknown', "\n");
            output += "    completed_by: ".concat(r.completed_by || 'unknown', "\n");
            if (r.proof)
                output += "    proof: ".concat(r.proof, "\n");
            if (r.proposal) {
                output += "    proposal:\n";
                output += "      from: ".concat(r.proposal.from, "\n");
                output += "      to: ".concat(r.proposal.to, "\n");
                output += "      task: ".concat(r.proposal.task, "\n");
                if (r.proposal.amount)
                    output += "      amount: ".concat(r.proposal.amount, "\n");
                if (r.proposal.currency)
                    output += "      currency: ".concat(r.proposal.currency, "\n");
            }
            output += '\n';
        }
        return output;
    }
    // Default: JSON
    return JSON.stringify(receipts, null, 2);
}
/**
 * Check if a receipt should be stored (we are a party to it)
 * @param completeMsg - The COMPLETE message
 * @param ourAgentId - Our agent ID
 * @returns boolean
 */
function shouldStoreReceipt(completeMsg, ourAgentId) {
    var _a, _b;
    var normalizedId = ourAgentId.startsWith('@') ? ourAgentId : "@".concat(ourAgentId);
    // Check if we're a party to this completion
    return (completeMsg.from === normalizedId ||
        completeMsg.to === normalizedId ||
        completeMsg.completed_by === normalizedId ||
        ((_a = completeMsg.proposal) === null || _a === void 0 ? void 0 : _a.from) === normalizedId ||
        ((_b = completeMsg.proposal) === null || _b === void 0 ? void 0 : _b.to) === normalizedId);
}
// ============ ReceiptStore Class ============
/**
 * ReceiptStore class for managing receipts
 */
var ReceiptStore = /** @class */ (function () {
    function ReceiptStore(receiptsPath) {
        if (receiptsPath === void 0) { receiptsPath = exports.DEFAULT_RECEIPTS_PATH; }
        this.receiptsPath = receiptsPath;
        this._receipts = null; // Lazy load
    }
    /**
     * Load receipts from file
     */
    ReceiptStore.prototype.load = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = this;
                        return [4 /*yield*/, readReceipts(this.receiptsPath)];
                    case 1:
                        _a._receipts = _b.sent();
                        return [2 /*return*/, this._receipts];
                }
            });
        });
    };
    /**
     * Get all receipts (loads if needed)
     */
    ReceiptStore.prototype.getAll = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this._receipts === null)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.load()];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/, this._receipts];
                }
            });
        });
    };
    /**
     * Add a receipt
     */
    ReceiptStore.prototype.add = function (receipt) {
        return __awaiter(this, void 0, void 0, function () {
            var stored;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, appendReceipt(receipt, this.receiptsPath)];
                    case 1:
                        stored = _a.sent();
                        if (this._receipts !== null) {
                            this._receipts.push(stored);
                        }
                        return [2 /*return*/, stored];
                }
            });
        });
    };
    /**
     * Get receipts for an agent
     */
    ReceiptStore.prototype.getForAgent = function (agentId) {
        return __awaiter(this, void 0, void 0, function () {
            var all;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getAll()];
                    case 1:
                        all = _a.sent();
                        return [2 /*return*/, filterByAgent(all, agentId)];
                }
            });
        });
    };
    /**
     * Get statistics
     */
    ReceiptStore.prototype.getStats = function () {
        return __awaiter(this, arguments, void 0, function (agentId) {
            var all;
            if (agentId === void 0) { agentId = null; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getAll()];
                    case 1:
                        all = _a.sent();
                        return [2 /*return*/, getStats(all, agentId)];
                }
            });
        });
    };
    /**
     * Export receipts
     */
    ReceiptStore.prototype.export = function () {
        return __awaiter(this, arguments, void 0, function (format, agentId) {
            var receipts;
            if (format === void 0) { format = 'json'; }
            if (agentId === void 0) { agentId = null; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getAll()];
                    case 1:
                        receipts = _a.sent();
                        if (agentId) {
                            receipts = filterByAgent(receipts, agentId);
                        }
                        return [2 /*return*/, exportReceipts(receipts, format)];
                }
            });
        });
    };
    return ReceiptStore;
}());
exports.ReceiptStore = ReceiptStore;
