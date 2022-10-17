import baseConfig from './jest.config.options.mjs';

export default {
  ...baseConfig,
  coverageDirectory: 'reports/coverage/options',
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-options-results.xml' }]],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
