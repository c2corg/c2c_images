import request from 'supertest';
import { isAvifWriteSupported, isWebpWriteSupported } from '../../../src/exec/imagemagick.js';
import { baseThumbnailKeys, modernThumbnailKeys } from '../../../src/image/thumbnails.js';
import { koa } from '../../../src/koa/app.js';
import { generateUniqueKeyPrefix } from '../../../src/koa/utils.js';
import { activeStorage, incomingStorage } from '../../../src/storage/storage.js';

const MODERN_GENERATION_TIME = 10000;

describe('Asynchronous generation of Webp and Avif enabled', () => {
  test(
    'POST /upload will also generate "modern" thumbnails, asynchronously',
    async () => {
      const response = await request(koa.callback()).post('/upload').attach('file', 'test/data/violin.jpg');
      expect(response.status).toBe(200);
      const { filename: key } = JSON.parse(response.text);

      expect(baseThumbnailKeys(key).length).toBe(3);
      // not all environments will support webp and avif, take it into account
      expect(modernThumbnailKeys(key).length).toBe(+isWebpWriteSupported * 3 + +isAvifWriteSupported * 3);

      // original and base image have been uploaded
      expect(await incomingStorage.exists(key)).toBe(true);
      for (const resizedKey of baseThumbnailKeys(key)) {
        expect(await incomingStorage.exists(resizedKey)).toBe(true);
      }

      // FIXME: this is not a satisfying solution, but mocking ESM
      // modules with jest and --experimental-vm-modules is not top
      // for the moment.
      // We expect the generations of modern thumbnails to take less than 10s
      await new Promise(resolve => setTimeout(resolve, MODERN_GENERATION_TIME));
      for (const resizedKey of modernThumbnailKeys(key)) {
        expect(await incomingStorage.exists(resizedKey)).toBe(true);
      }
    },
    MODERN_GENERATION_TIME * 2
  );

  test(
    'POST /rotate will also rotate "modern" thumbnails, asynchronously',
    async () => {
      const key = generateUniqueKeyPrefix();
      await activeStorage.put(`${key}.png`, 'test/data/piano.png');
      await activeStorage.put(`${key}BI.png`, 'test/data/piano.png');
      const response = await request(koa.callback())
        .post('/rotate')
        .send({ secret: 'my secret', filename: `${key}.png`, rotation: '90' });

      expect(response.status).toBe(200);
      const { filename } = JSON.parse(response.text);

      // initial image and thumbnails have been deleted
      expect(await activeStorage.exists(`${key}.png`)).toBe(false);
      for (const fileKey of baseThumbnailKeys(key)) {
        expect(await activeStorage.exists(fileKey)).toBe(false);
      }
      // all thumbnails, even non existing thumbnails are now generated
      expect(await activeStorage.exists(filename)).toBe(true);
      for (const fileKey of baseThumbnailKeys(filename)) {
        expect(await activeStorage.exists(fileKey)).toBe(true);
      }

      // FIXME: this is not a satisfying solution, but mocking ESM
      // modules with jest and --experimental-vm-modules is not top
      // for the moment.
      // We expect the generations of modern thumbnails to take less than 10s
      await new Promise(resolve => setTimeout(resolve, MODERN_GENERATION_TIME));
      for (const fileKey of modernThumbnailKeys(filename)) {
        expect(await activeStorage.exists(fileKey)).toBe(true);
      }
    },
    MODERN_GENERATION_TIME * 2
  );
});
