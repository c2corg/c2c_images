import { log } from '../log.js';
import { promRegeneratedThumbnailsCounter } from '../metrics/prometheus.js';
import { activeStorage, tempStorage } from '../storage/storage.js';

import { removeFromTemp } from './temp.js';
import { baseThumbnailKeys, createThumbnails, modernThumbnailKeys } from './thumbnails.js';

const restoreThumbnail = async (key: string): Promise<{ key: string; restored: boolean }> => ({
  key,
  restored: await activeStorage.restore(key).catch(() => {
    log.error(`Restoring ${key} failed`);
    return false;
  })
});

// the thumbnails without a version, generated again from the original: a format added since the upload (AVIF), a
// thumbnail never published
const regenerateThumbnails = async (key: string, missing: Set<string>): Promise<void> => {
  const upload = async (keys: string[]): Promise<void> => {
    const uploaded = keys.filter(thumbnail => missing.has(thumbnail));
    await Promise.all(uploaded.map(async thumbnail => tempStorage.copy(thumbnail, activeStorage)));
    promRegeneratedThumbnailsCounter.inc(uploaded.length);
  };

  let allRendered: Promise<void[]>;
  try {
    await activeStorage.copy(key, tempStorage);
    ({ allRendered } = await createThumbnails(tempStorage.path(key)));
    // handled below, also when the upload fails in the meantime
    allRendered.catch(() => undefined);
    await upload(baseThumbnailKeys(key));
  } catch (error) {
    log.error(`Regenerating the thumbnails of ${key} failed`, error);
    await removeFromTemp(key);
    return;
  }

  // the modern formats once rendered (seconds for AVIF), after the answer, as for an upload
  allRendered
    .then(async () => upload(modernThumbnailKeys(key)))
    .catch(() => log.error(`Regenerating some modern thumbnails of ${key} failed`))
    .finally(() => removeFromTemp(key).catch((error: unknown) => log.error(error)));
};

// Restores a deleted image and its thumbnails; false when the original has no version left
export const restoreImage = async (key: string): Promise<boolean> => {
  if (!(await activeStorage.restore(key))) {
    return false;
  }
  const thumbnails = await Promise.all([...baseThumbnailKeys(key), ...modernThumbnailKeys(key)].map(restoreThumbnail));
  const missing = new Set(thumbnails.filter(({ restored }) => !restored).map(thumbnail => thumbnail.key));
  if (missing.size > 0) {
    await regenerateThumbnails(key, missing);
  }
  return true;
};
