import { transform } from '../exec/imagemagick.js';
import { log } from '../log.js';
import { imageRotationsHistogram } from '../metrics/prometheus.js';
import { activeStorage, tempStorage } from '../storage/storage.js';
import { createThumbnails, thumbnailKeys } from './thumbnails.js';

export const rotateImages = async (originalKey: string, newKey: string, rotation: string): Promise<void> => {
  await activeStorage.copy(originalKey, tempStorage);
  const file = tempStorage.path(originalKey);
  const rotatedFile = tempStorage.path(newKey);
  const end = imageRotationsHistogram.startTimer();
  transform(file, rotatedFile, ['-rotate', rotation]);
  end();

  // generate new thumbnails from rotated image
  await createThumbnails(rotatedFile);

  // upload image and thumbnails to active storage
  await Promise.all([newKey, ...thumbnailKeys(newKey)].map(key => tempStorage.move(key, activeStorage)));

  // delete old images from active bucket
  await Promise.all(
    [originalKey, ...thumbnailKeys(originalKey)].map(key =>
      activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`))
    )
  );
};
