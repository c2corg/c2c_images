import fs from 'node:fs';

import { promReducedOriginalsCounter } from '../metrics/prometheus.js';

import { storedSize } from './original.js';
import { encode, openImage, ORIGINAL_JPEG_QUALITY } from './sharp.js';

// The formats accepted at the upload but not stored as they are: converted to JPEG, or PNG when they have transparency.
// GIF are drawings and screenshots: always PNG, lossless. The animated images (and multi-page TIFF) are refused.
export const CONVERTED_FORMATS: ReadonlySet<string> = new Set(['webp', 'avif', 'tiff', 'gif']);

// An image sequence (animated AVIF): its file type box (ftyp) names the brand avis. libvips reads only its first image.
export const isImageSequence = async (file: string): Promise<boolean> => {
  const handle = await fs.promises.open(file);
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 16 || header.toString('latin1', 4, 8) !== 'ftyp') {
      return false;
    }
    // major brand, minor version, then the compatible brands, 4 bytes each
    const end = Math.min(header.readUInt32BE(0), bytesRead);
    for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
      if (header.toString('latin1', offset, offset + 4) === 'avis') {
        return true;
      }
    }
    return false;
  } finally {
    await handle.close();
  }
};

/**
 * Converts an uploaded WebP, AVIF, TIFF or GIF to the format it is stored in, reduced to the limits of the originals,
 * keeping its metadata (EXIF, colour profile; CMYK converted to sRGB). Gives the extension of the stored file.
 */
export const convertImage = async (file: string, format: string, output: string): Promise<'jpg' | 'png'> => {
  const { width = 0, height = 0, space } = await openImage(file).metadata();
  const ext = format === 'gif' || !(await openImage(file).stats()).isOpaque ? '.png' : '.jpg';

  // AVIF: libvips applies its rotation (irot); the others keep their EXIF orientation, as the uploaded JPEG
  let image = space === 'cmyk' ? openImage(file).keepExif().toColourspace('srgb') : openImage(file).keepMetadata();
  const size = storedSize({ width, height });
  if (size) {
    image = image.resize(size.width, size.height, { fit: 'fill' });
    promReducedOriginalsCounter.inc({ format: ext.slice(1) });
  }
  if (ext === '.jpg') {
    // an alpha channel without transparency
    image = image.removeAlpha();
  }
  await encode(image, ext, { jpeg: ORIGINAL_JPEG_QUALITY }).toFile(output);
  return ext === '.png' ? 'png' : 'jpg';
};

// the long side of the previews, for the UI: its cards show the images at about 300 px
const PREVIEW_SIZE = 480;
const PREVIEW_QUALITY = 70;

/**
 * A small JPEG of a stored original, upright, as a data URL: the preview of the UI when the browser cannot decode the
 * uploaded file (HEIC and TIFF but in Safari).
 */
export const previewDataUrl = async (file: string): Promise<string> => {
  const jpeg = await openImage(file)
    .autoOrient()
    .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
};
