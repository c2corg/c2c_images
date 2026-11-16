import fs from 'node:fs';

import { ObjectCannedACL } from '@aws-sdk/client-s3';
import request from 'supertest';
import { beforeAll, describe, expect, test } from 'vitest';

import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { getS3Params, S3Storage } from '../../../src/storage/storage.js';
import { VERSIONED_BUCKET } from '../../environment/s3-global-setup.js';

describe('S3 storage restore', () => {
  let versioned: S3Storage;
  let unversioned: S3Storage;
  beforeAll(() => {
    versioned = new S3Storage(VERSIONED_BUCKET, getS3Params('S3'), ObjectCannedACL.public_read);
    unversioned = new S3Storage(process.env['ACTIVE_BUCKET']!, getS3Params('S3'), ObjectCannedACL.public_read);
  });

  test('restores the last version of a deleted key, public with its headers', async () => {
    const key = `${generateUniqueKeyPrefix()}.png`;
    await versioned.put(key, 'test/data/violin.jpg');
    // a newer version: the restored one
    await versioned.put(key, 'test/data/piano.png');
    await versioned.delete(key);
    expect(await versioned.exists(key)).toBe(false);

    expect(await versioned.restore(key)).toBe(true);

    expect(await versioned.exists(key)).toBe(true);
    expect(await versioned.get(key)).toEqual(fs.readFileSync('test/data/piano.png'));
    await request(versioned.baseUrl)
      .get(`/${key}`)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect('Cache-Control', 'public, max-age=3600');
  });

  test('restores a key deleted twice', async () => {
    const key = `${generateUniqueKeyPrefix()}.jpg`;
    await versioned.put(key, 'test/data/violin.jpg');
    await versioned.delete(key);
    await versioned.delete(key);

    expect(await versioned.restore(key)).toBe(true);
    expect(await versioned.get(key)).toEqual(fs.readFileSync('test/data/violin.jpg'));
  });

  test('only restores the exact key, not the longer keys of the same prefix', async () => {
    const prefix = generateUniqueKeyPrefix();
    await versioned.put(`${prefix}.jpgBI.jpg`, 'test/data/violin.jpg');
    await versioned.delete(`${prefix}.jpgBI.jpg`);

    expect(await versioned.restore(`${prefix}.jpg`)).toBe(false);
    expect(await versioned.exists(`${prefix}.jpg`)).toBe(false);
  });

  test('a key still there is left as it is', async () => {
    const key = `${generateUniqueKeyPrefix()}.jpg`;
    await versioned.put(key, 'test/data/violin.jpg');
    expect(await versioned.restore(key)).toBe(true);
    expect(await versioned.get(key)).toEqual(fs.readFileSync('test/data/violin.jpg'));
  });

  test('a key never stored is not restored', async () => {
    expect(await versioned.restore(`${generateUniqueKeyPrefix()}.jpg`)).toBe(false);
  });

  test('a bucket without versioning restores nothing', async () => {
    const key = `${generateUniqueKeyPrefix()}.jpg`;
    await unversioned.put(key, 'test/data/violin.jpg');
    await unversioned.delete(key);
    expect(await unversioned.restore(key)).toBe(false);
  });
});
