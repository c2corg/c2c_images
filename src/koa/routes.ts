import Router from '@koa/router';
import { koaBody } from 'koa-body';
import fs from 'node:fs';
import path from 'node:path';
import { AUTO_ORIENT_ORIGINAL } from '../config.js';
import { autoOrient } from '../image/autoorient.js';
import { getFileFormat } from '../image/filetype.js';
import { rotateImages } from '../image/rotate.js';
import { createThumbnails, thumbnailKeys } from '../image/thumbnails.js';
import { log } from '../log.js';
import {
  promDeletedImagesCounter,
  promPublishedImagesCounter,
  promRotatedImagesCounter,
  promUploadedImagesCounter
} from '../metrics/prometheus.js';
import { activeStorage, incomingStorage, tempStorage } from '../storage/storage.js';
import { apiOnly } from './apionly.js';
import { generateUniqueKeyPrefix } from './utils.js';
import { DeleteBody, PublishBody, RotateBody, UploadFiles, validate } from './validation.js';

export const router = new Router();
const bodyParser = koaBody({ multipart: true });

// Health endpoint
router.get('/ping', async ctx => {
  ctx.body = 'Pong!';
});

// Uploaded images are verified, resized images generated and stored in the incoming storage
// This endpoint is called directly by the UI.
router.post('/upload', bodyParser, async ctx => {
  const keyPrefix = generateUniqueKeyPrefix();
  const { file } = validate(ctx, UploadFiles, 'files');

  let format: string;
  try {
    format = getFileFormat(file.filepath);
  } catch (error: unknown) {
    ctx.throw(400, error instanceof Error ? error.message : `${error}`);
    return;
  }

  // rename with 'official' extension
  const originalKey = `${keyPrefix}.${format}`;
  fs.renameSync(file.filepath, tempStorage.path(originalKey));

  // auto orient
  if (AUTO_ORIENT_ORIGINAL && format === 'jpg') {
    autoOrient(tempStorage.path(originalKey));
  }

  // create resized images
  await createThumbnails(tempStorage.path(originalKey));

  log.debug(`${keyPrefix} - uploading original file`);
  await Promise.all([originalKey, ...thumbnailKeys(originalKey)].map(key => tempStorage.move(key, incomingStorage)));

  log.debug(`${keyPrefix} - returning response`);

  promUploadedImagesCounter.inc({ format }, 1);
  ctx.body = {
    success: true,
    filename: `${keyPrefix}.${format}`
  };
});

// Publish images from incoming storage to active storage
// Only called by api service
router.post('/publish', bodyParser, apiOnly, async ctx => {
  const { filename: key } = validate(ctx, PublishBody);

  const published = await activeStorage.exists(key);
  const incoming = await incomingStorage.exists(key);

  if (!published && !incoming) {
    ctx.throw(404, 'Unknown image.');
  }

  if (!published) {
    await Promise.all(
      thumbnailKeys(key).map(async resizedKey => {
        if (await incomingStorage.exists(resizedKey)) {
          return incomingStorage.move(resizedKey, activeStorage);
        }
      })
    );

    await incomingStorage.move(key, activeStorage);

    promPublishedImagesCounter.inc(1);
  }

  ctx.body = { success: true };
});

// Delete a file from active storage
// Only called by api service
router.post('/delete', bodyParser, apiOnly, async ctx => {
  const { filenames: keys } = validate(ctx, DeleteBody);

  const allPublished = await Promise.all(keys.map(key => activeStorage.exists(key)));
  if (!allPublished) {
    ctx.throw(404);
  }

  await Promise.all(
    keys
      .flatMap(key => [key, ...thumbnailKeys(key)])
      .map(key => activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`)))
  );

  promDeletedImagesCounter.inc(1);
  ctx.body = { success: true };
});

router.post('/rotate', bodyParser, apiOnly, async ctx => {
  const { rotation = '90', filename: key } = validate(ctx, RotateBody);

  const published = await activeStorage.exists(key);

  if (!published) {
    ctx.throw(404, 'Not found');
  }

  const newKey = `${generateUniqueKeyPrefix()}${path.parse(key).ext}`;

  await rotateImages(key, newKey, rotation);

  promRotatedImagesCounter.inc(1);
  ctx.body = { success: true, filename: newKey };
});
