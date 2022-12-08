export default {
  rootDir: '../../',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // workaround for OOM issue, but lowers type checking
        // see https://github.com/kulshekhar/ts-jest/issues/2015
        isolatedModules: true,
        tsconfig: '<rootDir>/test/tsconfig.json'
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};
