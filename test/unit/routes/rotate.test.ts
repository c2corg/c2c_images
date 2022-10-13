import request from 'supertest';
import { koa } from '../../../src/app.js';
import { getFileSize } from '../../../src/filesize.js';
import { activeStorage, tempStorage } from '../../../src/storage';
import { generateUniqueKeyPrefix } from '../../../src/utils.js';

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
    console.log(response.text);
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key}.png`)).toBe(true);
    expect(await activeStorage.exists(`${key}BI.png`)).toBe(true);

    // check that the image has been actually rotated
    await activeStorage.move(`${key}.png`, tempStorage);
    expect(getFileSize(tempStorage.path(`${key}.png`))).toBe('551x1151');
  });
});
