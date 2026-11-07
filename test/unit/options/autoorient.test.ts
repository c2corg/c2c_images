import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { autoOrient } from '../../../src/image/autoorient.js';
import { tempStorage } from '../../../src/storage/storage.js';
import { imageInfo } from '../../helpers/image.js';

const copytestImageToTempStorage = async (filename: string): Promise<void> => {
  const { base } = path.parse(filename);
  await tempStorage.put(base, `test/data/${filename}`);
};

describe('Auto orient jpeg images', () => {
  test('POST /upload will auto orient image', async () => {
    const key = 'autoorient.jpg';
    await copytestImageToTempStorage(key);
    await autoOrient(tempStorage.path(key));
    expect(await imageInfo(tempStorage.path(key))).toMatchObject({
      format: 'jpeg',
      size: '133x200',
      orientation: 1
    });
  });

  test('keeps the upright images as they are', async () => {
    const key = 'violin.jpg';
    await copytestImageToTempStorage(key);
    const before = fs.readFileSync(tempStorage.path(key));
    await autoOrient(tempStorage.path(key));
    expect(fs.readFileSync(tempStorage.path(key)).equals(before)).toBe(true);
  });
});
