import { transform } from './convert';
import { resizedKeys } from './resizing.js';
import { activeStorage, tempStorage } from './storage';

export const rotateImages = async (originalKey: string, rotation: string): Promise<void> => {
  for (const key of [originalKey, ...resizedKeys(originalKey)]) {
    if (!(await activeStorage.exists(key))) {
      continue;
    }

    await activeStorage.move(key, tempStorage);
    const file = tempStorage.path(key);
    transform(file, file, ['-rotate', rotation]);
    await tempStorage.move(key, activeStorage);
  }
};
