import request from 'supertest';
import { koa } from '../../../src/app.js';
import { activeStorage } from '../../../src/storage.js';
import { generateUniqueKeyPrefix } from '../../../src/utils.js';

describe('POST /delete', () => {
  test('requires api secret', async () => {
    const response = await request(koa.callback()).post('/delete').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('requires filenames', async () => {
    const response = await request(koa.callback()).post('/delete').send({ secret: 'my secret' });
    expect(response.text).toBe('Bad parameter "filenames"');
    expect(response.status).toBe(400);
  });

  test('deletes one file', async () => {
    const key = generateUniqueKeyPrefix();
    activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    activeStorage.put(`${key}SI.jpg`, 'test/data/violin.jpg');
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
    activeStorage.put(`${key1}.jpg`, 'test/data/violin.jpg');
    activeStorage.put(`${key2}.jpg`, 'test/data/violin.jpg');
    const response = await request(koa.callback())
      .post('/delete')
      .send({ secret: 'my secret', filenames: [`${key1}.jpg`, `${key2}.jpg`] });
    expect(JSON.parse(response.text)).toEqual({ success: true });
    expect(response.status).toBe(200);
    expect(await activeStorage.exists(`${key1}.jpg`)).toBe(false);
    expect(await activeStorage.exists(`${key2}.jpg`)).toBe(false);
  });
});
