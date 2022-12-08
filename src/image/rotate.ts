import { transform } from '../exec/imagemagick.js';
import { log } from '../log.js';
import { imageRotationsHistogram } from '../metrics/prometheus.js';
import { activeStorage, tempStorage } from '../storage/storage.js';
import { allThumbnailKeys, baseThumbnailKeys, createThumbnails, modernThumbnailKeys } from './thumbnails.js';

const uploadImage = (key: string) => tempStorage.move(key, activeStorage);
const uploadOriginalAndBaseThumbnails = (key: string) =>
  Promise.all([tempStorage.copy(key, activeStorage), baseThumbnailKeys(key).map(uploadImage)]);
const uploadModernThumbnails = (key: string) => modernThumbnailKeys(key).map(uploadImage);

export const rotateImages = async (originalKey: string, newKey: string, rotation: string): Promise<void> => {
  await activeStorage.copy(originalKey, tempStorage);
  const file = tempStorage.path(originalKey);
  const rotatedFile = tempStorage.path(newKey);
  const end = imageRotationsHistogram.startTimer();
  await transform(file, rotatedFile, ['-rotate', rotation]);
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
