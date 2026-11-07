import path from 'node:path';

import { log } from '../log.js';
import { imageRotationsHistogram } from '../metrics/prometheus.js';
import { activeStorage, tempStorage } from '../storage/storage.js';

import { encode, openImage, sharp } from './sharp.js';
import { allThumbnailKeys, baseThumbnailKeys, createThumbnails, modernThumbnailKeys } from './thumbnails.js';

const uploadImage = async (key: string): Promise<void> => tempStorage.move(key, activeStorage);
const uploadOriginalAndBaseThumbnails = async (key: string): Promise<void[]> =>
  Promise.all([tempStorage.copy(key, activeStorage), ...baseThumbnailKeys(key).map(uploadImage)]);
const uploadModernThumbnails = async (key: string): Promise<void[]> =>
  Promise.all(modernThumbnailKeys(key).map(uploadImage));

// libvips rotates no multi-page image: the frames of an animated GIF are rotated one by one, then joined again
const rotateAnimatedGif = async (file: string, rotatedFile: string, angle: number): Promise<void> => {
  const { pages = 1, delay, loop } = await openImage(file).metadata();
  const frames = await Promise.all(
    Array.from({ length: pages }, async (_, page) => sharp(file, { page }).rotate(angle).png().toBuffer())
  );
  await sharp(frames, { join: { animated: true } })
    .gif({ ...(delay ? { delay } : {}), ...(loop === undefined ? {} : { loop }) })
    .toFile(rotatedFile);
};

// upright first (EXIF orientation), then the rotation asked; the other metadata kept
const rotateImage = async (file: string, rotatedFile: string, angle: number): Promise<void> => {
  const ext = path.extname(file);
  const { pages = 1 } = await openImage(file).metadata();
  if (pages > 1) {
    await rotateAnimatedGif(file, rotatedFile, angle);
    return;
  }
  await encode(openImage(file).autoOrient().rotate(angle).keepMetadata(), ext, 90).toFile(rotatedFile);
};

export const rotateImages = async (originalKey: string, newKey: string, rotation: string): Promise<void> => {
  await activeStorage.copy(originalKey, tempStorage);
  const file = tempStorage.path(originalKey);
  const rotatedFile = tempStorage.path(newKey);
  const end = imageRotationsHistogram.startTimer();
  await rotateImage(file, rotatedFile, Number.parseInt(rotation, 10));
  end();

  // generate new thumbnails from rotated image
  const { allRendered } = await createThumbnails(rotatedFile);

  // upload image and thumbnails to active storage once rendered
  await uploadOriginalAndBaseThumbnails(newKey);

  // delete old images from active bucket
  await Promise.all(
    [originalKey, ...allThumbnailKeys(originalKey)].map(key =>
      activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`))
    )
  );

  allRendered
    .then(async () =>
      Promise.all([tempStorage.delete(originalKey), tempStorage.delete(newKey), uploadModernThumbnails(newKey)])
    )
    .catch(() => log.error(`Uploading some modern thumbnails for ${newKey} failed`));
};
