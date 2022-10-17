export default {
  roots: ['<rootDir>/../unit/options'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // workaround for OOM issue, but lowers type checking
        // see https://github.com/kulshekhar/ts-jest/issues/2015
        isolatedModules: true
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  setupFiles: ['<rootDir>/../environment/env-vars.options.js']
};
