import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp, { type Sharp } from 'sharp';
import { afterAll, describe, expect, test } from 'vitest';

import { convertImage, isImageSequence, previewDataUrl } from '../../../src/image/convert.js';
import { getFileFormat } from '../../../src/image/filetype.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const BODY = { r: 200, g: 100, b: 50 };

// an image of that size, with a band of a tenth of its height at the top (to see the rotation)
const image = async (
  name: string,
  { width = 320, height = 240, alpha = 1 } = {},
  encode: (s: Sharp) => Sharp = (s): Sharp => s
): Promise<string> => {
  const file = path.join(dir, name);
  const band = await sharp({
    create: { width, height: Math.round(height / 10), channels: 4, background: { r: 40, g: 60, b: 200, alpha } }
  })
    .png()
    .toBuffer();
  await encode(
    sharp({ create: { width, height, channels: 4, background: { ...BODY, alpha } } }).composite([
      { input: band, top: 0, left: 0 }
    ])
  ).toFile(file);
  return file;
};

const convert = async (file: string): Promise<{ ext: string; output: string }> => {
  const output = `${file}.out`;
  const ext = await convertImage(file, await getFileFormat(file), output);
  return { ext, output };
};

const pixel = async (file: string, left: number, top: number): Promise<number[]> => [
  ...(await sharp(file).autoOrient().extract({ left, top, width: 1, height: 1 }).raw().toBuffer())
];

describe('getFileFormat of the converted formats', () => {
  test.each([
    ['image.webp', (s: Sharp): Sharp => s.webp(), 'webp'],
    ['image.avif', (s: Sharp): Sharp => s.avif(), 'avif'],
    ['image.tiff', (s: Sharp): Sharp => s.tiff(), 'tiff'],
    ['image.gif', (s: Sharp): Sharp => s.gif(), 'gif']
  ])('%s', async (name, encode, format) => {
    expect(await getFileFormat(await image(name, {}, encode))).toBe(format);
  });

  test('refuses the animated images and the multi-page TIFF', async () => {
    const animated = sharp('test/data/animated.gif', { animated: true });
    const webp = path.join(dir, 'animated.webp');
    const tiff = path.join(dir, 'pages.tiff');
    await animated.clone().webp().toFile(webp);
    await animated.clone().tiff().toFile(tiff);
    await expect(getFileFormat(webp)).rejects.toThrow('Unsupported image format.');
    await expect(getFileFormat(tiff)).rejects.toThrow('Unsupported image format.');
  });

  test('refuses an AVIF image sequence', async () => {
    // the file type box of an animated AVIF: major brand avis, compatible brands
    const avif = await image('sequence.avif', {}, s => s.avif());
    const content = fs.readFileSync(avif);
    expect(content.toString('latin1', 8, 12)).toBe('avif');
    expect(await isImageSequence(avif)).toBe(false);
    content.write('avis', 8, 'latin1');
    fs.writeFileSync(avif, content);
    expect(await isImageSequence(avif)).toBe(true);
    await expect(getFileFormat(avif)).rejects.toThrow('Unsupported image format.');
  });
});

describe('convertImage', () => {
  test('converts an opaque WebP to JPEG, keeping its EXIF orientation and colour profile', async () => {
    const webp = await image('photo.webp', {}, s => s.withMetadata({ orientation: 6 }).withIccProfile('p3').webp());
    const { ext, output } = await convert(webp);
    expect(ext).toBe('jpg');
    const { format, width, height, orientation, icc, channels } = await sharp(output).metadata();
    expect({ format, width, height, orientation, channels }).toEqual({
      format: 'jpeg',
      width: 320,
      height: 240,
      orientation: 6,
      channels: 3
    });
    expect(icc).toBeDefined();
  });

  test('converts an AVIF upright: libvips applies its rotation', async () => {
    const avif = await image('photo.avif', {}, s => s.withMetadata({ orientation: 6 }).avif());
    const { output } = await convert(avif);
    const { width, height, orientation = 1 } = await sharp(output).metadata();
    expect({ width, height, orientation }).toEqual({ width: 240, height: 320, orientation: 1 });
    // rotated clockwise: the band is on the right
    const [red = 0, , blue = 0] = await pixel(output, 230, 160);
    expect(blue).toBeGreaterThan(red);
  });

  test('keeps the transparency in PNG', async () => {
    const avif = await image('logo.avif', { alpha: 0.5 }, s => s.avif());
    const { ext, output } = await convert(avif);
    expect(ext).toBe('png');
    const { format, hasAlpha } = await sharp(output).metadata();
    expect({ format, hasAlpha }).toEqual({ format: 'png', hasAlpha: true });
  });

  test('converts a GIF to PNG, a drawing', async () => {
    const { ext, output } = await convert(await image('drawing.gif', {}, s => s.gif()));
    expect(ext).toBe('png');
    expect((await sharp(output).metadata()).format).toBe('png');
  });

  test('converts a CMYK TIFF to sRGB', async () => {
    const tiff = await image('scan.tiff', {}, s => s.toColourspace('cmyk').tiff());
    expect((await sharp(tiff).metadata()).space).toBe('cmyk');
    const { ext, output } = await convert(tiff);
    expect(ext).toBe('jpg');
    expect((await sharp(output).metadata()).space).toBe('srgb');
  });

  test('reduces an image over the limits', async () => {
    const tiff = await image('large.tiff', { width: 4000, height: 3000 }, s => s.tiff({ compression: 'deflate' }));
    const { output } = await convert(tiff);
    const { width, height } = await sharp(output).metadata();
    expect({ width, height }).toEqual({ width: 3072, height: 2304 });
  });
});

describe('previewDataUrl', () => {
  test('is a small JPEG, upright', async () => {
    const jpeg = await image('large.jpg', { width: 4000, height: 3000 }, s =>
      s.withMetadata({ orientation: 6 }).jpeg()
    );
    const preview = await previewDataUrl(jpeg);
    expect(preview).toMatch(/^data:image\/jpeg;base64,/);
    const content = Buffer.from(preview.split(',')[1] ?? '', 'base64');
    const { format, width, height } = await sharp(content).metadata();
    expect({ format, width, height }).toEqual({ format: 'jpeg', width: 360, height: 480 });
    expect(content.length).toBeLessThan(30_000);
  });
});
