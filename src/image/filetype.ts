import path from 'node:path';
import { identify } from './convert.js';

export const getFileFormat = (filename: string): string => {
  const format = identify(filename);

  switch (format) {
    case 'JPEG':
      return 'jpg';
    case 'PNG':
    case 'GIF':
    case 'SVG':
      return format.toLowerCase();
    default:
      throw new Error(`Unsupported image format ${format}.`);
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
    default:
      throw new Error(`Unsupported image format ${key}.`);
  }
};
