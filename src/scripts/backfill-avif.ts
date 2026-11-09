// Renders the missing AVIF thumbnails of the published images, from their originals (c2corg/c2c_images#1160).
//
//   node scripts/backfill-avif.js [--dry-run] [--start-after=<key>] [--limit=<images>] [--concurrency=<n>]
//     [--pause-ms=<ms>] [--reencode-jpeg] [--sanitize-svg]
//
// Resumable: each progress line gives the last image done; start again with --start-after=<it>. SIGINT and SIGTERM
// stop it after the current batch. AVIF_EFFORT and AVIF_QUALITY apply as for the uploads.

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
    'sanitize-svg': { type: 'boolean', default: false }
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
    signal: controller.signal
  },
  log
);

// the summary goes to stdout, whatever DEBUG says
console.log(JSON.stringify(result));
if (result.stopped && result.lastKey) {
  console.log(`Resume with --start-after=${result.lastKey}`);
}
