import path from 'node:path';

import { AVIF_QUALITY_DRAWING, GENERATE_AVIF, GENERATE_WEBP, RESIZING_CONFIG, type ResizeConfig } from '../config.js';
import { log } from '../log.js';
import { imageGenerationsHistogram } from '../metrics/prometheus.js';

import { encode, openImage } from './sharp.js';
import { isDrawing } from './svg.js';

// the thumbnails of an SVG are JPEG, the others keep the format of the image unless asked
const thumbnailKey = (key: string, suffix: string, format?: string): string => {
  const { ext, name } = path.parse(key);
  return `${name}${suffix}${format ?? (ext === '.svg' ? '.jpg' : ext)}`;
};

const modernFormats = (): string[] => [...(GENERATE_AVIF ? ['.avif'] : []), ...(GENERATE_WEBP ? ['.webp'] : [])];

export const baseThumbnailKeys = (key: string): string[] =>
  RESIZING_CONFIG.map(config => thumbnailKey(key, config.suffix));

export const modernThumbnailKeys = (key: string): string[] =>
  RESIZING_CONFIG.flatMap(config => modernFormats().map(format => thumbnailKey(key, config.suffix, format)));

export const allThumbnailKeys = (key: string): string[] => [...baseThumbnailKeys(key), ...modernThumbnailKeys(key)];

export const createThumbnail = async (
  dir: string,
  originalKey: string,
  config: ResizeConfig,
  format?: string,
  { truncated = false }: { truncated?: boolean } = {}
): Promise<void> => {
  const { ext } = path.parse(originalKey);
  const originalPath = path.join(dir, originalKey);
  const resizedPath = path.join(dir, thumbnailKey(originalKey, config.suffix, format));
  const resizedExt = path.extname(resizedPath);
  const { width, height, fit } = config;

  log.info(`Creating resized image ${resizedPath}, ${fit} ${width}x${height}`);
  const end = imageGenerationsHistogram.startTimer({ format: resizedExt.slice(1), size: config.suffix });

  // animated GIF stay animated in GIF and WebP (AVIF has no animation in libvips)
  let image = openImage(originalPath, {
    svg: ext === '.svg',
    animated: ext === '.gif' && (resizedExt === '.gif' || resizedExt === '.webp'),
    truncated
  }).autoOrient();
  if (ext === '.svg') {
    image = image.flatten({ background: 'white' });
  }
  image = image.resize({
    width,
    height,
    fit,
    // inside: smaller images are kept as they are; cover: cropped around the center to fill the size
    withoutEnlargement: fit === 'inside'
  });
  // the AVIF of an SVG drawing keeps its lines and text sharp (#1198)
  const avif =
    ext === '.svg' && resizedExt === '.avif' && (await isDrawing(originalPath)) ? AVIF_QUALITY_DRAWING : undefined;
  await encode(image, resizedExt, avif ? { avif } : {}).toFile(resizedPath);
  end();
};

/**
 * Creates thumbnails for an image.
 * The promise is fullfilled once the "basic" thumbnails are created.
 * An additional promise (allRendered) can be used to be notified
 * when modern images are available.
 */
// all the promises settled (no rendering still writing its file), rejected with the first error if any
const allSettled = async (promises: Promise<void>[]): Promise<void[]> => {
  const results = await Promise.allSettled(promises);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  return results.map(() => undefined);
};

export const createThumbnails = async (file: string): Promise<{ allRendered: Promise<void[]> }> => {
  const { base: key, dir } = path.parse(file);

  // generate thumbnails with default format
  await allSettled(RESIZING_CONFIG.map(async config => createThumbnail(dir, key, config)));

  // "modern" thumbnail formats, asynchronously
  const allRendered = allSettled(
    RESIZING_CONFIG.flatMap(config => modernFormats().map(async format => createThumbnail(dir, key, config, format)))
  );

  return { allRendered };
};
