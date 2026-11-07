import fs from 'node:fs';

import { tempStorage } from '../storage/storage.js';

import { allThumbnailKeys } from './thumbnails.js';

// Removes images and all their thumbnails from the temp storage, whether they exist or not
export const removeFromTemp = async (...keys: string[]): Promise<void> => {
  await Promise.all(
    keys
      .flatMap(key => [key, ...allThumbnailKeys(key)])
      .map(async key => fs.promises.rm(tempStorage.path(key), { force: true }))
  );
};
