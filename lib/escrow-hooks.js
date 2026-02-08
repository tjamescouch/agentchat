"use strict";
/**
 * EscrowHooks - Event system for external escrow integration
 *
 * Allows external systems (blockchain, multi-sig, compliance) to hook into
 * escrow lifecycle events without modifying core AgentChat code.
 *
 * Events:
 *   escrow:created    - Escrow created when proposal accepted with stakes
 *   escrow:released   - Escrow released (expired, cancelled)
 *   settlement:completion - Proposal completed, stakes returned
 *   settlement:dispute    - Proposal disputed, stakes transferred/burned
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
exports.EscrowHooks = exports.EscrowEvent = void 0;
exports.createEscrowCreatedPayload = createEscrowCreatedPayload;
exports.createCompletionPayload = createCompletionPayload;
exports.createDisputePayload = createDisputePayload;
exports.createEscrowReleasedPayload = createEscrowReleasedPayload;
exports.EscrowEvent = {
    CREATED: 'escrow:created',
    RELEASED: 'escrow:released',
    COMPLETION_SETTLED: 'settlement:completion',
    DISPUTE_SETTLED: 'settlement:dispute',
    VERDICT_SETTLED: 'settlement:verdict'
};
var EscrowHooks = /** @class */ (function () {
    function EscrowHooks(options) {
        if (options === void 0) { options = {}; }
        this.handlers = new Map();
        this.logger = options.logger || console;
        this.continueOnError = options.continueOnError !== false; // default true
        // Initialize event handler sets
        for (var _i = 0, _a = Object.values(exports.EscrowEvent); _i < _a.length; _i++) {
            var event_1 = _a[_i];
            this.handlers.set(event_1, new Set());
        }
    }
    /**
     * Register a handler for an escrow event
     * @param event - Event name from EscrowEvent
     * @param handler - Async function(payload) to call
     * @returns Unsubscribe function
     */
    EscrowHooks.prototype.on = function (event, handler) {
        var _this = this;
        if (!this.handlers.has(event)) {
            throw new Error("Unknown escrow event: ".concat(event));
        }
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }
        this.handlers.get(event).add(handler);
        // Return unsubscribe function
        return function () { return _this.off(event, handler); };
    };
    /**
     * Remove a handler for an escrow event
     * @param event - Event name
     * @param handler - Handler to remove
     */
    EscrowHooks.prototype.off = function (event, handler) {
        if (this.handlers.has(event)) {
            this.handlers.get(event).delete(handler);
        }
    };
    /**
     * Remove all handlers for an event (or all events)
     * @param event - Optional event name
     */
    EscrowHooks.prototype.clear = function (event) {
        if (event) {
            if (this.handlers.has(event)) {
                this.handlers.get(event).clear();
            }
        }
        else {
            for (var _i = 0, _a = this.handlers.values(); _i < _a.length; _i++) {
                var handlers = _a[_i];
                handlers.clear();
            }
        }
    };
    /**
     * Emit an escrow event to all registered handlers
     * @param event - Event name
     * @param payload - Event payload
     * @returns Results from all handlers
     */
    EscrowHooks.prototype.emit = function (event, payload) {
        return __awaiter(this, void 0, void 0, function () {
            var handlers, results, errors, _i, handlers_1, handler, result, err_1, error, errorInfo;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!this.handlers.has(event)) {
                            throw new Error("Unknown escrow event: ".concat(event));
                        }
                        handlers = this.handlers.get(event);
                        if (handlers.size === 0) {
                            return [2 /*return*/, { event: event, handled: false, results: [] }];
                        }
                        results = [];
                        errors = [];
                        _i = 0, handlers_1 = handlers;
                        _c.label = 1;
                    case 1:
                        if (!(_i < handlers_1.length)) return [3 /*break*/, 6];
                        handler = handlers_1[_i];
                        _c.label = 2;
                    case 2:
                        _c.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, handler(payload)];
                    case 3:
                        result = _c.sent();
                        results.push({ success: true, result: result });
                        return [3 /*break*/, 5];
                    case 4:
                        err_1 = _c.sent();
                        error = err_1;
                        errorInfo = {
                            success: false,
                            error: error.message,
                            stack: error.stack
                        };
                        errors.push(errorInfo);
                        results.push(errorInfo);
                        (_b = (_a = this.logger).error) === null || _b === void 0 ? void 0 : _b.call(_a, "[EscrowHooks] Error in ".concat(event, " handler:"), error.message);
                        if (!this.continueOnError) {
                            return [3 /*break*/, 6];
                        }
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, {
                            event: event,
                            handled: true,
                            results: results,
                            errors: errors.length > 0 ? errors : undefined
                        }];
                }
            });
        });
    };
    /**
     * Check if any handlers are registered for an event
     * @param event - Event name
     * @returns True if handlers exist
     */
    EscrowHooks.prototype.hasHandlers = function (event) {
        return this.handlers.has(event) && this.handlers.get(event).size > 0;
    };
    /**
     * Get count of handlers for an event
     * @param event - Event name
     * @returns Number of handlers
     */
    EscrowHooks.prototype.handlerCount = function (event) {
        return this.handlers.has(event) ? this.handlers.get(event).size : 0;
    };
    return EscrowHooks;
}());
exports.EscrowHooks = EscrowHooks;
/**
 * Create payload for escrow:created event
 */
function createEscrowCreatedPayload(proposal, escrowResult) {
    var _a;
    return {
        event: exports.EscrowEvent.CREATED,
        timestamp: Date.now(),
        proposal_id: proposal.id,
        from_agent: proposal.from,
        to_agent: proposal.to,
        proposer_stake: proposal.proposer_stake || 0,
        acceptor_stake: proposal.acceptor_stake || 0,
        total_stake: (proposal.proposer_stake || 0) + (proposal.acceptor_stake || 0),
        task: proposal.task,
        amount: proposal.amount,
        currency: proposal.currency,
        expires: proposal.expires,
        escrow_id: ((_a = escrowResult.escrow) === null || _a === void 0 ? void 0 : _a.proposal_id) || proposal.id
    };
}
/**
 * Create payload for settlement:completion event
 */
function createCompletionPayload(proposal, ratingChanges) {
    var _a;
    var escrowInfo = (ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow) || {};
    return {
        event: exports.EscrowEvent.COMPLETION_SETTLED,
        timestamp: Date.now(),
        proposal_id: proposal.id,
        from_agent: proposal.from,
        to_agent: proposal.to,
        completed_by: proposal.completed_by,
        completion_proof: proposal.completion_proof,
        settlement: 'returned',
        stakes_returned: {
            proposer: escrowInfo.proposer_stake || 0,
            acceptor: escrowInfo.acceptor_stake || 0
        },
        rating_changes: (_a = {},
            _a[proposal.from] = ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges[proposal.from],
            _a[proposal.to] = ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges[proposal.to],
            _a)
    };
}
/**
 * Create payload for settlement:dispute event
 */
function createDisputePayload(proposal, ratingChanges) {
    var _a;
    var escrowInfo = (ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges._escrow) || {};
    return {
        event: exports.EscrowEvent.DISPUTE_SETTLED,
        timestamp: Date.now(),
        proposal_id: proposal.id,
        from_agent: proposal.from,
        to_agent: proposal.to,
        disputed_by: proposal.disputed_by,
        dispute_reason: proposal.dispute_reason,
        settlement: escrowInfo.settlement || 'settled',
        settlement_reason: escrowInfo.settlement_reason,
        fault_determination: escrowInfo.fault_party,
        stakes_transferred: escrowInfo.transferred,
        stakes_burned: escrowInfo.burned,
        rating_changes: (_a = {},
            _a[proposal.from] = ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges[proposal.from],
            _a[proposal.to] = ratingChanges === null || ratingChanges === void 0 ? void 0 : ratingChanges[proposal.to],
            _a)
    };
}
/**
 * Create payload for escrow:released event
 */
function createEscrowReleasedPayload(proposalId, escrow, reason) {
    var _a, _b, _c, _d;
    return {
        event: exports.EscrowEvent.RELEASED,
        timestamp: Date.now(),
        proposal_id: proposalId,
        from_agent: (_a = escrow.from) === null || _a === void 0 ? void 0 : _a.agent_id,
        to_agent: (_b = escrow.to) === null || _b === void 0 ? void 0 : _b.agent_id,
        stakes_released: {
            proposer: ((_c = escrow.from) === null || _c === void 0 ? void 0 : _c.stake) || 0,
            acceptor: ((_d = escrow.to) === null || _d === void 0 ? void 0 : _d.stake) || 0
        },
        reason: reason || 'expired'
    };
}
exports.default = EscrowHooks;
