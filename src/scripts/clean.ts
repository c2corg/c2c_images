// Exoscale is compatible with S3 but does not support object lifecycle management
// so that files aren't deleted after the expiring date.
// Use this script to clean the incoming folder in case
// you face such issue.

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { S3_EXPIRE_HOURS, STORAGE } from '../config.js';
import { log } from '../log.js';
import { getS3Params } from '../storage/storage.js';

if (STORAGE.STORAGE_BACKEND !== 's3') {
  throw new Error('STORAGE_BACKEND is not s3');
}
const { INCOMING_BUCKET } = STORAGE;

const params = getS3Params(STORAGE.INCOMING_PREFIX);
const client = new S3Client({
  ...params,
  forcePathStyle: true
});

let total = 0;
let obsoleteKeys: string[];
let end: string | undefined = undefined;

do {
  ({ obsoleteKeys, end } = await getObsoleteFiles(INCOMING_BUCKET, end));
  await deleteFiles(INCOMING_BUCKET, obsoleteKeys);
  total += obsoleteKeys.length;
} while (obsoleteKeys.length !== 0);
log.info(`${total} files have been deleted.`);

// returns up to 1000 keys
async function getObsoleteFiles(
  bucket: string,
  startAfter?: string
): Promise<{ obsoleteKeys: string[]; end?: string | undefined }> {
  const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: bucket, StartAfter: startAfter }));

  const end = Contents?.at(-1)?.Key;
  const keys =
    Contents?.filter(
      ({ Key, LastModified }) =>
        Key && LastModified && LastModified.getTime() + S3_EXPIRE_HOURS * 1000 * 60 * 60 < Date.now()
    ).map(({ Key }) => Key!) ?? [];

  return { obsoleteKeys: keys, end };
}

async function deleteFiles(bucket: string, keys: string[]): Promise<void> {
  await client.send(
    new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: keys.map(key => ({ Key: key })) } })
  );
}
