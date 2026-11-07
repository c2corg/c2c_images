import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

/**
 * Closes a server once its requests are done: new connections are refused at once, the idle keep-alive connections
 * closed, and the others given up to `attempts` x `interval` ms to end. Rejects when some remain, after closing them.
 */
export const closeServer = async (server: Server, attempts = 10, interval = 1000): Promise<void> => {
  const getConnections = promisify(server.getConnections.bind(server));
  const closed = promisify(server.close.bind(server))();

  let pending = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    server.closeIdleConnections();
    pending = await getConnections();
    if (!pending) {
      break;
    }
    await sleep(interval);
  }

  if (pending) {
    server.closeAllConnections();
    await closed;
    throw new Error(`Number of pending requests: ${pending}`);
  }
  await closed;
};
