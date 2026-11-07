import sharp, { type Sharp, type SharpOptions } from 'sharp';

// the files are read once each: no need for the cache of libvips
sharp.cache(false);

// The input of every image operation. libvips' default limit of pixels (268 megapixels) refuses the decompression bombs.
// SVG are rendered at 96 dpi, as rsvg-convert did; animated GIF keep all their frames when asked.
export const openImage = (file: string, options: { svg?: boolean; animated?: boolean } = {}): Sharp => {
  const sharpOptions: SharpOptions = { failOn: 'error' };
  if (options.svg) {
    sharpOptions.density = 96;
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
