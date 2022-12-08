import request from 'supertest';
import { koa } from '../../../src/koa/app.js';

describe('OPTIONS /upload', () => {
  test('returns CORS options with *', async () => {
    const response = await request(koa.callback())
      .options('/upload')
      .set('Origin', 'http://test.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('Access-Control-Allow-Methods', 'GET,POST')
      .expect('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization');
    expect(response.status).toBe(204);
  });
});
