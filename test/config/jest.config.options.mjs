import baseConfig from './jest.config.common.mjs';

// Test some options different than from base
export default {
  ...baseConfig,
  displayName: 'Some options',
  roots: ['<rootDir>/test/unit/options'],
  setupFiles: ['<rootDir>/test/environment/env-vars.options.js']
};
