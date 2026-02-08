"use strict";
/**
 * AgentChat Deploy Configuration
 * Parser for deploy.yaml configuration files
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
exports.DEFAULT_CONFIG = void 0;
exports.loadConfig = loadConfig;
exports.validateConfig = validateConfig;
exports.generateExampleConfig = generateExampleConfig;
var promises_1 = require("fs/promises");
var js_yaml_1 = require("js-yaml");
/**
 * Default configuration values
 */
exports.DEFAULT_CONFIG = {
    provider: 'docker',
    port: 6667,
    host: '0.0.0.0',
    name: 'agentchat',
    logMessages: false,
    volumes: false,
    healthCheck: true,
    tls: null,
    network: null
};
/**
 * Load and parse deploy.yaml configuration
 * @param configPath - Path to configuration file
 * @returns Validated configuration object
 */
function loadConfig(configPath) {
    return __awaiter(this, void 0, void 0, function () {
        var content, parsed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, promises_1.default.readFile(configPath, 'utf-8')];
                case 1:
                    content = _a.sent();
                    parsed = js_yaml_1.default.load(content);
                    return [2 /*return*/, validateConfig(parsed)];
            }
        });
    });
}
/**
 * Validate configuration object
 * @param config - Raw configuration object
 * @returns Validated and merged configuration
 * @throws Error if configuration is invalid
 */
function validateConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('Configuration must be an object');
    }
    var rawConfig = config;
    var result = __assign(__assign({}, exports.DEFAULT_CONFIG), rawConfig);
    // Validate provider
    if (!['docker', 'akash'].includes(result.provider)) {
        throw new Error("Invalid provider: ".concat(result.provider, ". Must be 'docker' or 'akash'"));
    }
    // Validate port
    var port = parseInt(String(result.port));
    if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error("Invalid port: ".concat(result.port, ". Must be between 1 and 65535"));
    }
    result.port = port;
    // Validate host
    if (typeof result.host !== 'string' || result.host.length === 0) {
        throw new Error('Invalid host: must be a non-empty string');
    }
    // Validate name
    if (typeof result.name !== 'string' || result.name.length === 0) {
        throw new Error('Invalid name: must be a non-empty string');
    }
    // Docker container name must be alphanumeric with dashes/underscores
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result.name)) {
        throw new Error('Invalid name: must start with alphanumeric and contain only alphanumeric, dash, underscore');
    }
    // Validate TLS config
    if (result.tls) {
        if (typeof result.tls !== 'object') {
            throw new Error('TLS config must be an object with cert and key paths');
        }
        if (!result.tls.cert || typeof result.tls.cert !== 'string') {
            throw new Error('TLS config must include cert path');
        }
        if (!result.tls.key || typeof result.tls.key !== 'string') {
            throw new Error('TLS config must include key path');
        }
    }
    // Validate network
    if (result.network !== null && typeof result.network !== 'string') {
        throw new Error('Network must be a string or null');
    }
    // Ensure booleans
    result.logMessages = Boolean(result.logMessages);
    result.volumes = Boolean(result.volumes);
    result.healthCheck = result.healthCheck !== false;
    return result;
}
/**
 * Generate example deploy.yaml content
 * @returns Example YAML configuration
 */
function generateExampleConfig() {
    return "# AgentChat deployment configuration\nprovider: docker\nport: 6667\nhost: 0.0.0.0\nname: agentchat\n\n# Enable data persistence volumes\nvolumes: false\n\n# Health check (default: true)\nhealthCheck: true\n\n# Logging (default: false)\nlogMessages: false\n\n# TLS configuration (optional)\n# tls:\n#   cert: ./certs/cert.pem\n#   key: ./certs/key.pem\n\n# Docker network (optional)\n# network: agentchat-net\n";
}
