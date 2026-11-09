import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { backfillAvif, type BackfillOptions } from '../../../src/image/backfill.js';
import { LocalStorage, tempStorage } from '../../../src/storage/storage.js';

const log = { info: vi.fn(), error: vi.fn() };
const options: BackfillOptions = { concurrency: 2, pauseMs: 0, dryRun: false, reencodeJpeg: false };

let dir: string;
let active: LocalStorage;

const put = (key: string, file: string): void => {
  fs.copyFileSync(`test/data/${file}`, path.join(dir, key));
};
const files = (): string[] => fs.readdirSync(dir).sort();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
  active = new LocalStorage(dir);
  // 1_1: a JPEG without AVIF; 1_12: a JPEG whose key starts like 1_1's, with its AVIF; 2_2: an SVG without AVIF
  put('1_1.jpg', 'violin.jpg');
  put('1_1BI.jpg', 'violin.jpg');
  put('1_12.jpg', 'piano.png');
  for (const suffix of ['BI', 'MI', 'SI']) {
    put(`1_12${suffix}.avif`, 'piano.png');
  }
  put('2_2.svg', 'pipe_organ.svg');
  put('readme.txt', 'invalid_content.jpg');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// AVIF rendering takes seconds, more when the other test files run alongside
describe('backfillAvif', { timeout: 60_000 }, () => {
  test('dry run: counts the images without their AVIF thumbnails, renders nothing', async () => {
    const before = files();
    const result = await backfillAvif(active, tempStorage, { ...options, dryRun: true }, log);
    expect(result).toMatchObject({
      scanned: 3,
      missing: 2,
      rendered: 0,
      sanitized: 0,
      failed: 0,
      stopped: false,
      lastKey: '2_2.svg'
    });
    expect(files()).toEqual(before);
  });

  test('renders the missing AVIF thumbnails, and nothing the second time', async () => {
    const result = await backfillAvif(active, tempStorage, options, log);
    expect(result).toMatchObject({ scanned: 3, missing: 2, rendered: 2, failed: 0 });
    for (const key of ['1_1', '2_2']) {
      for (const suffix of ['BI', 'MI', 'SI']) {
        expect(files()).toContain(`${key}${suffix}.avif`);
      }
    }
    // the JPEG thumbnails of the JPEG originals are left as they are, those of the SVGs rendered again
    expect(files()).not.toContain('1_1MI.jpg');
    expect(files()).toEqual(expect.arrayContaining(['2_2BI.jpg', '2_2MI.jpg', '2_2SI.jpg']));
    expect(fs.readdirSync(tempStorage.path()).filter(file => /^(1_1|2_2)[A-Z.]/.test(file))).toEqual([]);

    expect(await backfillAvif(active, tempStorage, options, log)).toMatchObject({ missing: 0, rendered: 0 });
  });

  test('stops at the limit, and resumes after the last image done', async () => {
    const first = await backfillAvif(active, tempStorage, { ...options, concurrency: 1, limit: 1 }, log);
    expect(first).toMatchObject({ missing: 1, rendered: 1, stopped: true, lastKey: '1_1.jpg' });
    expect(files()).not.toContain('2_2BI.avif');

    const second = await backfillAvif(active, tempStorage, { ...options, startAfter: first.lastKey }, log);
    expect(second).toMatchObject({ missing: 1, rendered: 1, stopped: false, lastKey: '2_2.svg' });
    expect(files()).toContain('2_2BI.avif');
  });

  test('stops after the current batch when asked', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await backfillAvif(active, tempStorage, { ...options, signal: controller.signal }, log)).toMatchObject({
      rendered: 0,
      stopped: true
    });
  });

  test('renders the JPEG thumbnails again when asked', async () => {
    const before = fs.statSync(path.join(dir, '1_1BI.jpg')).size;
    await backfillAvif(active, tempStorage, { ...options, reencodeJpeg: true }, log);
    expect(fs.statSync(path.join(dir, '1_1BI.jpg')).size).not.toBe(before);
    expect(files()).toEqual(expect.arrayContaining(['1_1MI.jpg', '1_1SI.jpg', '2_2BI.jpg']));
  });

  test('replaces the SVG originals by their sanitized copy when asked, even with their AVIF thumbnails', async () => {
    await backfillAvif(active, tempStorage, options, log);
    put('3_3.svg', 'unsafe.svg');
    for (const suffix of ['BI', 'MI', 'SI']) {
      put(`3_3${suffix}.avif`, 'piano.png');
    }
    expect(fs.readFileSync(path.join(dir, '3_3.svg'), 'utf8')).toMatch(/<script/);

    // without the option, an SVG with its AVIF thumbnails is left as it is
    expect(await backfillAvif(active, tempStorage, options, log)).toMatchObject({ missing: 0, sanitized: 0 });

    const result = await backfillAvif(active, tempStorage, { ...options, sanitizeSvg: true }, log);
    expect(result).toMatchObject({ missing: 2, rendered: 2, failed: 0 });
    expect(result.sanitized).toBeGreaterThanOrEqual(1);
    const unsafe = fs.readFileSync(path.join(dir, '3_3.svg'), 'utf8');
    expect(unsafe).not.toMatch(/<script|onload|javascript:/);
    expect(unsafe).toMatch(/<svg/);
    expect(fs.readFileSync(path.join(dir, '2_2.svg'), 'utf8')).toMatch(/<svg/);
    expect(files()).toEqual(expect.arrayContaining(['3_3BI.jpg', '3_3BI.avif', '1_1.jpg']));
    expect(fs.readdirSync(tempStorage.path()).filter(file => /^(2_2|3_3)[A-Z.]/.test(file))).toEqual([]);
  });

  test('takes the SVG originals only when asked', async () => {
    const result = await backfillAvif(active, tempStorage, { ...options, svgOnly: true }, log);
    expect(result).toMatchObject({ scanned: 1, missing: 1, rendered: 1 });
    expect(files()).toContain('2_2BI.avif');
    expect(files()).not.toContain('1_1BI.avif');
  });

  test('writes the sizes of the originals rendered when asked', async () => {
    put('3_3.jpg', 'autoorient.jpg');
    const sizes = path.join(dir, 'sizes.csv');
    await backfillAvif(active, tempStorage, { ...options, sizes }, log);
    const lines = fs.readFileSync(sizes, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('filename,width,height,file_size');
    // after the EXIF orientation; the SVG at its own size (521.333 x 578.832), its sanitized copy not stored
    expect(lines.slice(1).sort()).toEqual([
      `1_1.jpg,426,592,${fs.statSync('test/data/violin.jpg').size}`,
      `2_2.svg,521,579,${fs.statSync('test/data/pipe_organ.svg').size}`,
      `3_3.jpg,133,200,${fs.statSync('test/data/autoorient.jpg').size}`
    ]);

    // appended by the next run, header kept
    put('4_4.png', 'piano.png');
    await backfillAvif(active, tempStorage, { ...options, sizes }, log);
    const all = fs.readFileSync(sizes, 'utf8').trim().split('\n');
    expect(all).toHaveLength(5);
    expect(all.filter(line => line.startsWith('filename'))).toHaveLength(1);
  });

  test('counts a failed image and goes on', async () => {
    put('0_9.jpg', 'invalid_content.jpg');
    const result = await backfillAvif(active, tempStorage, options, log);
    expect(result).toMatchObject({ missing: 3, rendered: 2, failed: 1 });
    expect(log.error).toHaveBeenCalledWith('Backfill: 0_9.jpg failed', expect.anything());
  });
});
