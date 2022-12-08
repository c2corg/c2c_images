import baseConfig from './jest.config.common.mjs';

export default {
  ...baseConfig,
  displayName: 'Base',
  roots: ['<rootDir>/test/unit/base'],
  setupFiles: ['<rootDir>/test/environment/env-vars.js']
};
