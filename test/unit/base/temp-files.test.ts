import fs from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { TEMP_FOLDER } from '../../../src/config.js';
import { app } from '../../../src/http/app.js';
import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { activeStorage, incomingStorage, tempStorage } from '../../../src/storage/storage.js';

// the files of the temp folder removed during a request: the folder is shared with the tests running in parallel
const removedTempFiles = (rm: { mock: { calls: unknown[][] } }): string[] =>
  rm.mock.calls.map(([file]) => file as string).filter(file => path.dirname(file) === path.resolve(TEMP_FOLDER));

describe('temp files', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('are removed when an upload fails', async () => {
    vi.spyOn(incomingStorage, 'put').mockRejectedValue(new Error('S3 is down'));
    vi.spyOn(tempStorage, 'copy').mockRejectedValue(new Error('S3 is down'));
    const rm = vi.spyOn(fs.promises, 'rm');

    const response = await request(app).post('/upload').attach('file', 'test/data/violin.jpg');
    expect(response.status).toBe(500);

    const removed = removedTempFiles(rm).map(file => path.basename(file));
    // the original and its 3 thumbnails, besides the file received
    const key = removed.find(file => /^\d+_\d+\.jpg$/.test(file));
    expect(key).toBeDefined();
    const { name } = path.parse(key!);
    expect(removed).toEqual(expect.arrayContaining([`${name}.jpg`, `${name}BI.jpg`, `${name}MI.jpg`, `${name}SI.jpg`]));
    for (const file of removedTempFiles(rm)) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  test('are removed when a rotation fails', async () => {
    const key = `${generateUniqueKeyPrefix()}.png`;
    await activeStorage.put(key, 'test/data/piano.png');
    vi.spyOn(tempStorage, 'copy').mockRejectedValue(new Error('S3 is down'));
    const rm = vi.spyOn(fs.promises, 'rm');

    const response = await request(app).post('/rotate').send({ secret: 'my secret', filename: key, rotation: '90' });
    expect(response.status).toBe(500);

    const removed = removedTempFiles(rm).map(file => path.basename(file));
    expect(removed).toContain(key);
    const newKey = removed.find(file => file !== key && /^\d+_\d+\.png$/.test(file));
    expect(newKey).toBeDefined();
    expect(removed).toContain(newKey!.replace('.png', 'SI.png'));
    for (const file of removedTempFiles(rm)) {
      expect(fs.existsSync(file)).toBe(false);
    }
    // the original image is still published
    expect(await activeStorage.exists(key)).toBe(true);
  });
});
