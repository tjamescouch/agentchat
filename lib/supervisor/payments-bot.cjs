#!/usr/bin/env node
// payments-bot.cjs — listens to #general and tracks +$amount messages.
// Stores an append-only ledger and posts running totals.
//
// Env:
//   PAYMENTS_URL: wss url (default agentchat-server.fly.dev)
//   PAYMENTS_CHANNEL: channel to listen/post (default #general)
//   PAYMENTS_LEDGER: path to ledger jsonl (default ~/.agentchat/payments/ledger.jsonl)
//   PAYMENTS_TOTAL: path to total json (default ~/.agentchat/payments/total.json)
//   PAYMENTS_ALLOW: comma-separated allowlist of from_name or agent_id (optional)
//
// Intended to be run under supervisor or manually.

const fs = require('fs');
const path = require('path');
const os = require('os');

const WS_MODULE = '/opt/homebrew/lib/node_modules/@tjamescouch/agentchat/node_modules/ws';
const WebSocket = require(WS_MODULE);

const SERVER = process.env.PAYMENTS_URL || 'wss://agentchat-server.fly.dev';
const CHANNEL = process.env.PAYMENTS_CHANNEL || '#general';
const LEDGER = process.env.PAYMENTS_LEDGER || path.join(os.homedir(), '.agentchat', 'payments', 'ledger.jsonl');
const TOTAL = process.env.PAYMENTS_TOTAL || path.join(os.homedir(), '.agentchat', 'payments', 'total.json');
const ALLOW_RAW = process.env.PAYMENTS_ALLOW || '';
const ALLOW = new Set(ALLOW_RAW.split(',').map(s => s.trim()).filter(Boolean));

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function loadTotal() {
  try { return JSON.parse(fs.readFileSync(TOTAL, 'utf8')); } catch { return { total: 0, n: 0 }; }
}

function saveTotal(t) {
  ensureDir(TOTAL);
  fs.writeFileSync(TOTAL, JSON.stringify(t, null, 2) + '\n');
}

function appendLedger(entry) {
  ensureDir(LEDGER);
  fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
}

function parseDelta(text) {
  // Match +$50, +50, + 50, -$12.34 etc
  const m = text.match(/(^|\s)([+-])\s*\$?\s*(\d+(?:\.\d{1,2})?)(?=\s|$)/);
  if (!m) return null;
  const sign = m[2] === '-' ? -1 : 1;
  const amt = Number(m[3]);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  return sign * amt;
}

function allowed(msg) {
  if (ALLOW.size === 0) return true;
  return ALLOW.has(msg.from) || ALLOW.has(msg.from_name);
}

const ws = new WebSocket(SERVER);
let identified = false;
let myId = null;

function send(to, content) {
  ws.send(JSON.stringify({ type: 'MSG', to, content }));
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'IDENTIFY', name: 'paymentsbot' }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  if (msg.agent_id && !identified) {
    identified = true;
    myId = msg.agent_id;
    ws.send(JSON.stringify({ type: 'JOIN', channel: CHANNEL }));
    return;
  }

  if (msg.to !== CHANNEL) return;
  if (!msg.content || typeof msg.content !== 'string') return;
  if (msg.from === myId) return;
  if (!allowed(msg)) return;

  const delta = parseDelta(msg.content);
  if (delta == null) return;

  const state = loadTotal();
  const next = {
    total: Number((state.total + delta).toFixed(2)),
    n: (state.n || 0) + 1
  };

  const entry = {
    ts: new Date().toISOString(),
    channel: CHANNEL,
    from: msg.from,
    from_name: msg.from_name || null,
    delta,
    content: msg.content,
    total_after: next.total
  };

  appendLedger(entry);
  saveTotal(next);

  const verb = delta >= 0 ? 'Noted investment' : 'Noted expense';
  send(CHANNEL, `${verb}: ${delta >= 0 ? '+' : ''}$${Math.abs(delta).toFixed(2)}. Total: $${next.total.toFixed(2)} (${next.n} entries).`);
});

ws.on('error', (e) => {
  console.error('paymentsbot error:', e.message);
  process.exit(1);
});

ws.on('close', () => process.exit(0));
