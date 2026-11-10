import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';
import { promRefusedUploadsCounter } from '../../../src/metrics/prometheus.js';
import { metricValue } from '../../helpers/metrics.js';

describe('OPTIONS /upload', () => {
  test('returns CORS options with *', async () => {
    const response = await request(app)
      .options('/upload')
      .set('Origin', 'http://test.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('Access-Control-Allow-Methods', 'GET,POST')
      .expect('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization');
    expect(response.status).toBe(204);
  });
});

describe('POST /upload', () => {
  test('refuses files over MAX_UPLOAD_SIZE', async () => {
    const before = await metricValue(promRefusedUploadsCounter, { reason: 'size' });
    const response = await request(app).post('/upload').attach('file', 'test/data/pipe_organ.svg');
    expect(response.status).toBe(413);
    expect(await metricValue(promRefusedUploadsCounter, { reason: 'size' })).toBe(before + 1);
    expect(response.text).toBe('File too large');
  });

  test('refuses the images over MAX_IMAGE_PIXELS', async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const response = await request(app).post('/upload').attach('file', jpeg, 'large.jpg');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Image too large.');
  });

  test('refuses the HEIC over MAX_HEIC_PIXELS, but not the other formats', async () => {
    const before = await metricValue(promRefusedUploadsCounter, { reason: 'pixels' });
    const heic = await request(app).post('/upload').attach('file', 'test/data/heic-irot.heic');
    expect(heic.status).toBe(400);
    expect(heic.text).toBe('Image too large.');
    expect(await metricValue(promRefusedUploadsCounter, { reason: 'pixels' })).toBe(before + 1);

    // as many pixels in JPEG
    const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const response = await request(app).post('/upload').attach('file', jpeg, 'photo.jpg');
    expect(response.status).toBe(200);
  });
});
