import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { RESIZING_CONFIG } from '../config.js';
import type { LocalStorage, Storage } from '../storage/storage.js';

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
  /** also render again the JPEG thumbnails (of the JPEG and SVG originals), with the current encoder */
  reencodeJpeg: boolean;
  /** stop after the current batch */
  signal?: AbortSignal | undefined;
}

export interface BackfillResult {
  /** originals seen */
  scanned: number;
  /** originals without all their AVIF thumbnails */
  missing: number;
  rendered: number;
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
    failed: 0,
    lastKey: undefined,
    stopped: false
  };

  // the images whose keys may still come: prefix => original key, and the sizes with an AVIF thumbnail
  const pending = new Map<string, { original?: string; avif: Set<string> }>();
  let batch: string[] = [];

  const render = async (key: string): Promise<void> => {
    const dir = temp.path();
    const { ext } = path.parse(key);
    try {
      await active.copy(key, temp);
      const keys: string[] = [];
      for (const config of RESIZING_CONFIG) {
        await createThumbnail(dir, key, config, '.avif');
        keys.push(`${path.parse(key).name}${config.suffix}.avif`);
        if (options.reencodeJpeg && (ext === '.jpg' || ext === '.svg')) {
          await createThumbnail(dir, key, config);
          keys.push(`${path.parse(key).name}${config.suffix}.jpg`);
        }
      }
      await Promise.all(keys.map(async thumbnail => temp.move(thumbnail, active)));
      result.rendered++;
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
      `Backfill: ${result.scanned} images seen, ${result.missing} without AVIF, ${result.rendered} rendered, ${result.failed} failed, last ${result.lastKey}`
    );
  };

  const complete = async (prefix: string): Promise<void> => {
    const image = pending.get(prefix);
    pending.delete(prefix);
    if (!image?.original) {
      return;
    }
    result.scanned++;
    if (suffixes.every(suffix => image.avif.has(suffix))) {
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
