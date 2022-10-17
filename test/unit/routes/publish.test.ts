import request from 'supertest';
import { koa } from '../../../src/koa/app.js';
import { generateUniqueKeyPrefix } from '../../../src/koa/utils.js';
import { activeStorage, incomingStorage } from '../../../src/storage/storage.js';

describe('POST /publish', () => {
  test('requires api secret', async () => {
    const response = await request(koa.callback()).post('/publish');
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('requires valid api secret', async () => {
    const response = await request(koa.callback()).post('/publish').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('bad file', async () => {
    const response = await request(koa.callback())
      .post('/publish')
      .send({ secret: 'my secret', filename: '1234567890_1234567890.jpg' });
    expect(response.text).toBe('Unknown image.');
    expect(response.status).toBe(400);
  });

  test('publish image in incoming', async () => {
    const key = generateUniqueKeyPrefix();
    await incomingStorage.put(`${key}.png`, 'test/data/piano.png');
    await incomingStorage.put(`${key}BI.png`, 'test/data/piano.png');
    const response = await request(koa.callback())
      .post('/publish')
      .send({ secret: 'my secret', filename: `${key}.png` });
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await incomingStorage.exists(`${key}.png`)).toBe(false);
    expect(await incomingStorage.exists(`${key}BI.png`)).toBe(false);
    expect(await activeStorage.exists(`${key}.png`)).toBe(true);
    expect(await activeStorage.exists(`${key}BI.png`)).toBe(true);
  });

  test('publish already published image', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    await activeStorage.put(`${key}BI.jpg`, 'test/data/violin.jpg');
    const response = await request(koa.callback())
      .post('/publish')
      .send({ secret: 'my secret', filename: `${key}.jpg` });
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key}.jpg`)).toBe(true);
    expect(await activeStorage.exists(`${key}BI.jpg`)).toBe(true);
  });
});
