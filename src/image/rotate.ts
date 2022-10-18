import { log } from '../log.js';
import { activeStorage, tempStorage } from '../storage/storage.js';
import { transform } from './convert.js';
import { createResizedImages, resizedKeys } from './resizing.js';

export const rotateImages = async (originalKey: string, newKey: string, rotation: string): Promise<void> => {
  await activeStorage.copy(originalKey, tempStorage);
  const file = tempStorage.path(originalKey);
  const rotatedFile = tempStorage.path(newKey);
  transform(file, rotatedFile, ['-rotate', rotation]);

  // generate new thumbnails from rotated image
  createResizedImages(rotatedFile);

  // upload image and thumbnails to active storage
  await tempStorage.move(newKey, activeStorage);
  for (const newResizedKey of resizedKeys(newKey)) {
    await tempStorage.move(newResizedKey, activeStorage);
  }

  // delete old images from active bucket
  await activeStorage.delete(originalKey);
  for (const originalResizedKey of resizedKeys(originalKey)) {
    try {
      await activeStorage.delete(originalResizedKey);
    } catch {
      log.error(`Deleting ${originalResizedKey} failed`);
    }
  }
};
