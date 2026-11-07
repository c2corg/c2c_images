import path from 'node:path';

import { log } from '../log.js';
import { imageRotationsHistogram } from '../metrics/prometheus.js';
import { activeStorage, tempStorage } from '../storage/storage.js';

import { encode, openImage, sharp } from './sharp.js';
import { removeFromTemp } from './temp.js';
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
  let allRendered: Promise<void[]>;
  try {
    await activeStorage.copy(originalKey, tempStorage);
    const end = imageRotationsHistogram.startTimer();
    await rotateImage(tempStorage.path(originalKey), tempStorage.path(newKey), Number.parseInt(rotation, 10));
    end();
    await removeFromTemp(originalKey);

    // generate new thumbnails from rotated image
    ({ allRendered } = await createThumbnails(tempStorage.path(newKey)));
    // handled below, also when the upload fails in the meantime
    allRendered.catch(() => undefined);

    // upload image and thumbnails to active storage once rendered
    await uploadOriginalAndBaseThumbnails(newKey);
  } catch (error) {
    await removeFromTemp(originalKey, newKey);
    throw error;
  }

  // delete old images from active bucket
  await Promise.all(
    [originalKey, ...allThumbnailKeys(originalKey)].map(async key =>
      activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`))
    )
  );

  allRendered
    .then(async () => Promise.all([tempStorage.delete(newKey), uploadModernThumbnails(newKey)]))
    .catch(async () => {
      log.error(`Uploading some modern thumbnails for ${newKey} failed`);
      await removeFromTemp(newKey);
    })
    .catch((error: unknown) => log.error(error));
};
