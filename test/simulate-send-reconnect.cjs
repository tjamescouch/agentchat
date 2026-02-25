const { AgentChatClient } = require('../lib/client.js');

async function run() {
  const client = new AgentChatClient({ server: 'ws://localhost:8080', name: 'tester' });
  try {
    await client.connect();
    console.log('connected');
  } catch (e) {
    console.error('connect failed (ok if server not running):', e.message);
  }

  console.log('Sending message while likely connected/disconnected...');
  await client.send('#general', 'hello before disconnect').catch(err => console.error('send1 failed:', err.message));

  if (client.ws) {
    client.ws.close();
    console.log('closed socket to simulate drop');
  }

  await client.send('#general', 'message during drop').catch(err => console.error('send2 failed:', err.message));
  await client.send('#general', 'another message during drop').catch(err => console.error('send3 failed:', err.message));

  setTimeout(async () => {
    try {
      await client.connect();
      console.log('reconnected, flushing queue...');
      await new Promise(r => setTimeout(r, 200));
      client.disconnect();
    } catch (e) {
      console.error('reconnect failed (ok):', e.message);
    }
  }, 500);
}

run().catch(console.error);

