import fs from 'node:fs';
import path from 'node:path';
import { RESIZING_CONFIG } from '../../../src/config.js';
import { rasterizeSvg } from '../../../src/image/convert.js';
import { getFileFormat } from '../../../src/image/filetype.js';
import { createResizedImage } from '../../../src/image/resizing.js';
import { tempStorage } from '../../../src/storage/storage.js';

const RASTER_IMAGES = ['violin.jpg', 'piano.png', 'music.gif'];

const copytestImageToTempStorage = async (filename: string): Promise<void> => {
  const { base } = path.parse(filename);
  await tempStorage.put(base, `test/data/${filename}`);
};

describe('Processing', () => {
  test('Create resized images', async () => {
    for (const key of RASTER_IMAGES) {
      await copytestImageToTempStorage(key);
      for (const config of RESIZING_CONFIG) {
        createResizedImage(tempStorage.path(), key, config);
        expect(fs.existsSync(tempStorage.path(key))).toBe(true);
      }
    }
  });

  test('Create rasterized image', async () => {
    const svgKey = 'pipe_organ.svg';
    const destKey = 'pipe_organ.jpg';
    await copytestImageToTempStorage(svgKey);
    rasterizeSvg(tempStorage.path(svgKey), tempStorage.path(destKey));
    expect(fs.existsSync(tempStorage.path(destKey))).toBe(true);
    expect(getFileFormat(tempStorage.path(destKey))).toBe('png');
  });
});
