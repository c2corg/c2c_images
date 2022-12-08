import baseConfig from './jest.config.common.mjs';

// test without using file, even if it exists
export default {
  ...baseConfig,
  displayName: 'No file',
  roots: ['<rootDir>/test/unit/base'],
  testMatch: ['**/upload.test.ts'],
  setupFiles: ['<rootDir>/test/environment/env-vars.nofile.js']
};
