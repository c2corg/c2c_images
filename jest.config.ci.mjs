// include all tests and compute coverage
import allConfig from './jest.config.all.mjs';

export default {
  ...allConfig,
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-results.xml' }]],
  coverageDirectory: 'reports/coverage',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
