import fs from 'node:fs';
import { generateUniqueKeyPrefix } from '../../../src/koa/utils.js';
import { LocalStorage, tempStorage } from '../../../src/storage/storage.js';

const key = `${generateUniqueKeyPrefix()}.png`;
const newKey = `${generateUniqueKeyPrefix()}.png`;
const file = 'test/data/piano.png';

describe('Local storage', () => {
  let incomingStorage: LocalStorage;
  let activeStorage: LocalStorage;
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    incomingStorage = new LocalStorage(process.env['INCOMING_FOLDER']!);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
