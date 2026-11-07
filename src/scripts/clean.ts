// Deletes once the files of the incoming bucket older than INCOMING_MAX_AGE_HOURS: uploaded, never published.
// The service does it by itself (INCOMING_CLEANUP); this script is for a manual run. --dry-run: only counts them.

import { INCOMING_MAX_AGE_HOURS, STORAGE } from '../config.js';
import { log } from '../log.js';
import { cleanIncoming } from '../storage/clean-incoming.js';
import { incomingClient } from '../storage/storage.js';

if (STORAGE.STORAGE_BACKEND !== 's3') {
  throw new Error('STORAGE_BACKEND is not s3');
}

const dryRun = process.argv.includes('--dry-run');
const total = await cleanIncoming(incomingClient(), STORAGE.INCOMING_BUCKET, INCOMING_MAX_AGE_HOURS * 60 * 60 * 1000, {
  dryRun
});
log.info(`${total} files ${dryRun ? 'would be deleted (dry run)' : 'have been deleted'}.`);
