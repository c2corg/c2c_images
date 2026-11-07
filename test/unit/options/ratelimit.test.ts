import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';

// UPLOAD_RATE_LIMIT is 5 and AUTH_FAILURE_RATE_LIMIT 3 in these tests. Each test file has its own counters.
describe('rate limits', () => {
  test('refuses the uploads over UPLOAD_RATE_LIMIT per minute', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/upload')).status).toBe(400);
    }
    const response = await request(app).post('/upload');
    expect(response.status).toBe(429);
    expect(response.get('RateLimit-Policy')).toMatch(/q=5; w=60/);
  });

  test('counts only the API requests with a missing or bad secret', async () => {
    // a good secret, an unknown image: does not count
    for (let i = 0; i < 5; i++) {
      const response = await request(app)
        .post('/publish')
        .type('form')
        .send({ secret: 'my secret', filename: '1_1.jpg' });
      expect(response.status).toBe(404);
    }
    expect((await request(app).post('/delete').type('form').send({ filenames: '1_1.jpg' })).status).toBe(401);
    expect((await request(app).post('/rotate').type('form').send({ secret: 'bad', filename: '1_1.jpg' })).status).toBe(
      403
    );
    expect((await request(app).post('/publish').type('form').send({ secret: 'bad', filename: '1_1.jpg' })).status).toBe(
      403
    );
    // the 4th failure, then even a good secret: refused
    expect((await request(app).post('/publish').type('form').send({ secret: 'bad' })).status).toBe(429);
    expect(
      (await request(app).post('/publish').type('form').send({ secret: 'my secret', filename: '1_1.jpg' })).status
    ).toBe(429);
  });

  test('never limits the health check', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await request(app).head('/ping')).status).toBe(200);
    }
  });
});
