"use strict";
/**
 * AgentChat Docker Deployment Module
 * Generate Docker deployment files for agentchat servers
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
exports.deployToDocker = deployToDocker;
exports.generateDockerfile = generateDockerfile;
var js_yaml_1 = require("js-yaml");
/**
 * Generate docker-compose.yml for self-hosting
 * @param options - Configuration options
 * @returns docker-compose.yml content
 */
function deployToDocker() {
    return __awaiter(this, arguments, void 0, function (options) {
        var config, compose, service;
        var _a;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_b) {
            config = {
                port: options.port || 6667,
                host: options.host || '0.0.0.0',
                name: options.name || 'agentchat',
                logMessages: options.logMessages || false,
                volumes: options.volumes || false,
                tls: options.tls || null,
                network: options.network || null,
                healthCheck: options.healthCheck !== false
            };
            compose = {
                version: '3.8',
                services: {
                    agentchat: {
                        image: 'agentchat:latest',
                        build: '.',
                        container_name: config.name,
                        ports: ["".concat(config.port, ":6667")],
                        environment: [
                            "PORT=6667",
                            "HOST=".concat(config.host),
                            "SERVER_NAME=".concat(config.name),
                            "LOG_MESSAGES=".concat(config.logMessages)
                        ],
                        restart: 'unless-stopped'
                    }
                }
            };
            service = compose.services.agentchat;
            // Add health check
            if (config.healthCheck) {
                service.healthcheck = {
                    test: ['CMD', 'node', '-e',
                        "const ws = new (require('ws'))('ws://localhost:6667'); ws.on('open', () => process.exit(0)); ws.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 5000);"
                    ],
                    interval: '30s',
                    timeout: '10s',
                    retries: 3,
                    start_period: '10s'
                };
            }
            // Add volumes if enabled
            if (config.volumes) {
                service.volumes = service.volumes || [];
                service.volumes.push('agentchat-data:/app/data');
                compose.volumes = { 'agentchat-data': {} };
            }
            // Add TLS certificate mounts
            if (config.tls) {
                service.volumes = service.volumes || [];
                service.volumes.push("".concat(config.tls.cert, ":/app/certs/cert.pem:ro"));
                service.volumes.push("".concat(config.tls.key, ":/app/certs/key.pem:ro"));
                service.environment.push('TLS_CERT=/app/certs/cert.pem');
                service.environment.push('TLS_KEY=/app/certs/key.pem');
            }
            // Add network configuration
            if (config.network) {
                service.networks = [config.network];
                compose.networks = (_a = {},
                    _a[config.network] = {
                        driver: 'bridge'
                    },
                    _a);
            }
            return [2 /*return*/, js_yaml_1.default.dump(compose, {
                    lineWidth: -1,
                    noRefs: true,
                    quotingType: '"'
                })];
        });
    });
}
/**
 * Generate Dockerfile for agentchat server
 * @param options - Configuration options
 * @returns Dockerfile content
 */
function generateDockerfile() {
    return __awaiter(this, arguments, void 0, function (options) {
        var tls;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            tls = options.tls || false;
            return [2 /*return*/, "FROM node:18-alpine\n\nWORKDIR /app\n\n# Install dependencies first for better layer caching\nCOPY package*.json ./\nRUN npm ci --production\n\n# Copy application code\nCOPY . .\n\n# Create data directory for persistence\nRUN mkdir -p /app/data\n\n# Default environment variables\nENV PORT=6667\nENV HOST=0.0.0.0\nENV SERVER_NAME=agentchat\nENV LOG_MESSAGES=false\n".concat(tls ? "ENV TLS_CERT=\"\"\nENV TLS_KEY=\"\"\n" : '', "\nEXPOSE 6667\n\n# Health check\nHEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \\\n  CMD node -e \"const ws = new (require('ws'))('ws://localhost:' + (process.env.PORT || 6667)); ws.on('open', () => process.exit(0)); ws.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 5000);\"\n\n# Start server\nCMD [\"node\", \"dist/bin/agentchat.js\", \"serve\"]\n")];
        });
    });
}
