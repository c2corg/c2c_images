import fs from 'node:fs';

import { log } from '../log.js';
import { promReducedOriginalsCounter } from '../metrics/prometheus.js';

import { encode, openImage, ORIGINAL_JPEG_QUALITY } from './sharp.js';

// Limits of the stored originals (c2corg/c2c_images#1205), as the UI reduces them before the upload. The site shows
// 1500 px at most (BI thumbnail): a long side of 3072 px allows a 2x thumbnail. Panoramas (long side over twice the short
// side, horizontal or vertical) keep 2048 px on their short side, up to 16 megapixels.
const MAX_LONG_SIDE = 3072;
const PANORAMA_RATIO = 2;
const MAX_PANORAMA_SHORT_SIDE = 2048;
const MAX_PANORAMA_PIXELS = 16_000_000;

export interface Size {
  width: number;
  height: number;
}

/**
 * The size to store an image at, or undefined when it is under the limits. The same with width and height swapped.
 */
export const storedSize = ({ width, height }: Size): Size | undefined => {
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const scale =
    longSide / shortSide > PANORAMA_RATIO
      ? Math.min(MAX_PANORAMA_SHORT_SIDE / shortSide, Math.sqrt(MAX_PANORAMA_PIXELS / (width * height)))
      : MAX_LONG_SIDE / longSide;
  // rounded down, to stay under the limits (the epsilon against the errors of floating point)
  const reduce = (side: number): number => Math.max(1, Math.floor(side * scale + 1e-6));
  return scale < 1 ? { width: reduce(width), height: reduce(height) } : undefined;
};

/**
 * Reduces a JPEG or PNG original over the limits, in place, keeping its metadata (EXIF orientation, colour profile).
 * The converted formats are reduced when converted (heic.ts, convert.ts); SVG are drawings. The UI reduces the images
 * itself: this is for the other clients.
 */
export const reduceOriginal = async (file: string, ext: string): Promise<void> => {
  if (ext !== '.jpg' && ext !== '.png') {
    return;
  }
  // as stored, before the EXIF orientation: the limits are the same turned
  const { width = 0, height = 0 } = await openImage(file).metadata();
  const size = storedSize({ width, height });
  if (!size) {
    return;
  }
  log.info(`Reduce original ${file} from ${width}x${height} to ${size.width}x${size.height}`);
  const reduced = `${file}.reduced`;
  try {
    await encode(openImage(file).resize(size.width, size.height, { fit: 'fill' }).keepMetadata(), ext, {
      jpeg: ORIGINAL_JPEG_QUALITY
    }).toFile(reduced);
    await fs.promises.rename(reduced, file);
  } finally {
    await fs.promises.rm(reduced, { force: true });
  }
  promReducedOriginalsCounter.inc({ format: ext.slice(1) });
};

/**
 * The size of an image as displayed (after its EXIF orientation) and of its file, for the image document.
 */
export const describeOriginal = async (file: string): Promise<Size & { size: number }> => {
  const { autoOrient } = await openImage(file).metadata();
  const { size } = await fs.promises.stat(file);
  return { ...autoOrient, size };
};
