"use strict";
/**
 * Secret Redactor — vendored from agentseenoevil (github.com/tjamescouch/agentseenoevil)
 *
 * Scans text for API keys, tokens, and secrets and replaces them with [REDACTED].
 * Used as mandatory input sanitization in the message pipeline.
 */
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
exports.Redactor = exports.BUILTIN_PATTERNS = void 0;
exports.BUILTIN_PATTERNS = [
    { name: 'anthropic_api_key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
    { name: 'openai_api_key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
    { name: 'github_pat', pattern: /ghp_[a-zA-Z0-9]{36}/ },
    { name: 'github_pat_fine', pattern: /github_pat_[a-zA-Z0-9_]{22,}/ },
    { name: 'github_oauth', pattern: /gho_[a-zA-Z0-9]{36}/ },
    { name: 'aws_access_key', pattern: /AKIA[A-Z0-9]{16}/ },
    { name: 'aws_secret_key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)['"=:\s]+([A-Za-z0-9/+=]{40})/ },
    { name: 'slack_token', pattern: /xox[bpaors]-[a-zA-Z0-9-]{10,}/ },
    { name: 'stripe_key', pattern: /[sr]k_(live|test)_[a-zA-Z0-9]{20,}/ },
    { name: 'google_api_key', pattern: /AIza[a-zA-Z0-9_-]{35}/ },
    { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
    { name: 'generic_secret', pattern: /(?:api_key|apikey|secret|token|password|credential|auth)['"]?\s*[:=]\s*['"]([a-zA-Z0-9_\-/+=]{16,})['"]/ },
];
var SECRET_ENV_KEY_PATTERNS = [
    /_KEY$/i, /_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i,
    /_CREDENTIAL$/i, /_API_KEY$/i, /^API_KEY$/i, /^SECRET$/i,
    /^TOKEN$/i, /^PASSWORD$/i, /^AUTH/i, /_AUTH$/i,
];
var Redactor = /** @class */ (function () {
    function Redactor(opts) {
        var _a, _b;
        if (opts === void 0) { opts = {}; }
        this.replacement = opts.replacement || '[REDACTED]';
        this.labelRedactions = opts.labelRedactions || false;
        this.minEnvValueLength = opts.minEnvValueLength || 8;
        this.patterns = [];
        if (opts.builtins !== false) {
            (_a = this.patterns).push.apply(_a, exports.BUILTIN_PATTERNS);
        }
        if (opts.patterns) {
            (_b = this.patterns).push.apply(_b, opts.patterns);
        }
        this.envValues = new Map();
        if (opts.scanEnv) {
            this.loadEnvSecrets(opts.envKeyPatterns);
        }
    }
    Redactor.prototype.loadEnvSecrets = function (extraPatterns) {
        var keyPatterns = __spreadArray([], SECRET_ENV_KEY_PATTERNS, true);
        if (extraPatterns) {
            keyPatterns.push.apply(keyPatterns, extraPatterns);
        }
        var _loop_1 = function (key, value) {
            if (!value || value.length < this_1.minEnvValueLength)
                return "continue";
            var isSecret = keyPatterns.some(function (p) { return p.test(key); });
            if (isSecret) {
                this_1.envValues.set(value, key);
            }
        };
        var this_1 = this;
        for (var _i = 0, _a = Object.entries(process.env); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            _loop_1(key, value);
        }
    };
    Redactor.prototype.redact = function (input) {
        var text = input;
        var count = 0;
        var matched = [];
        for (var _i = 0, _a = this.patterns; _i < _a.length; _i++) {
            var _b = _a[_i], name_1 = _b.name, pattern = _b.pattern;
            var globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
            var matches = text.match(globalPattern);
            if (matches) {
                var rep = this.labelRedactions ? "[REDACTED:".concat(name_1, "]") : this.replacement;
                text = text.replace(globalPattern, rep);
                count += matches.length;
                if (!matched.includes(name_1))
                    matched.push(name_1);
            }
        }
        var sortedEnvValues = __spreadArray([], this.envValues.entries(), true).sort(function (a, b) { return b[0].length - a[0].length; });
        for (var _c = 0, sortedEnvValues_1 = sortedEnvValues; _c < sortedEnvValues_1.length; _c++) {
            var _d = sortedEnvValues_1[_c], value = _d[0], envKey = _d[1];
            if (text.includes(value)) {
                var rep = this.labelRedactions ? "[REDACTED:env:".concat(envKey, "]") : this.replacement;
                var escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var re = new RegExp(escaped, 'g');
                var matches = text.match(re);
                if (matches) {
                    text = text.replace(re, rep);
                    count += matches.length;
                    var label = "env:".concat(envKey);
                    if (!matched.includes(label))
                        matched.push(label);
                }
            }
        }
        return { text: text, count: count, matched: matched };
    };
    Redactor.prototype.clean = function (input) {
        return this.redact(input).text;
    };
    Redactor.prototype.hasSecrets = function (input) {
        return this.redact(input).count > 0;
    };
    return Redactor;
}());
exports.Redactor = Redactor;
