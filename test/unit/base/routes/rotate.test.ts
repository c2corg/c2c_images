import path from 'node:path';

import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../../src/http/app.js';
import { generateUniqueKeyPrefix } from '../../../../src/http/utils.js';
import { keyRegex } from '../../../../src/http/validation.js';
import { allThumbnailKeys, baseThumbnailKeys } from '../../../../src/image/thumbnails.js';
import { activeStorage, tempStorage } from '../../../../src/storage/storage.js';
import { imageInfo } from '../../../helpers/image.js';

describe('POST /rotate', () => {
  test('requires api secret', async () => {
    const response = await request(app).post('/rotate').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('expects a key', async () => {
    const response = await request(app).post('/rotate').send({ secret: 'my secret' });
    expect(response.text).toBe('Bad parameter filename: Required.');
    expect(response.status).toBe(400);
  });

  test('refuses to rotate SVG', async () => {
    const response = await request(app)
      .post('/rotate')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.svg' });
    expect(response.text).toBe('SVG images rotation is not supported.');
    expect(response.status).toBe(400);
  });

  test('refuses invalid rotation angle', async () => {
    const response = await request(app)
      .post('/rotate')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.jpg', rotation: '45' });
    expect(response.text).toBe('Bad parameter rotation: Invalid option: expected one of "90"|"180"|"-90".');
    expect(response.status).toBe(400);
  });

  test('checks that the image is published', async () => {
    const response = await request(app)
      .post('/rotate')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.jpg', rotation: '-90' });
    expect(response.text).toBe('Not found');
    expect(response.status).toBe(404);
  });

  test('actually rotates the image', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.png`, 'test/data/piano.png');
    await activeStorage.put(`${key}BI.png`, 'test/data/piano.png');
    const response = await request(app)
      .post('/rotate')
      .send({ secret: 'my secret', filename: `${key}.png`, rotation: '-90' });

    const { success, filename } = JSON.parse(response.text) as { success: boolean; filename: string };
    const { name: newKey, ext: newExt } = path.parse(filename);
    expect(success).toBe(true);
    expect(keyRegex.test(filename)).toBe(true);
    expect(newKey).not.toBe(key);
    expect(newExt).toBe('.png');
    expect(response.status).toBe(200);

    // initial image and all thumbnails have been deleted
    expect(await activeStorage.exists(`${key}.png`)).toBe(false);
    for (const fileKey of allThumbnailKeys(key)) {
      expect(await activeStorage.exists(fileKey)).toBe(false);
    }
    // all thumbnails, even non initially existing ones are now generated
    expect(await activeStorage.exists(filename)).toBe(true);
    for (const fileKey of baseThumbnailKeys(filename)) {
      expect(await activeStorage.exists(fileKey)).toBe(true);
    }

    // check that the image has been actually rotated
    await activeStorage.move(`${newKey}.png`, tempStorage);
    await activeStorage.move(`${newKey}MI.png`, tempStorage);
    expect(await imageInfo(tempStorage.path(`${newKey}.png`))).toMatchObject({ size: '551x1151' });
    expect(await imageInfo(tempStorage.path(`${newKey}MI.png`))).toMatchObject({ size: '191x400' });
  });

  test.each([
    // displayed 133x200 (EXIF orientation 7), then rotated
    ['autoorient.jpg', '90', { format: 'jpeg', size: '200x133', orientation: 1 }],
    ['animated.gif', '-90', { format: 'gif', size: '80x120', pages: 3 }]
  ])('rotates %s upright, by %s', async (filename, rotation, expected) => {
    const ext = path.extname(filename);
    const key = `${generateUniqueKeyPrefix()}${ext}`;
    await activeStorage.put(key, `test/data/${filename}`);
    const response = await request(app).post('/rotate').send({ secret: 'my secret', filename: key, rotation });
    expect(response.status).toBe(200);
    const { filename: newKey } = response.body as { filename: string };
    await activeStorage.move(newKey, tempStorage);
    expect(await imageInfo(tempStorage.path(newKey))).toMatchObject(expected);
  });
});
