import request from 'supertest';
import { koa } from '../../../src/app.js';
import { resizedKeys } from '../../../src/resizing.js';
import { incomingStorage } from '../../../src/storage.js';

describe('OPTIONS /upload', () => {
  test('returns CORS options', async () => {
    const response = await request(koa.callback()).options('/upload');
    expect(response.status).toBe(200);
  });
});

describe('POST /upload', () => {
  test('expects a file', async () => {
    const response = await request(koa.callback()).post('/upload');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Bad request. Exactly one file has to be provided.');
  });

  test('refuses unsupported formats', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/music.tiff');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format TIFF.');
  });

  test('refuses invalid images', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/invalid_content.jpg');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unrecognized image format.');
  });

  test('uploads the file and thumbnails to incoming bucket', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/violin.jpg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text);
    expect(await incomingStorage.exists(key)).toBe(true);
    for (const resizedKey of resizedKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });

  test('svg case', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/pipe_organ.svg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text);
    expect(await incomingStorage.exists(key)).toBe(true);
    for (const resizedKey of resizedKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });
});
