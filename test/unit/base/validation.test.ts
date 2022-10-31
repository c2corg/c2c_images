import { generateUniqueKeyPrefix } from '../../../src/koa/utils.js';
import { keyRegex } from '../../../src/koa/validation.js';

describe('Key validation', () => {
  test('regex', () => {
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.jpg`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.tiff`)).toBe(false);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}BI.png`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}XX.jpg`)).toBe(false);
    expect(keyRegex.test(`foo_1234.jpg`)).toBe(false);
  });
});
