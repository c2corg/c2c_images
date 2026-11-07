import sharp, { type Sharp, type SharpOptions } from 'sharp';

import { MAX_IMAGE_PIXELS } from '../config.js';

export const SVG_DENSITY = 96;

// the files are read once each: no need for the cache of libvips
sharp.cache(false);

// The input of every image operation, limited to MAX_IMAGE_PIXELS against the decompression bombs.
// SVG are rendered at SVG_DENSITY dpi, as rsvg-convert did; animated GIF keep all their frames when asked.
export const openImage = (file: string, options: { svg?: boolean; animated?: boolean } = {}): Sharp => {
  const sharpOptions: SharpOptions = { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS };
  if (options.svg) {
    sharpOptions.density = SVG_DENSITY;
  }
  if (options.animated) {
    sharpOptions.animated = true;
  }
  return sharp(file, sharpOptions);
};

// the encoder of a file, by its extension
export const encode = (image: Sharp, ext: string, quality: number): Sharp => {
  switch (ext) {
    case '.jpg':
      return image.jpeg({ quality });
    case '.png':
      return image.png();
    case '.gif':
      return image.gif();
    case '.webp':
      return image.webp({ quality });
    case '.avif':
      return image.avif({ quality });
    default:
      throw new Error(`Unsupported output image format ${ext}.`);
  }
};

export { sharp };
