import { describe, expect, test } from 'vitest';

import { generateUniqueKeyPrefix } from '../../../src/http/utils.js';
import { keyRegex } from '../../../src/http/validation.js';

describe('Key validation', () => {
  test('regex', () => {
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.jpg`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}.tiff`)).toBe(false);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}BI.png`)).toBe(true);
    expect(keyRegex.test(`${generateUniqueKeyPrefix()}XX.jpg`)).toBe(false);
    expect(keyRegex.test(`foo_1234.jpg`)).toBe(false);
  });

  // v6_images keys: seconds since epoch and a random number up to 2^31 - 1, not zero padded
  test.each(['1588000000_123456.jpg', '1450000000_0.png', '1500000000_2147483647MI.gif', '1234567890_42SI.jpg'])(
    'accepts the v6_images key %s',
    key => {
      expect(keyRegex.test(key)).toBe(true);
    }
  );

  test.each(['_123.jpg', '123_.jpg', '1588000000_123456.JPG', '1588000000_123456.jpg/../x', '../1588000000_1.jpg'])(
    'rejects %s',
    key => {
      expect(keyRegex.test(key)).toBe(false);
    }
  );
});
