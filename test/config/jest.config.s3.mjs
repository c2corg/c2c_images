import baseConfig from './jest.config.common.mjs';

// requires docker compose to run minio
export default {
  ...baseConfig,
  displayName: 'S3',
  roots: ['<rootDir>/test/unit/s3'],
  setupFiles: ['<rootDir>/test/environment/env-vars.s3.js']
};
