import sharp, { type Sharp, type SharpOptions } from 'sharp';

import { AVIF_EFFORT, AVIF_QUALITY, JPEG_QUALITY, WEBP_QUALITY } from '../config.js';

export const SVG_DENSITY = 96;

// the files are read once each: no need for the cache of libvips
sharp.cache(false);

// The limit of libvips (16383^2). The uploads are limited to MAX_IMAGE_PIXELS before (getFileFormat): the originals
// stored before that limit are still rotated and rendered.
const MAX_INPUT_PIXELS = 16383 * 16383;

// The input of every image operation, limited to MAX_INPUT_PIXELS against the decompression bombs.
// SVG are rendered at SVG_DENSITY dpi, as rsvg-convert did; animated GIF keep all their frames when asked.
export const openImage = (file: string | Buffer, options: { svg?: boolean; animated?: boolean } = {}): Sharp => {
  const sharpOptions: SharpOptions = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS };
  if (options.svg) {
    sharpOptions.density = SVG_DENSITY;
  }
  if (options.animated) {
    sharpOptions.animated = true;
  }
  return sharp(file, sharpOptions);
};

// the originals re-encoded (rotation, auto-orientation) keep a high quality
export const ORIGINAL_JPEG_QUALITY = 90;

/**
 * The encoder of a file, by its extension. JPEG through mozjpeg (smaller at the same quality, progressive); PNG and GIF
 * lossless, PNG with the strongest compression.
 */
export const encode = (
  image: Sharp,
  ext: string,
  { jpeg = JPEG_QUALITY, avif = AVIF_QUALITY }: { jpeg?: number; avif?: number } = {}
): Sharp => {
  switch (ext) {
    case '.jpg':
      return image.jpeg({ quality: jpeg, mozjpeg: true });
    case '.png':
      return image.png({ compressionLevel: 9 });
    case '.gif':
      return image.gif();
    case '.webp':
      return image.webp({ quality: WEBP_QUALITY });
    case '.avif':
      return image.avif({ quality: avif, effort: AVIF_EFFORT });
    default:
      throw new Error(`Unsupported output image format ${ext}.`);
  }
};

export { sharp };
