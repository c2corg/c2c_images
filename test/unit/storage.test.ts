import { LocalStorage, tempStorage } from '../../src/storage.js';

const key = 'test.png';
const file = 'test/data/piano.png';

describe('Local storage', () => {
  let incomingStorage: LocalStorage;
  let activeStorage: LocalStorage;
  beforeAll(() => {
    incomingStorage = new LocalStorage('/tmp/incoming');
    activeStorage = new LocalStorage('/tmp/active');
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
    expect(activeStorage.delete('does_not_exist.jpg')).rejects.toThrow();
  });

  test('Resizing protocol', async () => {
    // for resizing object is in active storage
    await activeStorage.put(key, file);

    // get object in temp storage
    await activeStorage.copy(key, tempStorage);
    expect(await tempStorage.exists(key)).toBe(true);

    // resizing...

    // move it back to active storage
    await tempStorage.move(key, activeStorage);
    expect(await activeStorage.exists(key)).toBe(true);
    expect(await tempStorage.exists(key)).toBe(false);

    // cleaning
    await activeStorage.delete(key);
    expect(await activeStorage.exists(key)).toBe(false);
  });
});
