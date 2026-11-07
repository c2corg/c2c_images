import { describe, expect, test } from 'vitest';

import { parseEnv } from '../../../src/config.js';

const local = { STORAGE_BACKEND: 'local', INCOMING_FOLDER: '/in', ACTIVE_FOLDER: '/act', API_SECRET_KEY: 'secret' };

describe('configuration', () => {
  test('defaults', () => {
    const config = parseEnv(local);
    expect(config).toMatchObject({
      SERVICE_PORT: 8080,
      METRICS_PORT: 8081,
      METRICS_PATH: '/metrics',
      DISABLE_PROMETHEUS_METRICS: false,
      MAX_UPLOAD_SIZE: 30 * 1024 * 1024,
      MAX_IMAGE_PIXELS: 16383 * 16383,
      UPLOAD_RATE_LIMIT: 100,
      AUTH_FAILURE_RATE_LIMIT: 10,
      TRUST_PROXY: 'loopback, uniquelocal',
      CACHE_CONTROL: 'public, max-age=3600',
      GENERATE_WEBP: false,
      ALLOWED_ORIGINS: ['*'],
      THUMBNAILS_PUBLISH_DELAY: 20000,
      STORAGE: { STORAGE_BACKEND: 'local', INCOMING_FOLDER: '/in', ACTIVE_FOLDER: '/act' }
    });
    expect(config.RESIZING_CONFIG.map(({ suffix }) => suffix)).toEqual(['BI', 'MI', 'SI']);
  });

  test('an empty variable is an unset one', () => {
    expect(parseEnv({ ...local, SERVICE_PORT: '', GENERATE_WEBP: '' })).toMatchObject({
      SERVICE_PORT: 8080,
      GENERATE_WEBP: false
    });
  });

  test('values', () => {
    const config = parseEnv({
      ...local,
      SERVICE_PORT: '9000',
      GENERATE_WEBP: 'yes',
      AUTO_ORIENT_ORIGINAL: '1',
      ALLOWED_ORIGINS: 'https://www.camptocamp.org, https://www.demov6.camptocamp.org',
      TRUST_PROXY: '1',
      THUMBNAILS_PUBLISH_DELAY: '0',
      RESIZING_CONFIG: '[{"suffix":"XS","width":50,"height":40,"fit":"cover"}]'
    });
    expect(config).toMatchObject({
      SERVICE_PORT: 9000,
      GENERATE_WEBP: true,
      AUTO_ORIENT_ORIGINAL: true,
      ALLOWED_ORIGINS: ['https://www.camptocamp.org', 'https://www.demov6.camptocamp.org'],
      TRUST_PROXY: 1,
      THUMBNAILS_PUBLISH_DELAY: 0,
      RESIZING_CONFIG: [{ suffix: 'XS', width: 50, height: 40, fit: 'cover', quality: 90 }]
    });
  });

  test('s3 storage', () => {
    const s3 = {
      STORAGE_BACKEND: 's3',
      INCOMING_BUCKET: 'incoming',
      INCOMING_PREFIX: 'EXO',
      ACTIVE_BUCKET: 'active',
      ACTIVE_PREFIX: 'EXO',
      API_SECRET_KEY: 'secret'
    };
    expect(parseEnv(s3).STORAGE).toEqual({ ...s3, API_SECRET_KEY: undefined });
  });

  test.each([
    [{ ...local, API_SECRET_KEY: undefined }, 'API_SECRET_KEY'],
    [{ ...local, STORAGE_BACKEND: 'ftp' }, 'STORAGE_BACKEND'],
    [{ ...local, ACTIVE_FOLDER: undefined }, 'ACTIVE_FOLDER'],
    [{ ...local, STORAGE_BACKEND: 's3' }, 'INCOMING_BUCKET'],
    [{ ...local, SERVICE_PORT: '80a' }, 'SERVICE_PORT'],
    [{ ...local, GENERATE_AVIF: 'maybe' }, 'GENERATE_AVIF'],
    [{ ...local, MAX_UPLOAD_SIZE: '-1' }, 'MAX_UPLOAD_SIZE'],
    [{ ...local, METRICS_PATH: 'metrics' }, 'METRICS_PATH'],
    [{ ...local, RESIZING_CONFIG: '[{' }, 'Invalid JSON'],
    [{ ...local, RESIZING_CONFIG: '[]' }, 'RESIZING_CONFIG'],
    [{ ...local, RESIZING_CONFIG: '[{"suffix":"XS","width":50,"height":40,"fit":"fill"}]' }, 'RESIZING_CONFIG']
  ])('refuses invalid values (%#: %s)', (env, message) => {
    expect(() => parseEnv(env)).toThrow(message);
  });
});
