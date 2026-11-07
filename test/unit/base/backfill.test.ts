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
    // the JPEG thumbnails are left as they are
    expect(files()).not.toContain('1_1MI.jpg');
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

  test('counts a failed image and goes on', async () => {
    put('0_9.jpg', 'invalid_content.jpg');
    const result = await backfillAvif(active, tempStorage, options, log);
    expect(result).toMatchObject({ missing: 3, rendered: 2, failed: 1 });
    expect(log.error).toHaveBeenCalledWith('Backfill: 0_9.jpg failed', expect.anything());
  });
});
