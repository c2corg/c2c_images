import path from 'node:path';
import request from 'supertest';
import { getFileSize } from '../../../src/image/filesize.js';
import { koa } from '../../../src/koa/app.js';
import { generateUniqueKeyPrefix, isKeyParameterValid } from '../../../src/koa/utils.js';
import { activeStorage, tempStorage } from '../../../src/storage/storage';

describe('POST /rotate', () => {
  test('requires api secret', async () => {
    const response = await request(koa.callback()).post('/rotate').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('expects a key', async () => {
    const response = await request(koa.callback()).post('/rotate').send({ secret: 'my secret' });
    expect(response.text).toBe('Bad parameter "filename".');
    expect(response.status).toBe(400);
  });

  test('refuses invalid rotation angle', async () => {
    const response = await request(koa.callback())
      .post('/rotate')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.jpg', rotation: '45' });
    expect(response.text).toBe('Bad parameter "rotation" must be -90, 90 or 180');
    expect(response.status).toBe(400);
  });

  test('checks that the image is published', async () => {
    const response = await request(koa.callback())
      .post('/rotate')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.jpg', rotation: '-90' });
    expect(response.text).toBe('Not found');
    expect(response.status).toBe(404);
  });

  test('actually rotates the image', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.png`, 'test/data/piano.png');
    await activeStorage.put(`${key}BI.png`, 'test/data/piano.png');
    const response = await request(koa.callback())
      .post('/rotate')
      .send({ secret: 'my secret', filename: `${key}.png`, rotation: '-90' });

    const { success, filename } = JSON.parse(response.text);
    const { name: newKey, ext: newExt } = path.parse(filename);
    expect(success).toBe(true);
    expect(isKeyParameterValid(filename)).toBe(true);
    expect(newKey).not.toBe(key);
    expect(newExt).toBe('.png');
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key}.png`)).toBe(false);
    expect(await activeStorage.exists(`${key}BI.png`)).toBe(false);
    expect(await activeStorage.exists(`${newKey}.png`)).toBe(true);
    expect(await activeStorage.exists(`${newKey}BI.png`)).toBe(true);
    // even non existing thumbnails are now generated
    expect(await activeStorage.exists(`${newKey}SI.png`)).toBe(true);

    // check that the image has been actually rotated
    await activeStorage.move(`${newKey}.png`, tempStorage);
    await activeStorage.move(`${newKey}MI.png`, tempStorage);
    expect(getFileSize(tempStorage.path(`${newKey}.png`))).toBe('551x1151');
    expect(getFileSize(tempStorage.path(`${newKey}MI.png`))).toBe('191x400');
  });
});
