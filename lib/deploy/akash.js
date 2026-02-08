"use strict";
/**
 * Akash Network Deployment Module
 *
 * Enables self-service deployment to Akash decentralized cloud.
 *
 * DISCLAIMER: This is infrastructure tooling, not a cryptocurrency product.
 * AKT tokens are used solely to pay for compute resources.
 * You are responsible for your own wallet security and funds.
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
exports.AkashClient = exports.AkashWallet = exports.NETWORKS = exports.CERTIFICATE_PATH = exports.DEPLOYMENTS_PATH = exports.WALLET_PATH = void 0;
exports.generateSDL = generateSDL;
exports.generateWallet = generateWallet;
exports.checkBalance = checkBalance;
exports.createDeployment = createDeployment;
exports.listDeployments = listDeployments;
exports.closeDeployment = closeDeployment;
exports.acceptBid = acceptBid;
exports.queryBids = queryBids;
exports.getDeploymentStatus = getDeploymentStatus;
var promises_1 = require("fs/promises");
var path_1 = require("path");
var js_yaml_1 = require("js-yaml");
// ============ Constants ============
// Default paths
var AKASH_DIR = path_1.default.join(process.cwd(), '.agentchat');
exports.WALLET_PATH = path_1.default.join(AKASH_DIR, 'akash-wallet.json');
exports.DEPLOYMENTS_PATH = path_1.default.join(AKASH_DIR, 'akash-deployments.json');
exports.CERTIFICATE_PATH = path_1.default.join(AKASH_DIR, 'akash-cert.json');
// Network configuration
exports.NETWORKS = {
    mainnet: {
        chainId: 'akashnet-2',
        rpcEndpoint: 'https://rpc.akashnet.net:443',
        restEndpoint: 'https://api.akashnet.net:443',
        prefix: 'akash'
    },
    testnet: {
        chainId: 'sandbox-01',
        rpcEndpoint: 'https://rpc.sandbox-01.aksh.pw:443',
        restEndpoint: 'https://api.sandbox-01.aksh.pw:443',
        prefix: 'akash'
    }
};
// Default deposit amount (5 AKT in uakt)
var DEFAULT_DEPOSIT = '5000000';
// ============ AkashWallet Class ============
/**
 * Akash Wallet - manages keypair and signing
 */
var AkashWallet = /** @class */ (function () {
    function AkashWallet(data) {
        this.mnemonic = data.mnemonic;
        this.address = data.address;
        this.pubkey = data.pubkey;
        this.network = data.network || 'testnet';
        this.created = data.created || new Date().toISOString();
    }
    /**
     * Generate a new wallet
     */
    AkashWallet.generate = function () {
        return __awaiter(this, arguments, void 0, function (network) {
            var DirectSecp256k1HdWallet, wallet, account;
            if (network === void 0) { network = 'testnet'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/proto-signing'); })];
                    case 1:
                        DirectSecp256k1HdWallet = (_a.sent()).DirectSecp256k1HdWallet;
                        return [4 /*yield*/, DirectSecp256k1HdWallet.generate(24, {
                                prefix: exports.NETWORKS[network].prefix
                            })];
                    case 2:
                        wallet = _a.sent();
                        return [4 /*yield*/, wallet.getAccounts()];
                    case 3:
                        account = (_a.sent())[0];
                        return [2 /*return*/, new AkashWallet({
                                mnemonic: wallet.mnemonic,
                                address: account.address,
                                pubkey: Buffer.from(account.pubkey).toString('base64'),
                                network: network,
                                created: new Date().toISOString()
                            })];
                }
            });
        });
    };
    /**
     * Load wallet from mnemonic
     */
    AkashWallet.fromMnemonic = function (mnemonic_1) {
        return __awaiter(this, arguments, void 0, function (mnemonic, network) {
            var DirectSecp256k1HdWallet, wallet, account;
            if (network === void 0) { network = 'testnet'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/proto-signing'); })];
                    case 1:
                        DirectSecp256k1HdWallet = (_a.sent()).DirectSecp256k1HdWallet;
                        return [4 /*yield*/, DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
                                prefix: exports.NETWORKS[network].prefix
                            })];
                    case 2:
                        wallet = _a.sent();
                        return [4 /*yield*/, wallet.getAccounts()];
                    case 3:
                        account = (_a.sent())[0];
                        return [2 /*return*/, new AkashWallet({
                                mnemonic: mnemonic,
                                address: account.address,
                                pubkey: Buffer.from(account.pubkey).toString('base64'),
                                network: network
                            })];
                }
            });
        });
    };
    /**
     * Get signing wallet instance
     */
    AkashWallet.prototype.getSigningWallet = function () {
        return __awaiter(this, void 0, void 0, function () {
            var DirectSecp256k1HdWallet;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/proto-signing'); })];
                    case 1:
                        DirectSecp256k1HdWallet = (_a.sent()).DirectSecp256k1HdWallet;
                        return [2 /*return*/, DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic, {
                                prefix: exports.NETWORKS[this.network].prefix
                            })];
                }
            });
        });
    };
    /**
     * Save wallet to file
     */
    AkashWallet.prototype.save = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var data;
            if (filePath === void 0) { filePath = exports.WALLET_PATH; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, promises_1.default.mkdir(path_1.default.dirname(filePath), { recursive: true })];
                    case 1:
                        _a.sent();
                        data = {
                            version: 1,
                            network: this.network,
                            address: this.address,
                            pubkey: this.pubkey,
                            mnemonic: this.mnemonic,
                            created: this.created
                        };
                        return [4 /*yield*/, promises_1.default.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 384 })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, filePath];
                }
            });
        });
    };
    /**
     * Load wallet from file
     */
    AkashWallet.load = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var content, data;
            if (filePath === void 0) { filePath = exports.WALLET_PATH; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, promises_1.default.readFile(filePath, 'utf-8')];
                    case 1:
                        content = _a.sent();
                        data = JSON.parse(content);
                        if (data.version !== 1) {
                            throw new Error("Unsupported wallet version: ".concat(data.version));
                        }
                        return [2 /*return*/, new AkashWallet(data)];
                }
            });
        });
    };
    /**
     * Check if wallet file exists
     */
    AkashWallet.exists = function () {
        return __awaiter(this, arguments, void 0, function (filePath) {
            var _a;
            if (filePath === void 0) { filePath = exports.WALLET_PATH; }
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
     * Get wallet info for display (no sensitive data)
     */
    AkashWallet.prototype.getInfo = function () {
        return {
            address: this.address,
            network: this.network,
            created: this.created
        };
    };
    return AkashWallet;
}());
exports.AkashWallet = AkashWallet;
// ============ SDL Generation ============
/**
 * Generate SDL (Stack Definition Language) for agentchat server
 */
function generateSDL(options) {
    if (options === void 0) { options = {}; }
    var config = {
        name: options.name || 'agentchat',
        port: options.port || 6667,
        cpu: options.cpu || 0.5,
        memory: options.memory || 512,
        storage: options.storage || 1,
        logMessages: options.logMessages || false
    };
    var sdl = {
        version: '2.0',
        services: {
            agentchat: {
                image: options.image || 'ghcr.io/anthropics/agentchat:latest',
                expose: [
                    {
                        port: config.port,
                        as: 80,
                        to: [{ global: true }]
                    }
                ],
                env: [
                    "PORT=".concat(config.port),
                    'HOST=0.0.0.0',
                    "SERVER_NAME=".concat(config.name),
                    "LOG_MESSAGES=".concat(config.logMessages)
                ]
            }
        },
        profiles: {
            compute: {
                agentchat: {
                    resources: {
                        cpu: { units: config.cpu },
                        memory: { size: "".concat(config.memory, "Mi") },
                        storage: { size: "".concat(config.storage, "Gi") }
                    }
                }
            },
            placement: {
                dcloud: {
                    pricing: {
                        agentchat: {
                            denom: 'uakt',
                            amount: 1000
                        }
                    }
                }
            }
        },
        deployment: {
            agentchat: {
                dcloud: {
                    profile: 'agentchat',
                    count: 1
                }
            }
        }
    };
    return js_yaml_1.default.dump(sdl, { lineWidth: -1 });
}
// ============ AkashClient Class ============
/**
 * Akash deployment client
 */
var AkashClient = /** @class */ (function () {
    function AkashClient(wallet) {
        this.wallet = wallet;
        this.network = exports.NETWORKS[wallet.network];
    }
    /**
     * Get signing client for transactions
     */
    AkashClient.prototype.getSigningClient = function () {
        return __awaiter(this, void 0, void 0, function () {
            var SigningStargateClient, getAkashTypeRegistry, Registry, signingWallet, registry;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/stargate'); })];
                    case 1:
                        SigningStargateClient = (_a.sent()).SigningStargateClient;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/stargate/index.js'); })];
                    case 2:
                        getAkashTypeRegistry = (_a.sent()).getAkashTypeRegistry;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/proto-signing'); })];
                    case 3:
                        Registry = (_a.sent()).Registry;
                        return [4 /*yield*/, this.wallet.getSigningWallet()];
                    case 4:
                        signingWallet = _a.sent();
                        registry = new Registry(getAkashTypeRegistry());
                        return [2 /*return*/, SigningStargateClient.connectWithSigner(this.network.rpcEndpoint, signingWallet, { registry: registry })];
                }
            });
        });
    };
    /**
     * Query account balance
     */
    AkashClient.prototype.getBalance = function () {
        return __awaiter(this, void 0, void 0, function () {
            var StargateClient, client, err_1, balance, akt;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@cosmjs/stargate'); })];
                    case 1:
                        StargateClient = (_a.sent()).StargateClient;
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, StargateClient.connect(this.network.rpcEndpoint)];
                    case 3:
                        client = _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        err_1 = _a.sent();
                        throw new Error("Failed to connect to ".concat(this.wallet.network, " RPC endpoint.\n") +
                            "Network: ".concat(this.network.rpcEndpoint, "\n") +
                            "The network may be temporarily unavailable. Try again later.");
                    case 5: return [4 /*yield*/, client.getBalance(this.wallet.address, 'uakt')];
                    case 6:
                        balance = _a.sent();
                        akt = parseInt(balance.amount) / 1000000;
                        return [2 /*return*/, {
                                uakt: balance.amount,
                                akt: akt.toFixed(6),
                                sufficient: parseInt(balance.amount) >= 5000000
                            }];
                }
            });
        });
    };
    /**
     * Create a deployment on Akash
     */
    AkashClient.prototype.createDeployment = function (sdlContent_1) {
        return __awaiter(this, arguments, void 0, function (sdlContent, options) {
            var SDL, MsgCreateDeployment, Message, sdl, client, blockHeight, dseq, groups, manifestVersion, deploymentMsg, msg, fee, tx;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/sdl/SDL/SDL.js'); })];
                    case 1:
                        SDL = (_a.sent()).SDL;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akash-api/v1beta3'); })];
                    case 2:
                        MsgCreateDeployment = (_a.sent()).MsgCreateDeployment;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/stargate/index.js'); })];
                    case 3:
                        Message = (_a.sent()).Message;
                        sdl = SDL.fromString(sdlContent, 'beta3');
                        return [4 /*yield*/, this.getSigningClient()];
                    case 4:
                        client = _a.sent();
                        return [4 /*yield*/, client.getHeight()];
                    case 5:
                        blockHeight = _a.sent();
                        dseq = options.dseq || blockHeight.toString();
                        groups = sdl.groups();
                        return [4 /*yield*/, sdl.manifestVersion()];
                    case 6:
                        manifestVersion = _a.sent();
                        deploymentMsg = {
                            id: {
                                owner: this.wallet.address,
                                dseq: dseq
                            },
                            groups: groups,
                            deposit: {
                                denom: 'uakt',
                                amount: options.deposit || DEFAULT_DEPOSIT
                            },
                            version: manifestVersion,
                            depositor: this.wallet.address
                        };
                        msg = {
                            typeUrl: Message.MsgCreateDeployment,
                            value: MsgCreateDeployment.fromPartial(deploymentMsg)
                        };
                        fee = {
                            amount: [{ denom: 'uakt', amount: '25000' }],
                            gas: '500000'
                        };
                        console.log('Broadcasting deployment transaction...');
                        return [4 /*yield*/, client.signAndBroadcast(this.wallet.address, [msg], fee, 'agentchat deployment')];
                    case 7:
                        tx = _a.sent();
                        if (tx.code !== 0) {
                            throw new Error("Deployment failed: ".concat(tx.rawLog));
                        }
                        console.log("Deployment created: dseq=".concat(dseq, ", tx=").concat(tx.transactionHash));
                        // Save deployment record
                        return [4 /*yield*/, this.saveDeployment({
                                dseq: dseq,
                                owner: this.wallet.address,
                                txHash: tx.transactionHash,
                                status: 'pending_bids',
                                createdAt: new Date().toISOString(),
                                sdl: sdlContent
                            })];
                    case 8:
                        // Save deployment record
                        _a.sent();
                        return [2 /*return*/, {
                                dseq: dseq,
                                txHash: tx.transactionHash,
                                status: 'pending_bids',
                                manifest: sdl.manifest()
                            }];
                }
            });
        });
    };
    /**
     * Query bids for a deployment
     */
    AkashClient.prototype.queryBids = function (dseq) {
        return __awaiter(this, void 0, void 0, function () {
            var url, response, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        url = "".concat(this.network.restEndpoint, "/akash/market/v1beta4/bids/list?filters.owner=").concat(this.wallet.address, "&filters.dseq=").concat(dseq);
                        return [4 /*yield*/, fetch(url)];
                    case 1:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Failed to query bids: ".concat(response.statusText));
                        }
                        return [4 /*yield*/, response.json()];
                    case 2:
                        data = _a.sent();
                        return [2 /*return*/, data.bids || []];
                }
            });
        });
    };
    /**
     * Accept a bid and create a lease
     */
    AkashClient.prototype.createLease = function (dseq_1, provider_1) {
        return __awaiter(this, arguments, void 0, function (dseq, provider, gseq, oseq) {
            var MsgCreateLease, Message, client, leaseMsg, msg, fee, tx;
            if (gseq === void 0) { gseq = 1; }
            if (oseq === void 0) { oseq = 1; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akash-api/v1beta3'); })];
                    case 1:
                        MsgCreateLease = (_a.sent()).MsgCreateLease;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/stargate/index.js'); })];
                    case 2:
                        Message = (_a.sent()).Message;
                        return [4 /*yield*/, this.getSigningClient()];
                    case 3:
                        client = _a.sent();
                        leaseMsg = {
                            bidId: {
                                owner: this.wallet.address,
                                dseq: dseq,
                                gseq: gseq,
                                oseq: oseq,
                                provider: provider
                            }
                        };
                        msg = {
                            typeUrl: Message.MsgCreateLease,
                            value: MsgCreateLease.fromPartial(leaseMsg)
                        };
                        fee = {
                            amount: [{ denom: 'uakt', amount: '25000' }],
                            gas: '500000'
                        };
                        console.log('Creating lease...');
                        return [4 /*yield*/, client.signAndBroadcast(this.wallet.address, [msg], fee, 'create lease')];
                    case 4:
                        tx = _a.sent();
                        if (tx.code !== 0) {
                            throw new Error("Lease creation failed: ".concat(tx.rawLog));
                        }
                        console.log("Lease created: provider=".concat(provider, ", tx=").concat(tx.transactionHash));
                        // Update deployment record
                        return [4 /*yield*/, this.updateDeployment(dseq, {
                                status: 'active',
                                provider: provider,
                                leaseCreatedAt: new Date().toISOString()
                            })];
                    case 5:
                        // Update deployment record
                        _a.sent();
                        return [2 /*return*/, {
                                dseq: dseq,
                                provider: provider,
                                gseq: gseq,
                                oseq: oseq,
                                txHash: tx.transactionHash
                            }];
                }
            });
        });
    };
    /**
     * Send manifest to provider
     */
    AkashClient.prototype.sendManifest = function (dseq, provider, manifest) {
        return __awaiter(this, void 0, void 0, function () {
            var certificateModule, cert, certData, _a, generated, providerUrl, providerResponse, providerInfo, hostUri, manifestUrl, response, text;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/certificates/index.js'); })];
                    case 1:
                        certificateModule = _c.sent();
                        _c.label = 2;
                    case 2:
                        _c.trys.push([2, 4, , 7]);
                        return [4 /*yield*/, promises_1.default.readFile(exports.CERTIFICATE_PATH, 'utf-8')];
                    case 3:
                        certData = _c.sent();
                        cert = JSON.parse(certData);
                        return [3 /*break*/, 7];
                    case 4:
                        _a = _c.sent();
                        // Generate new certificate
                        console.log('Generating deployment certificate...');
                        return [4 /*yield*/, certificateModule.createCertificate(this.wallet.address)];
                    case 5:
                        generated = _c.sent();
                        cert = {
                            cert: generated.cert,
                            privateKey: generated.privateKey,
                            publicKey: generated.publicKey
                        };
                        return [4 /*yield*/, promises_1.default.writeFile(exports.CERTIFICATE_PATH, JSON.stringify(cert, null, 2), { mode: 384 })];
                    case 6:
                        _c.sent();
                        return [3 /*break*/, 7];
                    case 7:
                        providerUrl = "".concat(this.network.restEndpoint, "/akash/provider/v1beta3/providers/").concat(provider);
                        return [4 /*yield*/, fetch(providerUrl)];
                    case 8:
                        providerResponse = _c.sent();
                        if (!providerResponse.ok) {
                            throw new Error("Failed to get provider info: ".concat(providerResponse.statusText));
                        }
                        return [4 /*yield*/, providerResponse.json()];
                    case 9:
                        providerInfo = _c.sent();
                        hostUri = (_b = providerInfo.provider) === null || _b === void 0 ? void 0 : _b.hostUri;
                        if (!hostUri) {
                            throw new Error('Provider hostUri not found');
                        }
                        manifestUrl = "".concat(hostUri, "/deployment/").concat(dseq, "/manifest");
                        console.log("Sending manifest to ".concat(manifestUrl, "..."));
                        return [4 /*yield*/, fetch(manifestUrl, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(manifest)
                            })];
                    case 10:
                        response = _c.sent();
                        if (!!response.ok) return [3 /*break*/, 12];
                        return [4 /*yield*/, response.text()];
                    case 11:
                        text = _c.sent();
                        throw new Error("Failed to send manifest: ".concat(response.statusText, " - ").concat(text));
                    case 12:
                        console.log('Manifest sent successfully');
                        // Update deployment record
                        return [4 /*yield*/, this.updateDeployment(dseq, {
                                manifestSent: true,
                                manifestSentAt: new Date().toISOString()
                            })];
                    case 13:
                        // Update deployment record
                        _c.sent();
                        return [2 /*return*/, { success: true }];
                }
            });
        });
    };
    /**
     * Get lease status from provider
     */
    AkashClient.prototype.getLeaseStatus = function (dseq_1, provider_1) {
        return __awaiter(this, arguments, void 0, function (dseq, provider, gseq, oseq) {
            var providerUrl, providerResponse, providerInfo, hostUri, statusUrl, response;
            var _a;
            if (gseq === void 0) { gseq = 1; }
            if (oseq === void 0) { oseq = 1; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        providerUrl = "".concat(this.network.restEndpoint, "/akash/provider/v1beta3/providers/").concat(provider);
                        return [4 /*yield*/, fetch(providerUrl)];
                    case 1:
                        providerResponse = _b.sent();
                        if (!providerResponse.ok) {
                            throw new Error("Failed to get provider info: ".concat(providerResponse.statusText));
                        }
                        return [4 /*yield*/, providerResponse.json()];
                    case 2:
                        providerInfo = _b.sent();
                        hostUri = (_a = providerInfo.provider) === null || _a === void 0 ? void 0 : _a.hostUri;
                        if (!hostUri) {
                            throw new Error('Provider hostUri not found');
                        }
                        statusUrl = "".concat(hostUri, "/lease/").concat(dseq, "/").concat(gseq, "/").concat(oseq, "/status");
                        return [4 /*yield*/, fetch(statusUrl)];
                    case 3:
                        response = _b.sent();
                        if (!response.ok) {
                            throw new Error("Failed to get lease status: ".concat(response.statusText));
                        }
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    /**
     * Close a deployment
     */
    AkashClient.prototype.closeDeployment = function (dseq) {
        return __awaiter(this, void 0, void 0, function () {
            var MsgCloseDeployment, Message, client, closeMsg, msg, fee, tx;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akash-api/v1beta3'); })];
                    case 1:
                        MsgCloseDeployment = (_a.sent()).MsgCloseDeployment;
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/stargate/index.js'); })];
                    case 2:
                        Message = (_a.sent()).Message;
                        return [4 /*yield*/, this.getSigningClient()];
                    case 3:
                        client = _a.sent();
                        closeMsg = {
                            id: {
                                owner: this.wallet.address,
                                dseq: dseq
                            }
                        };
                        msg = {
                            typeUrl: Message.MsgCloseDeployment,
                            value: MsgCloseDeployment.fromPartial(closeMsg)
                        };
                        fee = {
                            amount: [{ denom: 'uakt', amount: '25000' }],
                            gas: '500000'
                        };
                        console.log('Closing deployment...');
                        return [4 /*yield*/, client.signAndBroadcast(this.wallet.address, [msg], fee, 'close deployment')];
                    case 4:
                        tx = _a.sent();
                        if (tx.code !== 0) {
                            throw new Error("Failed to close deployment: ".concat(tx.rawLog));
                        }
                        // Update deployment record
                        return [4 /*yield*/, this.updateDeployment(dseq, {
                                status: 'closed',
                                closedAt: new Date().toISOString()
                            })];
                    case 5:
                        // Update deployment record
                        _a.sent();
                        return [2 /*return*/, { dseq: dseq, txHash: tx.transactionHash, status: 'closed' }];
                }
            });
        });
    };
    /**
     * Save deployment to local records
     */
    AkashClient.prototype.saveDeployment = function (deployment) {
        return __awaiter(this, void 0, void 0, function () {
            var deployments, content, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        deployments = [];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, promises_1.default.readFile(exports.DEPLOYMENTS_PATH, 'utf-8')];
                    case 2:
                        content = _b.sent();
                        deployments = JSON.parse(content);
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        deployments.push(deployment);
                        return [4 /*yield*/, promises_1.default.writeFile(exports.DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2))];
                    case 5:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Update deployment in local records
     */
    AkashClient.prototype.updateDeployment = function (dseq, updates) {
        return __awaiter(this, void 0, void 0, function () {
            var deployments, content, _a, index;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        deployments = [];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, promises_1.default.readFile(exports.DEPLOYMENTS_PATH, 'utf-8')];
                    case 2:
                        content = _b.sent();
                        deployments = JSON.parse(content);
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [2 /*return*/];
                    case 4:
                        index = deployments.findIndex(function (d) { return d.dseq === dseq; });
                        if (!(index !== -1)) return [3 /*break*/, 6];
                        deployments[index] = __assign(__assign({}, deployments[index]), updates);
                        return [4 /*yield*/, promises_1.default.writeFile(exports.DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2))];
                    case 5:
                        _b.sent();
                        _b.label = 6;
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * List local deployment records
     */
    AkashClient.prototype.listDeployments = function () {
        return __awaiter(this, void 0, void 0, function () {
            var content, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, promises_1.default.readFile(exports.DEPLOYMENTS_PATH, 'utf-8')];
                    case 1:
                        content = _b.sent();
                        return [2 /*return*/, JSON.parse(content)];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return AkashClient;
}());
exports.AkashClient = AkashClient;
// ============ High-level deployment functions for CLI ============
function generateWallet() {
    return __awaiter(this, arguments, void 0, function (network, walletPath) {
        var wallet;
        if (network === void 0) { network = 'testnet'; }
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.exists(walletPath)];
                case 1:
                    if (_a.sent()) {
                        throw new Error("Wallet already exists at ".concat(walletPath, "\n") +
                            'Use --force to overwrite (WARNING: This will destroy your existing wallet!)');
                    }
                    return [4 /*yield*/, AkashWallet.generate(network)];
                case 2:
                    wallet = _a.sent();
                    return [4 /*yield*/, wallet.save(walletPath)];
                case 3:
                    _a.sent();
                    return [2 /*return*/, wallet];
            }
        });
    });
}
function checkBalance() {
    return __awaiter(this, arguments, void 0, function (walletPath) {
        var wallet, client;
        var _a;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _b.sent();
                    client = new AkashClient(wallet);
                    _a = {
                        wallet: wallet.getInfo()
                    };
                    return [4 /*yield*/, client.getBalance()];
                case 2: return [2 /*return*/, (_a.balance = _b.sent(),
                        _a)];
            }
        });
    });
}
function createDeployment() {
    return __awaiter(this, arguments, void 0, function (options) {
        var walletPath, wallet, client, balance, sdl, deployment, bids, sortedBids, bestBid, provider, lease, status_1, services, service, uris, err_2;
        var _a, _b, _c, _d, _e, _f;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    walletPath = options.walletPath || exports.WALLET_PATH;
                    return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _g.sent();
                    client = new AkashClient(wallet);
                    return [4 /*yield*/, client.getBalance()];
                case 2:
                    balance = _g.sent();
                    if (!balance.sufficient) {
                        throw new Error("Insufficient balance: ".concat(balance.akt, " AKT\n") +
                            "Need at least 5 AKT for deployment.\n" +
                            "Fund your wallet: ".concat(wallet.address));
                    }
                    sdl = generateSDL(options);
                    return [4 /*yield*/, client.createDeployment(sdl, options)];
                case 3:
                    deployment = _g.sent();
                    // Wait for bids
                    console.log('Waiting for bids (30 seconds)...');
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 30000); })];
                case 4:
                    _g.sent();
                    return [4 /*yield*/, client.queryBids(deployment.dseq)];
                case 5:
                    bids = _g.sent();
                    if (bids.length === 0) {
                        console.log('No bids received. Deployment is pending.');
                        console.log("Check status with: agentchat deploy --provider akash --status");
                        return [2 /*return*/, deployment];
                    }
                    sortedBids = bids
                        .filter(function (b) { var _a; return ((_a = b.bid) === null || _a === void 0 ? void 0 : _a.state) === 'open'; })
                        .sort(function (a, b) { var _a, _b, _c, _d; return parseInt(((_b = (_a = a.bid) === null || _a === void 0 ? void 0 : _a.price) === null || _b === void 0 ? void 0 : _b.amount) || '0') - parseInt(((_d = (_c = b.bid) === null || _c === void 0 ? void 0 : _c.price) === null || _d === void 0 ? void 0 : _d.amount) || '0'); });
                    if (sortedBids.length === 0) {
                        console.log('No open bids available.');
                        return [2 /*return*/, deployment];
                    }
                    bestBid = sortedBids[0];
                    provider = (_b = (_a = bestBid.bid) === null || _a === void 0 ? void 0 : _a.bidId) === null || _b === void 0 ? void 0 : _b.provider;
                    if (!provider) {
                        console.log('No valid provider found in bids.');
                        return [2 /*return*/, deployment];
                    }
                    console.log("Accepting bid from provider: ".concat(provider));
                    return [4 /*yield*/, client.createLease(deployment.dseq, provider, ((_d = (_c = bestBid.bid) === null || _c === void 0 ? void 0 : _c.bidId) === null || _d === void 0 ? void 0 : _d.gseq) || 1, ((_f = (_e = bestBid.bid) === null || _e === void 0 ? void 0 : _e.bidId) === null || _f === void 0 ? void 0 : _f.oseq) || 1)];
                case 6:
                    lease = _g.sent();
                    // Send manifest
                    return [4 /*yield*/, client.sendManifest(deployment.dseq, provider, deployment.manifest)];
                case 7:
                    // Send manifest
                    _g.sent();
                    // Get status
                    console.log('Waiting for deployment to start (15 seconds)...');
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 15000); })];
                case 8:
                    _g.sent();
                    _g.label = 9;
                case 9:
                    _g.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, client.getLeaseStatus(deployment.dseq, provider)];
                case 10:
                    status_1 = _g.sent();
                    services = status_1.services || {};
                    service = Object.values(services)[0];
                    uris = (service === null || service === void 0 ? void 0 : service.uris) || [];
                    if (uris.length > 0) {
                        console.log("\nDeployment ready!");
                        console.log("Endpoint: ".concat(uris[0]));
                        return [2 /*return*/, __assign(__assign(__assign({}, deployment), lease), { endpoint: uris[0], status: 'active' })];
                    }
                    return [3 /*break*/, 12];
                case 11:
                    err_2 = _g.sent();
                    console.log('Status check failed, deployment may still be starting.');
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/, __assign(__assign(__assign({}, deployment), lease), { status: 'active' })];
            }
        });
    });
}
function listDeployments() {
    return __awaiter(this, arguments, void 0, function (walletPath) {
        var wallet, client;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _a.sent();
                    client = new AkashClient(wallet);
                    return [2 /*return*/, client.listDeployments()];
            }
        });
    });
}
function closeDeployment(dseq_1) {
    return __awaiter(this, arguments, void 0, function (dseq, walletPath) {
        var wallet, client;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _a.sent();
                    client = new AkashClient(wallet);
                    return [2 /*return*/, client.closeDeployment(dseq)];
            }
        });
    });
}
function acceptBid(dseq_1, provider_1) {
    return __awaiter(this, arguments, void 0, function (dseq, provider, walletPath) {
        var wallet, client, deployments, deployment, lease, SDL, sdl;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _a.sent();
                    client = new AkashClient(wallet);
                    return [4 /*yield*/, client.listDeployments()];
                case 2:
                    deployments = _a.sent();
                    deployment = deployments.find(function (d) { return d.dseq === dseq; });
                    if (!deployment) {
                        throw new Error("Deployment ".concat(dseq, " not found in local records"));
                    }
                    return [4 /*yield*/, client.createLease(dseq, provider)];
                case 3:
                    lease = _a.sent();
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('@akashnetwork/akashjs/build/sdl/SDL/SDL.js'); })];
                case 4:
                    SDL = (_a.sent()).SDL;
                    sdl = SDL.fromString(deployment.sdl, 'beta3');
                    return [4 /*yield*/, client.sendManifest(dseq, provider, sdl.manifest())];
                case 5:
                    _a.sent();
                    return [2 /*return*/, lease];
            }
        });
    });
}
function queryBids(dseq_1) {
    return __awaiter(this, arguments, void 0, function (dseq, walletPath) {
        var wallet, client;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _a.sent();
                    client = new AkashClient(wallet);
                    return [2 /*return*/, client.queryBids(dseq)];
            }
        });
    });
}
function getDeploymentStatus(dseq_1) {
    return __awaiter(this, arguments, void 0, function (dseq, walletPath) {
        var wallet, client, deployments, deployment, bids, status_2, err_3;
        if (walletPath === void 0) { walletPath = exports.WALLET_PATH; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, AkashWallet.load(walletPath)];
                case 1:
                    wallet = _a.sent();
                    client = new AkashClient(wallet);
                    return [4 /*yield*/, client.listDeployments()];
                case 2:
                    deployments = _a.sent();
                    deployment = deployments.find(function (d) { return d.dseq === dseq; });
                    if (!deployment) {
                        throw new Error("Deployment ".concat(dseq, " not found"));
                    }
                    if (!!deployment.provider) return [3 /*break*/, 4];
                    return [4 /*yield*/, client.queryBids(dseq)];
                case 3:
                    bids = _a.sent();
                    return [2 /*return*/, __assign(__assign({}, deployment), { bids: bids.map(function (b) {
                                var _a, _b, _c, _d, _e;
                                return ({
                                    provider: ((_b = (_a = b.bid) === null || _a === void 0 ? void 0 : _a.bidId) === null || _b === void 0 ? void 0 : _b.provider) || '',
                                    price: ((_d = (_c = b.bid) === null || _c === void 0 ? void 0 : _c.price) === null || _d === void 0 ? void 0 : _d.amount) || '',
                                    state: ((_e = b.bid) === null || _e === void 0 ? void 0 : _e.state) || ''
                                });
                            }) })];
                case 4:
                    _a.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, client.getLeaseStatus(dseq, deployment.provider)];
                case 5:
                    status_2 = _a.sent();
                    return [2 /*return*/, __assign(__assign({}, deployment), { leaseStatus: status_2 })];
                case 6:
                    err_3 = _a.sent();
                    return [2 /*return*/, __assign(__assign({}, deployment), { leaseStatusError: err_3.message })];
                case 7: return [2 /*return*/];
            }
        });
    });
}
