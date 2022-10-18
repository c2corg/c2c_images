import baseConfig from './jest.config.base.mjs';

export default {
  ...baseConfig,
  coverageDirectory: 'reports/coverage/base',
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-base-results.xml' }]],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
