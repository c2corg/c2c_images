import request from 'supertest';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { app } from '../../../src/http/app.js';
import { activeStorage } from '../../../src/storage/storage.js';

describe('internal errors', () => {
  const nodeEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = nodeEnv;
    vi.restoreAllMocks();
  });

  const failingPublish = async (): Promise<request.Response> => {
    vi.spyOn(activeStorage, 'exists').mockRejectedValue(new Error('ENOENT: /srv/images/secret/path'));
    return request(app).post('/publish').type('form').send({ secret: 'my secret', filename: '1_1.jpg' });
  };

  test('are answered without details in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const response = await failingPublish();
    expect(response.status).toBe(500);
    expect(response.text).toBe('Internal server error');
  });

  test('keep their details in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const response = await failingPublish();
    expect(response.status).toBe(500);
    expect(response.text).toContain('/srv/images/secret/path');
  });
});
