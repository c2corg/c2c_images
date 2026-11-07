import { afterEach, describe, expect, test } from 'vitest';

import { getS3Params } from '../../../src/storage/storage.js';

const variables = {
  TEST_ENDPOINT: 'https://sos-ch-dk-2.exo.io',
  TEST_ACCESS_KEY_ID: 'key',
  TEST_SECRET_KEY: 'secret',
  TEST_DEFAULT_REGION: 'ch-dk-2'
};

describe('getS3Params', () => {
  afterEach(() => {
    for (const name of Object.keys(variables)) {
      Reflect.deleteProperty(process.env, name);
    }
  });

  test('reads the variables of a prefix', () => {
    Object.assign(process.env, variables);
    expect(getS3Params('TEST')).toEqual({
      endpoint: 'https://sos-ch-dk-2.exo.io',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      region: 'ch-dk-2'
    });
  });

  // the AWS SDK sends no request without a region: refused at startup rather than at the first upload
  test.each(Object.keys(variables))('requires %s', name => {
    Object.assign(process.env, variables);
    Reflect.deleteProperty(process.env, name);
    expect(() => getS3Params('TEST')).toThrow(name);
  });
});
