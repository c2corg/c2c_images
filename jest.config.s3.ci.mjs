import baseConfig from './jest.config.s3.mjs';

export default {
  ...baseConfig,
  coverageDirectory: 'reports/coverage',
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-test-results.xml' }]],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
