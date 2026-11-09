import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, test } from 'vitest';

import { AVIF_EFFORT, AVIF_QUALITY, RESIZING_CONFIG } from '../../../src/config.js';
import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { getFileFormat } from '../../../src/image/filetype.js';
import { createThumbnail, createThumbnails } from '../../../src/image/thumbnails.js';
import { tempStorage } from '../../../src/storage/storage.js';
import { imageInfo } from '../../helpers/image.js';

// a copy of a test image in the temp storage, under a unique key
const copyToTemp = async (filename: string): Promise<string> => {
  const key = `${generateUniqueKeyPrefix()}${path.extname(filename)}`;
  await tempStorage.put(key, `test/data/${filename}`);
  return key;
};

const config = (suffix: string): (typeof RESIZING_CONFIG)[number] => {
  const found = RESIZING_CONFIG.find(c => c.suffix === suffix);
  if (!found) {
    throw new Error(suffix);
  }
  return found;
};

describe('Format detection', () => {
  test.each([
    ['violin.jpg', 'jpg'],
    ['piano.png', 'png'],
    ['music.gif', 'gif'],
    ['animated.gif', 'gif'],
    ['pipe_organ.svg', 'svg']
  ])('%s is %s', async (filename, format) => {
    expect(await getFileFormat(`test/data/${filename}`)).toBe(format);
  });

  test.each(['music.tiff', 'invalid_content.jpg'])('%s is refused', async filename => {
    await expect(getFileFormat(`test/data/${filename}`)).rejects.toThrow('Unsupported image format.');
  });
});

describe('Thumbnails', () => {
  // BI and MI fit in their size without enlarging, SI is cropped to its size
  test.each([
    ['violin.jpg', 'jpeg', { BI: '426x592', MI: '288x400', SI: '200x200' }],
    ['piano.png', 'png', { BI: '1151x551', MI: '400x191', SI: '200x200' }],
    ['music.gif', 'gif', { BI: '600x244', MI: '400x163', SI: '200x200' }]
  ])('%s', async (filename, format, sizes) => {
    const key = await copyToTemp(filename);
    const { name, ext } = path.parse(key);
    for (const [suffix, size] of Object.entries(sizes)) {
      await createThumbnail(tempStorage.path(), key, config(suffix));
      expect(await imageInfo(tempStorage.path(`${name}${suffix}${ext}`))).toMatchObject({ format, size });
    }
  });

  test('animated GIF stay animated', async () => {
    const key = await copyToTemp('animated.gif');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('SI'));
    expect(await imageInfo(tempStorage.path(`${name}SI.gif`))).toMatchObject({ size: '200x200', pages: 3 });
    await createThumbnail(tempStorage.path(), key, config('MI'), '.webp');
    expect(await imageInfo(tempStorage.path(`${name}MI.webp`))).toMatchObject({
      format: 'webp',
      size: '120x80',
      pages: 3
    });
  });

  test('SVG thumbnails are JPEG on a white background', async () => {
    const key = await copyToTemp('pipe_organ.svg');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('MI'));
    const file = tempStorage.path(`${name}MI.jpg`);
    expect(await imageInfo(file)).toMatchObject({ format: 'jpeg', size: '360x400' });
    // the corner of the drawing is transparent
    const { data } = await sharp(file).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({
      resolveWithObject: true
    });
    expect([...data].every(value => value > 245)).toBe(true);
  });

  test('thumbnails are upright', async () => {
    // EXIF orientation 7: stored 200x133, displayed 133x200
    const key = await copyToTemp('autoorient.jpg');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('BI'));
    expect(await imageInfo(tempStorage.path(`${name}BI.jpg`))).toMatchObject({ size: '133x200' });
  });

  test('modern formats', async () => {
    const key = await copyToTemp('violin.jpg');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('MI'), '.webp');
    await createThumbnail(tempStorage.path(), key, config('MI'), '.avif');
    expect(await imageInfo(tempStorage.path(`${name}MI.webp`))).toMatchObject({ format: 'webp', size: '288x400' });
    expect(await imageInfo(tempStorage.path(`${name}MI.avif`))).toMatchObject({ format: 'heif', size: '288x400' });
  });

  test('createThumbnails renders the base thumbnails', async () => {
    const key = await copyToTemp('pipe_organ.svg');
    const { name } = path.parse(key);
    const { allRendered } = await createThumbnails(tempStorage.path(key));
    await allRendered;
    for (const suffix of ['BI', 'MI', 'SI']) {
      expect(await imageInfo(tempStorage.path(`${name}${suffix}.jpg`))).toMatchObject({ format: 'jpeg' });
    }
  });
});

describe('Encoding', () => {
  test('JPEG thumbnails go through mozjpeg: progressive, smaller than the plain encoder at the same quality', async () => {
    const key = await copyToTemp('violin.jpg');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('BI'));
    const file = tempStorage.path(`${name}BI.jpg`);
    const { isProgressive } = await sharp(file).metadata();
    expect(isProgressive).toBe(true);
    const plain = await sharp(`test/data/violin.jpg`).autoOrient().jpeg({ quality: 90 }).toBuffer();
    expect(fs.statSync(file).size).toBeLessThan(plain.length);
  });

  test('AVIF thumbnails at AVIF_QUALITY: smaller than the JPEG ones', async () => {
    const key = await copyToTemp('violin.jpg');
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('BI'));
    await createThumbnail(tempStorage.path(), key, config('BI'), '.avif');
    const jpeg = fs.statSync(tempStorage.path(`${name}BI.jpg`)).size;
    const avif = fs.statSync(tempStorage.path(`${name}BI.avif`)).size;
    expect(avif).toBeLessThan(jpeg / 1.5);
  });
});

describe('SVG AVIF by content', () => {
  const avifOf = async (file: string): Promise<number> => {
    const key = await copyToTemp(file);
    const { name } = path.parse(key);
    await createThumbnail(tempStorage.path(), key, config('MI'), '.avif');
    return fs.statSync(tempStorage.path(`${name}MI.avif`)).size;
  };
  // the same rendering at AVIF_QUALITY, with the AVIF_EFFORT of the service
  const atDefaultQuality = async (file: string): Promise<number> =>
    (
      await sharp(`test/data/${file}`, { density: 96 })
        .flatten({ background: 'white' })
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
        .toBuffer()
    ).length;

  test('a drawing at AVIF_QUALITY_DRAWING: larger than at AVIF_QUALITY', async () => {
    expect(await avifOf('pipe_organ.svg')).toBeGreaterThan(await atDefaultQuality('pipe_organ.svg'));
  });

  test('a photo with a route at AVIF_QUALITY', async () => {
    expect(await avifOf('route-on-photo.svg')).toBe(await atDefaultQuality('route-on-photo.svg'));
  });
});
