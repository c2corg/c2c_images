import request from 'supertest';
import { koa } from '../../../../src/koa/app.js';
import { generateUniqueKeyPrefix } from '../../../../src/koa/utils.js';
import { activeStorage } from '../../../../src/storage/storage.js';

describe('POST /delete', () => {
  test('requires api secret', async () => {
    const response = await request(koa.callback()).post('/delete').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('requires filenames', async () => {
    const response = await request(koa.callback()).post('/delete').send({ secret: 'my secret' });
    expect(response.text).toBe('Bad parameter filenames: Invalid input.');
    expect(response.status).toBe(400);
  });

  test('deletes one file', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    await activeStorage.put(`${key}SI.jpg`, 'test/data/violin.jpg');
    const response = await request(koa.callback())
      .post('/delete')
      .send({ secret: 'my secret', filenames: `${key}.jpg` });
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key}.jpg`)).toBe(false);
    expect(await activeStorage.exists(`${key}SI.jpg`)).toBe(false);
  });

  test('deletes several files', async () => {
    const key1 = generateUniqueKeyPrefix();
    const key2 = generateUniqueKeyPrefix();
    await activeStorage.put(`${key1}.jpg`, 'test/data/violin.jpg');
    await activeStorage.put(`${key2}.jpg`, 'test/data/violin.jpg');
    const response = await request(koa.callback())
      .post('/delete')
      .send({ secret: 'my secret', filenames: [`${key1}.jpg`, `${key2}.jpg`] });
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key1}.jpg`)).toBe(false);
    expect(await activeStorage.exists(`${key2}.jpg`)).toBe(false);
  });
});
