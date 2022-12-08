import request from 'supertest';
import { thumbnailKeys } from '../../../../src/image/thumbnails.js';
import { koa } from '../../../../src/koa/app.js';
import { incomingStorage } from '../../../../src/storage/storage.js';

describe('OPTIONS /upload', () => {
  test('returns CORS options', async () => {
    const response = await request(koa.callback())
      .options('/upload')
      .set('Origin', 'http://test.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', 'http://test.com')
      .expect('Access-Control-Allow-Methods', 'GET,POST')
      .expect('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization');
    expect(response.status).toBe(204);
  });
});

describe('PUT /upload', () => {
  test('returns a NotImplemented', async () => {
    const response = await request(koa.callback()).put('/upload');
    expect(response.status).toBe(405);
  });
});

describe('POST /upload', () => {
  test('expects a file', async () => {
    const response = await request(koa.callback())
      .post('/upload')
      .set('Origin', 'http://test.com')
      .expect('Access-Control-Allow-Origin', 'http://test.com');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Missing parameters. Expected values are { file }');
  });

  test('refuses unsupported formats', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/music.tiff');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format.');
  });

  test('refuses invalid images', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/invalid_content.jpg');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format.');
  });

  test('uploads the file and thumbnails to incoming bucket', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/violin.jpg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text);
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(thumbnailKeys(key).length).toBe(3); // no webp or avif
    for (const resizedKey of thumbnailKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });

  test('svg case', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/pipe_organ.svg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text);
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(thumbnailKeys(key).length).toBe(3);
    for (const resizedKey of thumbnailKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });
});
