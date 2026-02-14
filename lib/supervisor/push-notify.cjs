#!/usr/bin/env node
// push-notify.cjs — posts push notifications to agentchat #pull-requests
// Usage: node push-notify.cjs <message>
// Connects ephemerally, sends one message, disconnects.

const WS_MODULE = '/opt/homebrew/lib/node_modules/@tjamescouch/agentchat/node_modules/ws';
const WebSocket = require(WS_MODULE);

const SERVER = process.env.AGENTCHAT_NOTIFY_URL || 'wss://agentchat-server.fly.dev';
const CHANNEL = process.env.AGENTCHAT_NOTIFY_CHANNEL || '#pull-requests';
const MSG = process.argv.slice(2).join(' ');

if (!MSG) process.exit(0);

const ws = new WebSocket(SERVER);
let done = false;
const finish = () => {
  if (!done) {
    done = true;
    try { ws.close(); } catch(e) {}
    setTimeout(() => process.exit(0), 200);
  }
};
setTimeout(finish, 8000);

let identified = false;

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    // Server sends agent_id after IDENTIFY
    if (msg.agent_id && !identified) {
      identified = true;
      // Join channel then send
      ws.send(JSON.stringify({ type: 'JOIN', channel: CHANNEL }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'MSG', to: CHANNEL, content: MSG }));
        setTimeout(finish, 500);
      }, 300);
    }
  } catch(e) {}
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'IDENTIFY', name: 'pushbot' }));
});

ws.on('error', (e) => { console.error('notify error:', e.message); finish(); });
ws.on('close', () => process.exit(0));
