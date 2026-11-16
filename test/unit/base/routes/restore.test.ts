import fs from 'node:fs';

import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../../src/http/app.js';
import { generateUniqueKeyPrefix } from '../../../../src/http/utils.js';
import { activeStorage } from '../../../../src/storage/storage.js';

// the local storage keeps no versions: the restoring of deleted files is tested against the S3 server
describe('POST /restore', () => {
  test('requires api secret', async () => {
    const response = await request(app).post('/restore').send({ secret: 'bad secret' });
    expect(response.text).toBe('Bad secret key.');
    expect(response.status).toBe(403);
  });

  test('requires filenames', async () => {
    const response = await request(app).post('/restore').send({ secret: 'my secret' });
    expect(response.text).toBe('Bad parameter filenames: Required.');
    expect(response.status).toBe(400);
  });

  test('answers 405 to a GET', async () => {
    const response = await request(app).get('/restore');
    expect(response.status).toBe(405);
    expect(response.get('Allow')).toBe('POST');
  });

  test('a file still there is restored', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    const response = await request(app)
      .post('/restore')
      .send({ secret: 'my secret', filenames: `${key}.jpg` });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, missing: [] });
    expect(await activeStorage.exists(`${key}.jpg`)).toBe(true);
  });

  // as v6_api sends it: form encoded, `filenames` repeated
  test('lists the files without a version to restore, form encoded', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    const response = await request(app)
      .post('/restore')
      .type('form')
      .send(`secret=my+secret&filenames=1588000000_404.jpg&filenames=${key}.jpg&filenames=1588000000_405.png`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, missing: ['1588000000_404.jpg', '1588000000_405.png'] });
  });

  test('generates again the thumbnails without a version, from the original', async () => {
    const key = generateUniqueKeyPrefix();
    await activeStorage.put(`${key}.jpg`, 'test/data/violin.jpg');
    // a thumbnail still there is kept as it is
    await activeStorage.put(`${key}MI.jpg`, 'test/data/piano.png');

    const response = await request(app)
      .post('/restore')
      .send({ secret: 'my secret', filenames: `${key}.jpg` });

    expect(response.body).toEqual({ success: true, missing: [] });
    expect(await activeStorage.exists(`${key}BI.jpg`)).toBe(true);
    expect(await activeStorage.exists(`${key}SI.jpg`)).toBe(true);
    expect(await activeStorage.get(`${key}MI.jpg`)).toEqual(fs.readFileSync('test/data/piano.png'));
  });
});
