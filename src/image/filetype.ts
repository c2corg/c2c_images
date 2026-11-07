import path from 'node:path';

import { openImage } from './sharp.js';

// the format of an uploaded image, from its content: the extension of its key
export const getFileFormat = async (filename: string): Promise<string> => {
  let format: string | undefined;
  try {
    ({ format } = await openImage(filename).metadata());
  } catch {
    throw new Error('Unsupported image format.');
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
