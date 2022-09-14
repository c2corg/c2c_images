import { generateUniqueKeyPrefix, keyRegex } from '../../src/utils.js';

describe('Key validation', () => {
  test('regex', () => {
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.jpg`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.tiff`)).toBe(false);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}BI.png`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}XX.jpg`)).toBe(false);
    expect(keyRegex.test(`foo_1234.jpg`)).toBe(false);
  });
});
