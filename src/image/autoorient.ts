import fs from 'node:fs';

import { log } from '../log.js';
import { imageAutoorientHistogram } from '../metrics/prometheus.js';

import { openImage } from './sharp.js';

// Rotates a JPEG image as its EXIF orientation says, keeping its other metadata. Not re-encoded when already upright.
export const autoOrient = async (file: string): Promise<void> => {
  const { orientation } = await openImage(file).metadata();
  if (!orientation || orientation === 1) {
    return;
  }
  log.info(`Change orientation for image ${file}`);
  const end = imageAutoorientHistogram.startTimer();
  const oriented = `${file}.oriented`;
  await openImage(file).autoOrient().keepMetadata().jpeg({ quality: 90 }).toFile(oriented);
  await fs.promises.rename(oriented, file);
  end();
};
