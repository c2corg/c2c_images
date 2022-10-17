import request from 'supertest';
import { koa } from '../../../src/koa/app.js';

describe('GET /ping', () => {
  test('responds without authentication', async () => {
    const response = await request(koa.callback()).get('/ping');
    expect(response.text).toBe('Pong!');
    expect(response.status).toBe(200);
  });
});
