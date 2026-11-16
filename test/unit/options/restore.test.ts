import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';

import { app } from '../../../src/http/app.js';
import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { activeStorage } from '../../../src/storage/storage.js';

describe('POST /restore with modern formats', () => {
  // e.g. an image uploaded before AVIF was generated
  test('generates the missing modern thumbnails after the answer', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    for (const suffix of ['BI', 'MI', 'SI']) {
      await activeStorage.put(`${key}${suffix}.jpg`, 'test/data/violin.jpg');
    }

    const response = await request(app)
      .post('/restore')
      .send({ secret: 'my secret', filenames: `${key}.jpg` });
    expect(response.body).toEqual({ success: true, missing: [] });

    await vi.waitFor(
      async () => {
        for (const suffix of ['BI', 'MI', 'SI']) {
          expect(await activeStorage.exists(`${key}${suffix}.avif`)).toBe(true);
          expect(await activeStorage.exists(`${key}${suffix}.webp`)).toBe(true);
        }
      },
      { timeout: 20000, interval: 200 }
    );
  });
});
