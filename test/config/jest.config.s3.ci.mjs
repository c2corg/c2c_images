import baseConfig from './jest.config.s3.mjs';

export default {
  ...baseConfig,
  coverageDirectory: '../../reports/coverage/s3',
  reporters: ['default', ['jest-junit', { outputName: 'reports/junit/js-s3-results.xml' }]],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts']
};
