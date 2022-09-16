// Exoscale is compatible with S3 but does not support object lifecycle management
// so that files aren't deleted after the expiring date.
// Use this script to clean the incoming folder in case
// you face such issue.

import aws from 'aws-sdk';
import { S3_EXPIRE_HOURS, STORAGE_BACKEND } from '../config.js';
import { log } from '../log.js';
import { getS3Params } from '../storage.js';

const INCOMING_BUCKET = process.env['INCOMING_BUCKET'];
if (STORAGE_BACKEND !== 's3' || !INCOMING_BUCKET) {
  throw new Error('Backend is not configured with s3, or INCOMING_BUCKET is not defined');
}

const params = getS3Params('INCOMING');
const client = new aws.S3({
  ...params,
  sslEnabled: true,
  signatureVersion: 'v4',
  s3ForcePathStyle: true
});

let total = 0;
let obsoleteKeys: string[] = [];
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
): Promise<{ obsoleteKeys: string[]; end?: string }> {
  let end: string | undefined;
  const keys = await client
    .listObjectsV2({ Bucket: bucket, StartAfter: startAfter })
    .promise()
    .then(({ Contents }) => {
      end = Contents?.at(-1)?.Key;
      return (
        Contents?.filter(
          ({ Key, LastModified }) =>
            Key && LastModified && LastModified.getTime() + S3_EXPIRE_HOURS * 1000 * 60 * 60 < Date.now()
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ).map(({ Key }) => Key!) ?? []
      );
    });
  return { obsoleteKeys: keys, end };
}

async function deleteFiles(bucket: string, keys: string[]): Promise<void> {
  await client
    .deleteObjects({ Bucket: bucket, Delete: { Quiet: true, Objects: keys.map(key => ({ Key: key })) } })
    .promise();
}
