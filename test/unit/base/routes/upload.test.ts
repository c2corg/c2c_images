import fs from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';

import { TEMP_FOLDER } from '../../../../src/config.js';
import { app } from '../../../../src/http/app.js';
import { allThumbnailKeys } from '../../../../src/image/thumbnails.js';
import { incomingStorage } from '../../../../src/storage/storage.js';
import { svgWithEmbeddedImage } from '../../../helpers/image.js';

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

  test('stores the SVG sanitized', async () => {
    const response = await request(app).post('/upload').attach('file', 'test/data/unsafe.svg');
    expect(response.status).toBe(200);
    const { filename: key } = response.body as { filename: string };
    const stored = fs.readFileSync(path.join(process.env['INCOMING_FOLDER'] ?? '', key), 'utf8');
    expect(stored).toContain('<svg');
    expect(stored).not.toContain('<script');
    expect(stored).not.toContain('evil.example');
  });

  test('refuses an SVG with external entities', async () => {
    const response = await request(app)
      .post('/upload')
      .attach(
        'file',
        Buffer.from(
          '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&x;</text></svg>'
        ),
        'x.svg'
      );
    expect(response.status).toBe(400);
    expect(response.text).toBe('Unsupported image format.');
  });

  test('refuses the images over MAX_IMAGE_PIXELS (decompression bombs)', async () => {
    // 20000 x 20000 pixels in 48 kB
    const response = await request(app).post('/upload').attach('file', 'test/data/bomb.png');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Image too large.');
  });

  test('refuses the SVGs embedding images over MAX_SVG_IMAGE_PIXELS', async () => {
    // drawn at 100 x 100, decoded whole by librsvg
    const svg = await svgWithEmbeddedImage(6000, 5000);
    const response = await request(app).post('/upload').attach('file', Buffer.from(svg), 'big.svg');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Image too large.');
  });
});
