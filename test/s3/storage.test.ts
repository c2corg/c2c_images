import { getS3Params, S3Storage, tempStorage } from '../../src/storage';

const key = 'test.png';
const file = 'test/data/piano.png';

describe('S3 storage', () => {
  let incomingStorage: S3Storage;
  let activeStorage: S3Storage;
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    incomingStorage = new S3Storage(process.env['INCOMING_BUCKET']!, getS3Params('INCOMING'), 'private', true);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    activeStorage = new S3Storage(process.env['ACTIVE_BUCKET']!, getS3Params('ACTIVE'), 'public-read');
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

    // delete a file that does not exist won't throw in s3
    expect(activeStorage.delete('does_not_exist.jpg')).resolves.toBeUndefined();
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
