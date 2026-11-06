import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'reports/coverage'
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
        // test without using file, even if it exists
        extends: true,
        test: {
          name: 'nofile',
          include: ['test/unit/base/**/upload.test.ts'],
          setupFiles: ['test/environment/env-vars.nofile.js']
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
        // requires an S3 server, see docker-compose-minio.yml
        extends: true,
        test: {
          name: 's3',
          include: ['test/unit/s3/**/*.test.ts'],
          setupFiles: ['test/environment/env-vars.s3.js']
        }
      }
    ]
  }
});
