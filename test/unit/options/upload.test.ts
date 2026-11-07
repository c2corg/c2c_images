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
});
