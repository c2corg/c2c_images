import request from 'supertest';
import { isAvifSupported, isWebpSupported } from '../../../src/image/convert.js';
import { thumbnailKeys } from '../../../src/image/thumbnails.js';
import { koa } from '../../../src/koa/app.js';
import { incomingStorage } from '../../../src/storage/storage.js';

describe('Webp and Avif enabled', () => {
  test('POST /upload will also generate "modern" thumbnails', async () => {
    const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/violin.jpg');
    expect(response.status).toBe(200);
    const { filename: key } = JSON.parse(response.text);
    expect(await incomingStorage.exists(key)).toBe(true);
    // not all versions will support webp and avif, take that into account
    expect(thumbnailKeys(key).length).toBe(3 + +isWebpSupported * 3 + +isAvifSupported * 3);
    for (const resizedKey of thumbnailKeys(key)) {
      expect(await incomingStorage.exists(resizedKey)).toBe(true);
    }
  }, 10000);
});
