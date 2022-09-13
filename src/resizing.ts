import fs from 'node:fs';
import path from 'node:path';
import { ResizeConfig, RESIZING_CONFIG } from './config.js';
import { rasterizeSvg, transform } from './convert.js';
import { log } from './log.js';

const resizedKey = (key: string, suffix: string) => {
  const { ext, name } = path.parse(key);
  return `${name}${suffix}${ext === '.svg' ? '.jpg' : ext}`;
};

export const resizedKeys = (key: string) => RESIZING_CONFIG.map(config => resizedKey(key, config.suffix));

export const createResizedImage = (dir: string, originalKey: string, config: ResizeConfig): void => {
  const originalPath = path.join(dir, originalKey);
  const resizedPath = path.join(dir, resizedKey(originalKey, config.suffix));
  const resizeConfig = config.convert;

  log.info(`Creating resized image ${resizedPath} with options ${resizeConfig}`);
  transform(originalPath, resizedPath, resizeConfig);
};

export const createResizedImages = (file: string): void => {
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
    createResizedImage(dir, key, config);
  }

  if (rasterFile) {
    fs.unlinkSync(rasterFile);
  }
};
