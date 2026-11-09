import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { LocalStorage, tempStorage } from '../../../src/storage/storage.js';

const key = `${generateUniqueKeyPrefix()}.png`;
const newKey = `${generateUniqueKeyPrefix()}.png`;
const file = 'test/data/piano.png';

describe('Local storage', () => {
  let incomingStorage: LocalStorage;
  let activeStorage: LocalStorage;
  beforeAll(() => {
    incomingStorage = new LocalStorage(process.env['INCOMING_FOLDER']!);

    activeStorage = new LocalStorage(process.env['ACTIVE_FOLDER']!);
  });

  test('Standard protocol', async () => {
    // put file in temp storage for processing
    await tempStorage.put(key, file);

    // move it in incoming storage waiting for publication
    await tempStorage.move(key, incomingStorage);
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(await tempStorage.exists(key)).toBe(false);

    // on publishing it is moved to active storage
    await incomingStorage.move(key, activeStorage);
    expect(await activeStorage.exists(key)).toBe(true);
    expect(await incomingStorage.exists(key)).toBe(false);

    // cleaning
    await activeStorage.delete(key);
    expect(await activeStorage.exists(key)).toBe(false);

    // delete a file that does not exist
    await expect(activeStorage.delete('does_not_exist.jpg')).rejects.toThrow();
  });

  test('Rotating protocol', async () => {
    // for rotating object is in active storage
    await activeStorage.put(key, file);

    // get object in temp storage
    await activeStorage.copy(key, tempStorage);
    expect(await tempStorage.exists(key)).toBe(true);

    // simulate rotation..
    fs.renameSync(tempStorage.path(key), tempStorage.path(newKey));

    // upload rotated file to active storage and delete original
    await tempStorage.move(newKey, activeStorage);
    await activeStorage.delete(key);
    expect(await activeStorage.exists(key)).toBe(false);
    expect(await activeStorage.exists(newKey)).toBe(true);
    expect(await tempStorage.exists(newKey)).toBe(false);

    // cleaning
    await activeStorage.delete(newKey);
    expect(await activeStorage.exists(newKey)).toBe(false);
  });
});

describe('LocalStorage keys', () => {
  test('lists the files in order, after a key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    try {
      const storage = new LocalStorage(dir);
      for (const key of ['2.jpg', '1.jpg', '1BI.jpg']) {
        fs.writeFileSync(path.join(dir, key), '');
      }
      fs.mkdirSync(path.join(dir, 'sub'));
      const keys = async (startAfter?: string): Promise<string[]> => {
        const result: string[] = [];
        for await (const key of storage.keys(startAfter)) {
          result.push(key);
        }
        return result;
      };
      expect(await keys()).toEqual(['1.jpg', '1BI.jpg', '2.jpg']);
      expect(await keys('1.jpg')).toEqual(['1BI.jpg', '2.jpg']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
