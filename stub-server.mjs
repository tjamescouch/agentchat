// Stub server — replaces the public agentchat server with a decommission notice.
// Accepts WebSocket connections, sends an error, and closes.
// Returns a plain-text message on HTTP.

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 6667;
const MESSAGE = 'The public AgentChat server has been taken down. You can host your own: https://github.com/tjamescouch/agentchat';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(MESSAGE + '\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'ERROR',
    code: 'SERVER_DECOMMISSIONED',
    message: MESSAGE,
  }));
  ws.close(1000, 'Server decommissioned');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stub server listening on 0.0.0.0:${PORT}`);
});
