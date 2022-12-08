import path from 'node:path';
import { autoOrient } from '../../../src/image/autoorient.js';
import { getFileSize } from '../../../src/image/filesize.js';
import { tempStorage } from '../../../src/storage/storage.js';

const copytestImageToTempStorage = async (filename: string): Promise<void> => {
  const { base } = path.parse(filename);
  await tempStorage.put(base, `test/data/${filename}`);
};

describe('Auto orient jpeg images', () => {
  test('POST /upload will auto orient image', async () => {
    const key = 'autoorient.jpg';
    await copytestImageToTempStorage(key);
    await autoOrient(tempStorage.path(key));
    expect(await getFileSize(tempStorage.path(key))).toBe('133x200');
  });
});
