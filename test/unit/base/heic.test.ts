import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import exifr from 'exifr';
import sharp from 'sharp';
import { afterAll, describe, expect, test } from 'vitest';

import { getFileFormat } from '../../../src/image/filetype.js';
import { convertHeicToJpeg } from '../../../src/image/heic.js';

// Test images, 320x240 as stored: a body (200,100,50) and a band of 40 px at the top (40,60,200), in Display P3.
// Made with heif-enc (libheif 1.23, x265) from a JPEG, and exiftool:
// - heic-irot.heic: ICC profile, irot (rotation of the file) and EXIF Orientation 6, as in the photos of phones
// - heic-exif.heic: ICC profile, EXIF Orientation 6, no irot
// - heic-nclx.heic: nclx colour property (primaries 12, Display P3), no ICC profile nor EXIF
// heic-large-exif.heic: 4000x3000 in sRGB, EXIF Orientation 6, no irot nor ICC profile
// In sRGB, the body is (214,92,32) and the band (35,60,206) (ImageMagick, little CMS).
const BODY = [214, 92, 32];
const BAND = [35, 60, 206];

// a HEIC whose headers are read, but not its image: the data zeroed
const brokenHeic = (): Buffer => {
  const heic = fs.readFileSync('test/data/heic-irot.heic');
  heic.fill(0, heic.indexOf('mdat') + 4);
  return heic;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heic-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const convert = async (name: string): Promise<string> => {
  const jpeg = path.join(dir, `${name}.jpg`);
  await convertHeicToJpeg(`test/data/${name}.heic`, jpeg);
  return jpeg;
};

const pixel = async (file: string, left: number, top: number): Promise<number[]> => [
  ...(await sharp(file).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer())
];

const expectColour = (actual: number[], expected: number[]): void => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, channel) => expect(Math.abs((actual.at(channel) ?? 0) - value)).toBeLessThanOrEqual(4));
};

describe('HEIC', () => {
  test.each(['heic-irot.heic', 'heic-exif.heic', 'heic-nclx.heic'])('%s is a HEIC', async name => {
    expect(await getFileFormat(`test/data/${name}`)).toBe('heic');
  });

  test('tells AVIF (HEIF with AV1 images) from HEIC', async () => {
    const avif = path.join(dir, 'image.avif');
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#888' } })
      .avif()
      .toFile(avif);
    expect(await getFileFormat(avif)).toBe('avif');
  });

  test.each(['heic-irot', 'heic-exif'])('converts %s upright, in sRGB, keeping its EXIF', async name => {
    const jpeg = await convert(name);
    const { format, width, height, orientation, exif, icc } = await sharp(jpeg).metadata();
    expect({ format, width, height, orientation }).toEqual({ format: 'jpeg', width: 240, height: 320, orientation: 1 });
    expect(icc).toBeUndefined();
    // rotated clockwise: the band is on the right
    expectColour(await pixel(jpeg, 220, 160), BAND);
    expectColour(await pixel(jpeg, 60, 160), BODY);
    expect(exif).toBeDefined();
    // exifr reads files with an API of Node removed since: a buffer
    const tags = (await exifr.parse(fs.readFileSync(jpeg))) as Record<string, unknown>;
    expect(tags['Model']).toBe('Test Phone');
    expect(tags['latitude']).toBeCloseTo(45.8326, 4);
    expect(tags['longitude']).toBeCloseTo(6.8652, 4);
    expect(tags['DateTimeOriginal']).toEqual(new Date(2026, 6, 14, 10));
  });

  test('converts the colours of an nclx property', async () => {
    const jpeg = await convert('heic-nclx');
    const { width, height, orientation = 1 } = await sharp(jpeg).metadata();
    expect({ width, height, orientation }).toEqual({ width: 320, height: 240, orientation: 1 });
    expectColour(await pixel(jpeg, 160, 20), BAND);
    expectColour(await pixel(jpeg, 160, 150), BODY);
  });

  // 4000x3000 as stored, a band of 300 px at the top, EXIF Orientation 6 without irot
  test('reduces a HEIC over the limits, after its rotation', async () => {
    const jpeg = await convert('heic-large-exif');
    const { width, height, orientation = 1 } = await sharp(jpeg).metadata();
    expect({ width, height, orientation }).toEqual({ width: 2304, height: 3072, orientation: 1 });
    // rotated clockwise: the band is on the right
    expectColour(await pixel(jpeg, 2250, 1500), [40, 60, 200]);
    expectColour(await pixel(jpeg, 1000, 1500), [200, 100, 50]);
  });

  test('converts several images at a time', async () => {
    const files = await Promise.all(['heic-irot', 'heic-exif', 'heic-nclx', 'heic-irot'].map(convert));
    expect(files).toHaveLength(4);
  });

  test('fails on an image that cannot be decoded', async () => {
    const broken = path.join(dir, 'broken.heic');
    fs.writeFileSync(broken, brokenHeic());
    await expect(convertHeicToJpeg(broken, path.join(dir, 'broken.jpg'))).rejects.toThrow('HEIC decoding failed');
  });

  test('converts the next images after a failed conversion', async () => {
    const broken = path.join(dir, 'broken-first.heic');
    fs.writeFileSync(broken, brokenHeic());
    const [failed, converted] = await Promise.allSettled([
      convertHeicToJpeg(broken, path.join(dir, 'broken-first.jpg')),
      convert('heic-exif')
    ]);
    expect(failed.status).toBe('rejected');
    expect(converted.status).toBe('fulfilled');
  });
});
