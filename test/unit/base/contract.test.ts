// The HTTP contract of v6_images that c2c_ui, v6_api and HAProxy rely on. Written against the current server, so that a
// change of framework cannot change it.
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';
import { activeStorage, incomingStorage } from '../../../src/storage/storage.js';

// a raw request, as HAProxy's health check sends it (HTTP/1.0, no Host header)
const rawRequest = async (port: number, payload: string): Promise<string> => {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.end(payload);
  const chunks: Buffer[] = [];
  for await (const chunk of socket) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
};

describe('HAProxy', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => void app(req, res)).listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });

  // option httpchk HEAD "/ping" "HTTP/1.0"
  test('health check: HEAD /ping over HTTP/1.0 answers 200', async () => {
    const response = await rawRequest(port, 'HEAD /ping HTTP/1.0\r\n\r\n');
    expect(response).toMatch(/^HTTP\/1\.[01] 200 /);
  });
});

describe('c2c_ui', () => {
  // axios posts a FormData with a `file` field, from the site's origin, and reads `data.filename`
  test('POST /upload returns the key of the image, with CORS headers', async () => {
    const response = await request(app)
      .post('/upload')
      .set('Origin', 'http://test.com')
      .attach('file', 'test/data/violin.jpg', { filename: 'IMG_1234.JPG', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.get('Access-Control-Allow-Origin')).toBe('http://test.com');
    expect(response.get('Content-Type')).toMatch(/^application\/json/);
    const { filename } = response.body as { filename: string };
    expect(filename).toMatch(/^\d+_\d+\.jpg$/);
    expect(await incomingStorage.exists(filename)).toBe(true);
  });
});

describe('v6_api', () => {
  // requests.post(url, data={...}): form encoded, the API only checks for a 200
  const post = async (path: string, body: string): Promise<request.Response> =>
    request(app).post(path).type('form').send(body);

  test('POST /publish then POST /delete of an uploaded image', async () => {
    const upload = await request(app).post('/upload').attach('file', 'test/data/piano.png');
    const { filename } = upload.body as { filename: string };

    const publish = await post('/publish', `secret=my+secret&filename=${filename}`);
    expect(publish.status).toBe(200);
    expect(publish.body).toEqual({ success: true });
    expect(await activeStorage.exists(filename)).toBe(true);

    // the API publishes again when a document is updated with the same file name
    const republish = await post('/publish', `secret=my+secret&filename=${filename}`);
    expect(republish.status).toBe(200);

    const deletion = await post('/delete', `secret=my+secret&filenames=${filename}`);
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({ success: true });
    expect(await activeStorage.exists(filename)).toBe(false);
  });

  test.each([
    ['/publish', 'filename=1588000000_1.jpg'],
    ['/publish', 'secret=bad&filename=1588000000_1.jpg'],
    ['/delete', 'secret=bad&filenames=1588000000_1.jpg']
  ])('POST %s without the right secret is not a 200', async (path, body) => {
    const response = await post(path, body);
    expect([401, 403]).toContain(response.status);
  });
});

describe('Unknown requests', () => {
  test('GET /unknown answers 404', async () => {
    expect((await request(app).get('/unknown')).status).toBe(404);
  });

  test('GET /upload answers 405', async () => {
    expect((await request(app).get('/upload')).status).toBe(405);
  });
});
