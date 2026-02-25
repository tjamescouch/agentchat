const { AgentChatClient, quickSend } = require('../lib/client.js');

async function run() {
  const client = new AgentChatClient({ server: 'ws://localhost:8080', name: 'tester' });
  try {
    await client.connect();
  } catch (e) {
    console.error('connect failed (ok if server not running):', e.message);
  }

  // Simulate sending while disconnected
  console.log('Sending message while likely connected/disconnected...');
  await client.send('#general', 'hello before disconnect');

  // Forcefully disconnect socket to simulate transient network drop
  if (client['ws']) {
    client['ws'].close();
  }

  // Immediately send while socket reconnecting/closed
  await client.send('#general', 'message during drop');
  await client.send('#general', 'another message during drop');

  // Wait a bit and attempt to reconnect
  setTimeout(async () => {
    try {
      await client.connect();
      console.log('reconnected, flushing queue...');
      // small delay for flush
      await new Promise(r => setTimeout(r, 200));
      client.disconnect();
    } catch (e) {
      console.error('reconnect failed (ok):', e.message);
    }
  }, 500);
}

run().catch(console.error);
