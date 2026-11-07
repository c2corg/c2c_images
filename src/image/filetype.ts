import path from 'node:path';

import { MAX_IMAGE_PIXELS } from '../config.js';

import { openImage, SVG_DENSITY } from './sharp.js';

// The format of an uploaded image, from its content: the extension of its key. Refuses the images over MAX_IMAGE_PIXELS
// (all frames, SVG at the density they are rendered at), read from their headers, before decoding them.
export const getFileFormat = async (filename: string): Promise<string> => {
  let metadata: Awaited<ReturnType<ReturnType<typeof openImage>['metadata']>>;
  try {
    metadata = await openImage(filename).metadata();
  } catch (error) {
    // libvips checks its pixel limit in the header already
    throw new Error(
      error instanceof Error && error.message.includes('pixel limit')
        ? 'Image too large.'
        : 'Unsupported image format.',
      { cause: error }
    );
  }
  const { format, width = 0, height = 0, pages = 1 } = metadata;
  // metadata reads SVG at 72 dpi
  const scale = format === 'svg' ? (SVG_DENSITY / 72) ** 2 : 1;
  if (width * height * pages * scale > MAX_IMAGE_PIXELS) {
    throw new Error('Image too large.');
  }
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
    case 'gif':
    case 'svg':
      return format;
    default:
      throw new Error('Unsupported image format.');
  }
};

export const getMimeTypeFromKey = (key: string): string => {
  const { ext } = path.parse(key);
  switch (ext) {
    case '.jpg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error(`Unsupported output image format ${key}.`);
  }
};
