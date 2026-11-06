import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../../src/http/app.js';

describe('GET /ping', () => {
  test('responds without authentication', async () => {
    const response = await request(app).get('/ping');
    expect(response.text).toBe('Pong!');
    expect(response.status).toBe(200);
  });
});
