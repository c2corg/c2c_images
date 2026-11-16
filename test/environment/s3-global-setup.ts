import { setTimeout as sleep } from 'node:timers/promises';

import { BucketAlreadyOwnedByYou, CreateBucketCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';

// the buckets and credentials of env-vars.s3.js
const BUCKETS = ['incoming', 'active'];
// a bucket that keeps the versions of the deleted keys, as c2corg-active in production
export const VERSIONED_BUCKET = 'versioned';

const createBucket = async (client: S3Client, bucket: string): Promise<void> => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) {
      throw error;
    }
  }
};

// Runs once before the s3 tests: creates the buckets, once the server answers (it takes a few seconds to start)
export default async function setup(): Promise<void> {
  const client = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: { accessKeyId: 'images-access-key', secretAccessKey: 'images-secret-key' },
    forcePathStyle: true
  });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await Promise.all([...BUCKETS, VERSIONED_BUCKET].map(async bucket => createBucket(client, bucket)));
        await client.send(
          new PutBucketVersioningCommand({ Bucket: VERSIONED_BUCKET, VersioningConfiguration: { Status: 'Enabled' } })
        );
        return;
      } catch (error) {
        if (attempt >= 30) {
          throw error;
        }
        await sleep(1000);
      }
    }
  } finally {
    client.destroy();
  }
}
