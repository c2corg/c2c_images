import { fileCmdExists } from '../../../src/exec/file';
import {
  imageMagickVersion,
  isAvifWriteSupported,
  isSvgReadSupported,
  isWebpWriteSupported
} from '../../../src/exec/imagemagick';
import { rsvgConvertVersion } from '../../../src/exec/librsvg';

describe('Image tools', () => {
  test('check that librsvg is installed', () => {
    expect(typeof rsvgConvertVersion()).toBe('string');
  });

  test('check that imagemagick is installed', () => {
    expect(typeof imageMagickVersion()).toBe('string');
  });

  test('check that file command is installed', () => {
    expect(typeof fileCmdExists).toBe('boolean');
  });

  test('can check if AVIF write is supported', () => {
    expect(typeof isAvifWriteSupported).toBe('boolean');
  });

  test('can check if WEBP write is supported', () => {
    expect(typeof isWebpWriteSupported).toBe('boolean');
  });

  test('can check if SVG read is supported', () => {
    expect(typeof isSvgReadSupported).toBe('boolean');
  });
});
