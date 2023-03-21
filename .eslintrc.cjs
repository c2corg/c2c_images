/* eslint-disable no-undef */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier'
  ],
  ignorePatterns: ['*.cjs', '*.mjs', 'test/environment'],
  rules: {
    '@typescript-eslint/no-import-type-side-effects': 'error'
  }
};
