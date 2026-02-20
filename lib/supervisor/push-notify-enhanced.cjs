#!/usr/bin/env node
// push-notify-enhanced.cjs — posts push notifications with PR URLs
// Usage: node push-notify-enhanced.cjs <repo> <branch> <message>

const WS_MODULE = '/opt/homebrew/lib/node_modules/@tjamescouch/agentchat/node_modules/ws';
const WebSocket = require(WS_MODULE);

const SERVER = process.env.AGENTCHAT_NOTIFY_URL || 'wss://agentchat-server.fly.dev';
const CHANNEL = process.env.AGENTCHAT_NOTIFY_CHANNEL || '#pull-requests';
const REPO = process.argv[2];
const BRANCH = process.argv[3];
const MSG = process.argv.slice(4).join(' ');

if (!REPO || !BRANCH || !MSG) {
  console.error('Usage: push-notify-enhanced.cjs <repo> <branch> <message>');
  process.exit(1);
}

// Construct GitHub PR URL
const PR_URL = `https://github.com/tjamescouch/${REPO}/compare/main...${BRANCH}?expand=1`;
const FULL_MSG = `${MSG}\n🔗 ${PR_URL}`;

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
    if (msg.agent_id && !identified) {
      identified = true;
      ws.send(JSON.stringify({ type: 'JOIN', channel: CHANNEL }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'MSG', to: CHANNEL, content: FULL_MSG }));
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
