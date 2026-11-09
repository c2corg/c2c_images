import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import sharp from 'sharp';

import { RESIZING_CONFIG } from '../config.js';
import type { LocalStorage, Storage } from '../storage/storage.js';

import { sanitizeSvg } from './svg.js';
import { removeFromTemp } from './temp.js';
import { createThumbnail } from './thumbnails.js';

export interface BackfillOptions {
  /** resume after this key (the last original of the previous run) */
  startAfter?: string | undefined;
  /** stop after this number of images rendered */
  limit?: number | undefined;
  /** images rendered at the same time */
  concurrency: number;
  /** pause between two batches, in ms */
  pauseMs: number;
  /** count the images without AVIF thumbnails, render nothing */
  dryRun: boolean;
  /** also render again the JPEG thumbnails of the JPEG originals (those of the SVG originals always are) */
  reencodeJpeg: boolean;
  /**
   * also replace the SVG originals by their sanitized copy (v6_images stored them as uploaded), and take every SVG,
   * with its AVIF thumbnails or not
   */
  sanitizeSvg?: boolean | undefined;
  /** only the SVG originals: they can be done first, in a short pass */
  svgOnly?: boolean | undefined;
  /** CSV file where to append filename,width,height,file_size of each original rendered (for the documents of v6_api) */
  sizes?: string | undefined;
  /** stop after the current batch */
  signal?: AbortSignal | undefined;
}

export interface BackfillResult {
  /** originals seen */
  scanned: number;
  /** originals to render: without all their AVIF thumbnails, or SVG with sanitizeSvg */
  missing: number;
  rendered: number;
  /** SVG originals replaced by their sanitized copy */
  sanitized: number;
  failed: number;
  /** the last original done: resume after it */
  lastKey: string | undefined;
  /** stopped by the limit or the signal, before the end of the storage */
  stopped: boolean;
}

interface Logger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

/**
 * The size of an image as a browser shows it: after its EXIF orientation; for an SVG, its own width and height (user
 * units, the default density), not the size of its thumbnails.
 */
const imageSize = async (file: string): Promise<{ width: number; height: number }> => {
  const metadata = await sharp(file, { limitInputPixels: false }).metadata();
  return metadata.autoOrient;
};

const ORIGINAL = /^(\d+_\d+)\.(jpg|png|gif|svg)$/;

/**
 * Renders the missing AVIF thumbnails of the images of a storage (the active bucket), from their originals, in the
 * order of the keys. The keys sharing a prefix are contiguous in that order: an image is complete (original and
 * thumbnails seen) once a key that does not start with its prefix comes.
 */
export const backfillAvif = async (
  active: Storage,
  temp: LocalStorage,
  options: BackfillOptions,
  log: Logger
): Promise<BackfillResult> => {
  const suffixes = RESIZING_CONFIG.map(({ suffix }) => suffix);
  const result: BackfillResult = {
    scanned: 0,
    missing: 0,
    rendered: 0,
    sanitized: 0,
    failed: 0,
    lastKey: undefined,
    stopped: false
  };

  // the images whose keys may still come: prefix => original key, and the sizes with an AVIF thumbnail
  const pending = new Map<string, { original?: string; avif: Set<string> }>();
  let batch: string[] = [];

  if (options.sizes && !fs.existsSync(options.sizes)) {
    await fs.promises.writeFile(options.sizes, 'filename,width,height,file_size\n');
  }

  const render = async (key: string): Promise<void> => {
    const dir = temp.path();
    const { ext } = path.parse(key);
    try {
      await active.copy(key, temp);
      let fileSize = (await fs.promises.stat(temp.path(key))).size;
      // the old SVGs were stored as uploaded (v6_images): rendered from their sanitized copy, the original unchanged
      // unless sanitizeSvg
      let replaceOriginal = false;
      if (ext === '.svg') {
        const svg = await fs.promises.readFile(temp.path(key), 'utf8');
        const sanitized = sanitizeSvg(svg);
        await fs.promises.writeFile(temp.path(key), sanitized);
        replaceOriginal = Boolean(options.sanitizeSvg) && sanitized !== svg;
        if (replaceOriginal) {
          fileSize = Buffer.byteLength(sanitized);
        }
      }
      const size = options.sizes ? await imageSize(temp.path(key)) : undefined;
      const keys: string[] = [];
      for (const config of RESIZING_CONFIG) {
        await createThumbnail(dir, key, config, '.avif');
        keys.push(`${path.parse(key).name}${config.suffix}.avif`);
        // the JPEG thumbnails of SVGs always: today's rendering is better (sanitizer, fonts, framing; #1199)
        if (ext === '.svg' || (options.reencodeJpeg && ext === '.jpg')) {
          await createThumbnail(dir, key, config);
          keys.push(`${path.parse(key).name}${config.suffix}.jpg`);
        }
      }
      await Promise.all(keys.map(async thumbnail => temp.move(thumbnail, active)));
      result.rendered++;
      // last: a failure before leaves the original as it was
      if (replaceOriginal) {
        await temp.move(key, active);
        result.sanitized++;
        log.info(`Backfill: ${key} replaced by its sanitized copy`);
      }
      if (options.sizes && size) {
        await fs.promises.appendFile(options.sizes, `${key},${size.width},${size.height},${fileSize}\n`);
      }
    } catch (error) {
      result.failed++;
      log.error(`Backfill: ${key} failed`, error);
    } finally {
      await removeFromTemp(key);
    }
  };

  const runBatch = async (): Promise<void> => {
    if (!batch.length) {
      return;
    }
    const keys = batch;
    batch = [];
    if (!options.dryRun) {
      await Promise.all(keys.map(render));
      if (options.pauseMs) {
        await sleep(options.pauseMs);
      }
    }
    result.lastKey = keys.at(-1);
    log.info(
      `Backfill: ${result.scanned} images seen, ${result.missing} without AVIF, ${result.rendered} rendered, ${result.sanitized} SVG sanitized, ${result.failed} failed, last ${result.lastKey}`
    );
  };

  const complete = async (prefix: string): Promise<void> => {
    const image = pending.get(prefix);
    pending.delete(prefix);
    if (!image?.original || (options.svgOnly && !image.original.endsWith('.svg'))) {
      return;
    }
    result.scanned++;
    const sanitize = Boolean(options.sanitizeSvg) && image.original.endsWith('.svg');
    if (!sanitize && suffixes.every(suffix => image.avif.has(suffix))) {
      return;
    }
    result.missing++;
    batch.push(image.original);
    if (batch.length >= options.concurrency) {
      await runBatch();
    }
  };

  const shouldStop = (): boolean =>
    Boolean(options.signal?.aborted) || (options.limit !== undefined && result.missing >= options.limit);

  for await (const key of active.keys(options.startAfter)) {
    for (const prefix of pending.keys()) {
      if (!key.startsWith(prefix)) {
        await complete(prefix);
      }
    }
    if (shouldStop()) {
      result.stopped = true;
      break;
    }
    const original = ORIGINAL.exec(key);
    if (original?.[1]) {
      pending.set(original[1], { original: key, avif: pending.get(original[1])?.avif ?? new Set() });
      continue;
    }
    const thumbnail = /^(\d+_\d+)([A-Z]+)\.avif$/.exec(key);
    if (thumbnail?.[1] && thumbnail[2]) {
      const image = pending.get(thumbnail[1]);
      image?.avif.add(thumbnail[2]);
    }
  }
  if (!result.stopped) {
    for (const prefix of [...pending.keys()]) {
      await complete(prefix);
    }
  }
  await runBatch();
  return result;
};
