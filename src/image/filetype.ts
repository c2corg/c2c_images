import path from 'node:path';
import { PREFER_IDENTIFY_OVER_FILE } from '../config.js';
import { fileCmdExists, getMimeType } from '../exec/file.js';
import { identify, isSvgReadSupported } from '../exec/imagemagick.js';

const getFormatFromIdentify = (filename: string): string => {
  const { format } = identify(filename);

  switch (format) {
    case 'JPEG':
      return 'jpg';
    case 'PNG':
      // Depending on the system and the build configuration of imagemagick, it can
      // send PNG for SVG files.
      if (!isSvgReadSupported && filename.endsWith('.svg')) {
        return 'svg';
      }
      return 'png';
    case 'GIF':
    case 'SVG':
      return format.toLowerCase();
    default:
      throw new Error(`Unsupported image format.`);
  }
};

const getFormatFromFile = (filename: string): string => {
  const mime = getMimeType(filename);
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    default:
      throw new Error(`Unsupported image format.`);
  }
};

// file command is more reliable than image magick if installed
export const getFileFormat = fileCmdExists && !PREFER_IDENTIFY_OVER_FILE ? getFormatFromFile : getFormatFromIdentify;

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
