import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';

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
    const response = await request(app).post('/upload').attach('file', 'test/data/pipe_organ.svg');
    expect(response.status).toBe(413);
    expect(response.text).toBe('File too large');
  });
});

describe('POST /upload rate limit', () => {
  test('refuses the uploads over UPLOAD_RATE_LIMIT per minute', async () => {
    // the other tests of this file may have used some of the 5 uploads
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post('/upload')).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);

    const response = await request(app).post('/upload');
    expect(response.status).toBe(429);
    expect(response.get('RateLimit-Policy')).toMatch(/q=5; w=60/);
  });
});
