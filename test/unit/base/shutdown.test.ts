import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, test } from 'vitest';

import { closeServer } from '../../../src/http/shutdown.js';

// a server answering after `delay` ms
const startServer = async (delay: number): Promise<{ server: http.Server; url: string }> => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => res.end('done'), delay);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
};

describe('closeServer', () => {
  test('closes at once without connections', async () => {
    const { server } = await startServer(0);
    await closeServer(server, 3, 50);
    expect(server.listening).toBe(false);
  });

  test('closes the idle keep-alive connections', async () => {
    const { server, url } = await startServer(0);
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>(resolve => http.get(url, { agent }, res => res.resume().on('end', resolve)));
    await closeServer(server, 3, 50);
    expect(server.listening).toBe(false);
    agent.destroy();
  });

  test('waits for the requests in progress', async () => {
    const { server, url } = await startServer(200);
    const response = fetch(url);
    await sleep(20);
    await closeServer(server, 10, 50);
    expect(await (await response).text()).toBe('done');
  });

  test('gives up after the attempts, closing the connections', async () => {
    const { server, url } = await startServer(5000);
    const response = fetch(url).catch((error: unknown) => error);
    await sleep(20);
    await expect(closeServer(server, 3, 50)).rejects.toThrow('Number of pending requests: 1');
    expect(server.listening).toBe(false);
    expect(await response).toBeInstanceOf(Error);
  });
});
