import fs from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';

import { TEMP_FOLDER } from '../../../../src/config.js';
import { app } from '../../../../src/http/app.js';
import { allThumbnailKeys } from '../../../../src/image/thumbnails.js';
import { incomingStorage } from '../../../../src/storage/storage.js';

describe('OPTIONS /upload', () => {
  test('returns CORS options', async () => {
    const response = await request(app)
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
    const response = await request(app).put('/upload');
    expect(response.status).toBe(405);
    expect(response.get('Allow')).toBe('POST');
  });
});

describe('POST /upload', () => {
  test('expects a file', async () => {
    const response = await request(app)
      .post('/upload')
      .set('Origin', 'http://test.com')
      .expect('Access-Control-Allow-Origin', 'http://test.com');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Missing parameters. Expected values are { file }');
  });

  test('refuses unsupported formats', async () => {
    const response = await request(app).post('/upload').attach('file', 'test/data/music.tiff');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format.');
  });

  test('refuses invalid images', async () => {
    const response = await request(app).post('/upload').attach('file', 'test/data/invalid_content.jpg');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format.');
  });

  test('removes the refused files from the temp folder', async () => {
    // the temp folder is shared with the tests running in parallel: follow the removal of this request's file
    const rm = vi.spyOn(fs.promises, 'rm');
    const response = await request(app).post('/upload').attach('file', 'test/data/music.tiff');
    expect(response.status).toBe(400);
    const [[file]] = rm.mock.calls as [[string]];
    expect(path.dirname(file)).toBe(TEMP_FOLDER);
    expect(fs.existsSync(file)).toBe(false);
    rm.mockRestore();
  });

  test('refuses a second file', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', 'test/data/violin.jpg')
      .attach('file', 'test/data/piano.png');
    expect(response.status).toBe(400);
  });

  test('uploads the file and thumbnails to incoming bucket', async () => {
    const response = await request(app).post('/upload').attach('file', 'test/data/violin.jpg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text) as { filename: string };
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(allThumbnailKeys(key).length).toBe(3); // no webp or avif
    for (const resizedKey of allThumbnailKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });

  test('svg case', async () => {
    const response = await request(app).post('/upload').attach('file', 'test/data/pipe_organ.svg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text) as { filename: string };
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(allThumbnailKeys(key).length).toBe(3);
    for (const resizedKey of allThumbnailKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  });
});
