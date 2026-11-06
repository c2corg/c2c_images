import { BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { setTimeout as sleep } from 'node:timers/promises';

// the buckets and credentials of env-vars.s3.js
const BUCKETS = ['incoming', 'active'];

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
        await Promise.all(BUCKETS.map(async bucket => createBucket(client, bucket)));
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
