import fs from 'node:fs';
import path from 'node:path';
import { GENERATE_AVIF, GENERATE_WEBP, ResizeConfig, RESIZING_CONFIG } from '../config.js';
import { isAvifWriteSupported, isWebpWriteSupported, transform } from '../exec/imagemagick.js';
import { rasterizeSvg } from '../exec/librsvg.js';
import { log } from '../log.js';
import { imageGenerationsHistogram } from '../metrics/prometheus.js';

const thumbnailKey = (key: string, suffix: string, format?: string) => {
  const { ext, name } = path.parse(key);
  return `${name}${suffix}${ext === '.svg' ? '.jpg' : format ?? ext}`;
};

export const baseThumbnailKeys = (key: string) => RESIZING_CONFIG.flatMap(config => [thumbnailKey(key, config.suffix)]);

export const modernThumbnailKeys = (key: string) =>
  RESIZING_CONFIG.flatMap(config => {
    const keys: string[] = [];
    if (GENERATE_AVIF && isAvifWriteSupported) {
      keys.push(thumbnailKey(key, config.suffix, '.avif'));
    }
    if (GENERATE_WEBP && isWebpWriteSupported) {
      keys.push(thumbnailKey(key, config.suffix, '.webp'));
    }

    return keys;
  });

export const allThumbnailKeys = (key: string) => [...baseThumbnailKeys(key), ...modernThumbnailKeys(key)];

export const createThumbnail = async (
  dir: string,
  originalKey: string,
  config: ResizeConfig,
  format?: string
): Promise<void> => {
  const originalPath = path.join(dir, originalKey);
  const resizedPath = path.join(dir, thumbnailKey(originalKey, config.suffix, format));
  const resizeConfig = config.convert;

  log.info(`Creating resized image ${resizedPath} with options ${resizeConfig}`);
  const end = imageGenerationsHistogram.startTimer({ format: resizedPath.split('.').pop(), size: config.suffix });
  await transform(originalPath, resizedPath, resizeConfig);
  end();
};

/**
 * Creates thumbnails for an image.
 * The promise is fullfilled once the "basic" thumbnails are created.
 * An additional promise (allRendered) can be used to be notified
 * when modern images are available.
 */
export const createThumbnails = async (file: string): Promise<{ allRendered: Promise<void[]> }> => {
  const { base, name, ext, dir } = path.parse(file);
  let rasterFile: string | undefined;
  let key = base;
  if (ext === '.svg') {
    const svgKey = key;
    const jpgKey = `${name}.jpg`;
    rasterFile = path.join(dir, jpgKey);
    // rasterized svg will actually be a png file,
    // but it will not be kept and thumbnails will be jpg because of the extension
    await rasterizeSvg(path.join(dir, svgKey), rasterFile);
    key = jpgKey;
  }

  // generate thumbnails with default format
  await Promise.all(RESIZING_CONFIG.map(config => createThumbnail(dir, key, config)));

  // "modern" thumbnail formats, asynchronously
  const allRendered = Promise.all(
    RESIZING_CONFIG.flatMap(config => {
      const promises: Promise<void>[] = [];
      if (isWebpWriteSupported && GENERATE_WEBP) {
        promises.push(createThumbnail(dir, key, config, '.webp'));
      }
      if (isAvifWriteSupported && GENERATE_AVIF) {
        promises.push(createThumbnail(dir, key, config, '.avif'));
      }
      return promises;
    })
  ).finally(() => {
    if (rasterFile) {
      fs.unlinkSync(rasterFile);
    }
  });

  return { allRendered };
};
