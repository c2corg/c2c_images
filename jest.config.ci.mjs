import baseConfig from './jest.config.mjs';

export default {
  ...baseConfig,
  coverageDirectory: 'reports/coverage/unit',
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-test-results.xml' }]],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
