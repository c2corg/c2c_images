import fs from 'node:fs';

import { ObjectCannedACL } from '@aws-sdk/client-s3';
import request from 'supertest';
import { beforeAll, describe, expect, test } from 'vitest';

import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { getS3Params, S3Storage, tempStorage } from '../../../src/storage/storage.js';

const key = `${generateUniqueKeyPrefix()}.png`;
const newKey = `${generateUniqueKeyPrefix()}.png`;
const file = 'test/data/piano.png';

describe('S3 storage', () => {
  let incomingStorage: S3Storage;
  let activeStorage: S3Storage;
  beforeAll(() => {
    incomingStorage = new S3Storage(process.env['INCOMING_BUCKET']!, getS3Params('S3'), ObjectCannedACL.private, true);

    activeStorage = new S3Storage(process.env['ACTIVE_BUCKET']!, getS3Params('S3'), ObjectCannedACL.public_read);
  });

  test('Standard protocol', async () => {
    // put file in temp storage for processing
    await tempStorage.put(key, file);

    // move it in incoming storage waiting for publication
    await tempStorage.move(key, incomingStorage);
    expect(await incomingStorage.exists(key)).toBe(true);
    expect(await tempStorage.exists(key)).toBe(false);

    // ensure that the file is not public
    await request(incomingStorage.baseUrl).get(`/${key}`).expect(403);

    // on publishing it is moved to active storage
    await incomingStorage.move(key, activeStorage);
    expect(await activeStorage.exists(key)).toBe(true);
    expect(await incomingStorage.exists(key)).toBe(false);

    // ensure that the file is public
    await request(activeStorage.baseUrl)
      .get(`/${key}`)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect('Cache-Control', 'public, max-age=3600');

    // cleaning
    await activeStorage.delete(key);
    expect(await activeStorage.exists(key)).toBe(false);

    // delete a file that does not exist won't throw in s3
    expect(await activeStorage.delete('does_not_exist.jpg')).toBeUndefined();
  });

  test('Rotating protocol', async () => {
    // for rotating object is in active storage
    await activeStorage.put(key, file);

    // get object in temp storage
    await activeStorage.copy(key, tempStorage);
    expect(await tempStorage.exists(key)).toBe(true);

    // simulate rotation..
    fs.renameSync(tempStorage.path(key), tempStorage.path(newKey));

    // upload rotated file to active storage and delete original
    await tempStorage.move(newKey, activeStorage);
    await activeStorage.delete(key);
    expect(await activeStorage.exists(key)).toBe(false);
    expect(await activeStorage.exists(newKey)).toBe(true);
    expect(await tempStorage.exists(newKey)).toBe(false);

    // cleaning
    await activeStorage.delete(newKey);
    expect(await activeStorage.exists(newKey)).toBe(false);
  });
});

describe('incoming lifecycle, against the S3 server', () => {
  test('the expiration rule is created when the bucket has none, then found', async () => {
    const { DeleteBucketLifecycleCommand, S3Client } = await import('@aws-sdk/client-s3');
    const { createIncomingRule, getIncomingLifecycle } = await import('../../../src/storage/incoming-lifecycle.js');
    const client = new S3Client({ ...getS3Params('S3'), forcePathStyle: true });
    const bucket = process.env['INCOMING_BUCKET']!;
    await client.send(new DeleteBucketLifecycleCommand({ Bucket: bucket }));

    expect(await getIncomingLifecycle(client, bucket)).toEqual({ state: 'none' });
    await createIncomingRule(client, bucket, 1);
    expect(await getIncomingLifecycle(client, bucket)).toEqual({ state: 'rule', days: 1 });
    await client.send(new DeleteBucketLifecycleCommand({ Bucket: bucket }));
  });
});

describe('S3 metrics', () => {
  test('the requests are timed by operation and outcome', async () => {
    const { s3RequestDuration } = await import('../../../src/metrics/prometheus.js');
    const { metricValue } = await import('../../helpers/metrics.js');
    const storage = new S3Storage(process.env['INCOMING_BUCKET']!, getS3Params('S3'), ObjectCannedACL.private);
    const before = await metricValue(s3RequestDuration, { operation: 'head', outcome: 'not_found' });
    expect(await storage.exists(`${generateUniqueKeyPrefix()}.jpg`)).toBe(false);
    expect(await metricValue(s3RequestDuration, { operation: 'head', outcome: 'not_found' })).toBe(before + 1);
  });
});
