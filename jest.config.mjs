export default {
  roots: ['<rootDir>/test/unit'],
  testEnvironment: 'node',
  preset: 'ts-jest/presets/default-esm',
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  setupFiles: ['<rootDir>/test/environment/env-vars.js']
};
