// Renders the missing AVIF thumbnails of the published images, from their originals (c2corg/c2c_images#1160).
//
//   node scripts/backfill-avif.js [--dry-run] [--start-after=<key>] [--limit=<images>] [--concurrency=<n>]
//     [--pause-ms=<ms>] [--reencode-jpeg] [--sanitize-svg] [--svg-only] [--sizes=<csv file>] [--keys=<file>]
//     [--restore-from-thumbnail]
//
// --keys: a file with one original key per line (blank lines and # comments ignored). Only these images, all their
// thumbnails rendered again (base format and AVIF), to repair some of them; --start-after and --svg-only do not apply.
//
// --restore-from-thumbnail (with --keys): a listed original missing or empty (0 bytes) is rebuilt from its biggest base
// thumbnail and stored; only its AVIF thumbnails are rendered. The truncated originals are rendered as browsers show
// them (#1218).
//
// Resumable: each progress line gives the last image done; start again with --start-after=<it>. SIGINT and SIGTERM
// stop it after the current batch. AVIF_EFFORT and AVIF_QUALITY apply as for the uploads.

import fs from 'node:fs';
import { parseArgs } from 'node:util';

import { backfillAvif } from '../image/backfill.js';
import { log } from '../log.js';
import { activeStorage, tempStorage } from '../storage/storage.js';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'start-after': { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '1' },
    'pause-ms': { type: 'string', default: '0' },
    'reencode-jpeg': { type: 'boolean', default: false },
    'sanitize-svg': { type: 'boolean', default: false },
    'svg-only': { type: 'boolean', default: false },
    sizes: { type: 'string' },
    keys: { type: 'string' },
    'restore-from-thumbnail': { type: 'boolean', default: false }
  }
});

const positive = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return number;
};

const ORIGINAL = /^\d+_\d+\.(jpg|png|gif|svg)$/;
const readKeys = (file: string): string[] => {
  const keys = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean);
  const invalid = keys.filter(key => !ORIGINAL.test(key));
  if (invalid.length) {
    throw new Error(`--keys: not original keys: ${invalid.slice(0, 5).join(', ')}`);
  }
  return keys;
};
const keys = values.keys === undefined ? undefined : readKeys(values.keys);
if (values['restore-from-thumbnail'] && !keys) {
  throw new Error('--restore-from-thumbnail: only with --keys');
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info(`Backfill: ${signal}, stopping after the current batch`);
    controller.abort();
  });
}

const result = await backfillAvif(
  activeStorage,
  tempStorage,
  {
    dryRun: values['dry-run'],
    startAfter: values['start-after'],
    limit: positive('limit', values.limit),
    concurrency: Math.max(1, positive('concurrency', values.concurrency) ?? 1),
    pauseMs: positive('pause-ms', values['pause-ms']) ?? 0,
    reencodeJpeg: values['reencode-jpeg'],
    sanitizeSvg: values['sanitize-svg'],
    svgOnly: values['svg-only'],
    sizes: values.sizes,
    keys,
    restoreFromThumbnail: values['restore-from-thumbnail'],
    signal: controller.signal
  },
  log
);

// the summary goes to stdout, whatever DEBUG says
console.log(JSON.stringify(result));
if (result.stopped && result.lastKey) {
  console.log(`Resume with --start-after=${result.lastKey}`);
}
