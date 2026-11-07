import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'reports/coverage',
      // of the whole suite (npm run test:ci, with the S3 server), a little under the current values
      thresholds: { statements: 84, branches: 77, functions: 85, lines: 84 }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'base',
          include: ['test/unit/base/**/*.test.ts'],
          setupFiles: ['test/environment/env-vars.js']
        }
      },
      {
        // test some options different than from base
        extends: true,
        test: {
          name: 'options',
          include: ['test/unit/options/**/*.test.ts'],
          setupFiles: ['test/environment/env-vars.options.js']
        }
      },
      {
        // requires the S3 server of docker-compose.s3.yml
        extends: true,
        test: {
          name: 's3',
          include: ['test/unit/s3/**/*.test.ts'],
          setupFiles: ['test/environment/env-vars.s3.js'],
          globalSetup: ['test/environment/s3-global-setup.ts']
        }
      }
    ]
  }
});
