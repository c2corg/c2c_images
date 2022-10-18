import {
  imageMagickVersion,
  isAvifSupported,
  isWebpSupported,
  rsvgConvertVersion
} from '../../../src/image/convert.js';

describe('Image tools', () => {
  test('check that librsvg is installed', () => {
    expect(typeof rsvgConvertVersion()).toBe('string');
  });

  test('check that imagemagick is installed', () => {
    expect(typeof imageMagickVersion()).toBe('string');
  });

  test('can check if AVIF is supported', () => {
    expect(typeof isAvifSupported).toBe('boolean');
  });

  test('can check if WEBP is supported', () => {
    expect(typeof isWebpSupported).toBe('boolean');
  });
});
