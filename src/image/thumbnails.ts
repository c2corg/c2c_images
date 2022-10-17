import fs from 'node:fs';
import path from 'node:path';
import { GENERATE_AVIF, GENERATE_WEBP, ResizeConfig, RESIZING_CONFIG } from '../config.js';
import { log } from '../log.js';
import { isAvifSupported, isWebpSupported, rasterizeSvg, transform } from './convert.js';

const thumbnailKey = (key: string, suffix: string, format?: string) => {
  const { ext, name } = path.parse(key);
  return `${name}${suffix}${ext === '.svg' ? '.jpg' : format ?? ext}`;
};

export const thumbnailKeys = (key: string) =>
  RESIZING_CONFIG.flatMap(config => {
    const keys = [thumbnailKey(key, config.suffix)];
    if (GENERATE_AVIF && isAvifSupported) {
      keys.push(thumbnailKey(key, config.suffix, '.avif'));
    }
    if (GENERATE_WEBP && isWebpSupported) {
      keys.push(thumbnailKey(key, config.suffix, '.webp'));
    }

    return keys;
  });

export const createThumbnail = (dir: string, originalKey: string, config: ResizeConfig, format?: string): void => {
  const originalPath = path.join(dir, originalKey);
  const resizedPath = path.join(dir, thumbnailKey(originalKey, config.suffix, format));
  const resizeConfig = config.convert;

  log.info(`Creating resized image ${resizedPath} with options ${resizeConfig}`);
  transform(originalPath, resizedPath, resizeConfig);
};

export const createThumbnails = (file: string): void => {
  const { base, name, ext, dir } = path.parse(file);
  let rasterFile: string | undefined;
  let key = base;
  if (ext === '.svg') {
    const svgKey = key;
    const jpgKey = `${name}.jpg`;
    rasterFile = path.join(dir, jpgKey);
    // rasterized svg will actually be a png file,
    // but it will not be kept and thumbnails will be jpg because of the extension
    rasterizeSvg(path.join(dir, svgKey), rasterFile);
    key = jpgKey;
  }

  for (const config of RESIZING_CONFIG) {
    // generate thumbnail with default format
    createThumbnail(dir, key, config);

    // "modern" thumbnail formats
    if (isWebpSupported && GENERATE_WEBP) {
      createThumbnail(dir, key, config, '.webp');
    }
    if (isAvifSupported && GENERATE_AVIF) {
      createThumbnail(dir, key, config, '.avif');
    }
  }

  if (rasterFile) {
    fs.unlinkSync(rasterFile);
  }
};
