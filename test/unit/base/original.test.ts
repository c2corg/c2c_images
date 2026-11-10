import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp, { type Sharp } from 'sharp';
import { afterAll, describe, expect, test } from 'vitest';

import { describeOriginal, reduceOriginal, storedSize } from '../../../src/image/original.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'original-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// an image of that size, small whatever its size
const image = async (
  name: string,
  width: number,
  height: number,
  transform = (s: Sharp): Sharp => s
): Promise<string> => {
  const file = path.join(dir, name);
  await transform(sharp({ create: { width, height, channels: 3, background: '#c86432' } })).toFile(file);
  return file;
};

describe('storedSize', () => {
  test.each([
    // [width, height, stored]
    [4032, 3024, { width: 3072, height: 2304 }], // 12 MP phone photo
    [3024, 4032, { width: 2304, height: 3072 }], // portrait
    [3072, 2048, undefined], // already small enough
    [1200, 800, undefined],
    [8000, 3000, { width: 5461, height: 2048 }], // panorama: short side 2048
    [12000, 3000, { width: 8000, height: 2000 }], // panorama: 16 megapixels
    [3000, 9000, { width: 2048, height: 6144 }], // vertical panorama
    [6000, 2000, undefined] // panorama of 12 megapixels
  ])('%i x %i', (width, height, stored) => {
    expect(storedSize({ width, height })).toEqual(stored);
  });

  test('keeps the panoramas under 16 megapixels whatever their ratio', () => {
    const { width, height } = storedSize({ width: 36000, height: 3000 }) ?? { width: 0, height: 0 };
    expect(width * height).toBeLessThanOrEqual(16_000_000);
    expect(width / height).toBeCloseTo(12, 1);
  });
});

describe('reduceOriginal', () => {
  test('reduces a JPEG over the limits, keeping its orientation and colour profile', async () => {
    const file = await image('large.jpg', 4000, 3000, s =>
      s.withMetadata({ orientation: 6 }).withIccProfile('p3').jpeg({ quality: 95 })
    );

    await reduceOriginal(file, '.jpg');

    const { format, width, height, orientation, icc } = await sharp(file).metadata();
    expect({ format, width, height, orientation }).toEqual({
      format: 'jpeg',
      width: 3072,
      height: 2304,
      orientation: 6
    });
    expect(icc).toBeDefined();
    // as displayed: turned by the orientation
    expect(await describeOriginal(file)).toEqual({ width: 2304, height: 3072, size: fs.statSync(file).size });
  });

  test('keeps PNG as PNG', async () => {
    const file = await image('large.png', 2000, 7000, s => s.png());
    await reduceOriginal(file, '.png');
    const { format, width, height } = await sharp(file).metadata();
    expect({ format, width, height }).toEqual({ format: 'png', width: 2000, height: 7000 });

    const larger = await image('larger.png', 3000, 9000, s => s.png());
    await reduceOriginal(larger, '.png');
    const reduced = await sharp(larger).metadata();
    expect({ format: reduced.format, width: reduced.width, height: reduced.height }).toEqual({
      format: 'png',
      width: 2048,
      height: 6144
    });
  });

  test('keeps the files under the limits, and the GIF, as they are', async () => {
    const small = await image('small.jpg', 3072, 2304, s => s.jpeg());
    const gif = await image('large.gif', 4000, 3000, s => s.gif());
    const before = [fs.readFileSync(small), fs.readFileSync(gif)];

    await reduceOriginal(small, '.jpg');
    await reduceOriginal(gif, '.gif');

    expect([fs.readFileSync(small), fs.readFileSync(gif)]).toEqual(before);
    expect(fs.readdirSync(dir).filter(name => name.endsWith('.reduced'))).toEqual([]);
  });
});
