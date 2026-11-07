// Deletes the files of the incoming bucket older than S3_EXPIRE_HOURS: uploaded, never published.
// To be replaced by a lifecycle rule of the bucket, once available (see #1160).

import { S3Client } from '@aws-sdk/client-s3';

import { S3_EXPIRE_HOURS, STORAGE } from '../config.js';
import { log } from '../log.js';
import { cleanIncoming } from '../storage/clean-incoming.js';
import { getS3Params } from '../storage/storage.js';

if (STORAGE.STORAGE_BACKEND !== 's3') {
  throw new Error('STORAGE_BACKEND is not s3');
}

const client = new S3Client({ ...getS3Params(STORAGE.INCOMING_PREFIX), forcePathStyle: true });
const total = await cleanIncoming(client, STORAGE.INCOMING_BUCKET, S3_EXPIRE_HOURS * 60 * 60 * 1000);
log.info(`${total} files have been deleted.`);
