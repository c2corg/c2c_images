import Router from '@koa/router';
import koaBody from 'koa-body';
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
import {
  generateUniqueKeyPrefix,
  isFileParameterValid,
  isKeyParameterValid,
  isKeysParameterValid,
  isRotationParameterValid
} from './utils.js';

export const router = new Router();

// Health endpoint
router.get('/ping', async ctx => {
  ctx.body = 'Pong!';
});

// Uploaded images are verified, resized images generated and stored in the incoming storage
// This endpoint is called directly by the UI.
router.post('/upload', koaBody({ multipart: true }), async ctx => {
  const keyPrefix = generateUniqueKeyPrefix();
  const file = ctx.request.files?.['file'];

  if (!isFileParameterValid(file)) {
    ctx.throw(400, `Bad request. Exactly one file has to be provided.`);
    return;
  }

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
  createThumbnails(tempStorage.path(originalKey));

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
router.post('/publish', koaBody({ multipart: true }), apiOnly, async ctx => {
  const { filename: key } = ctx.request.body;

  if (!isKeyParameterValid(key)) {
    ctx.throw(400, 'Bad parameter "filename".');
    return;
  }

  const published = await activeStorage.exists(key);
  const incoming = await incomingStorage.exists(key);

  if (!published && !incoming) {
    ctx.throw(400, 'Unknown image.');
    return;
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
router.post('/delete', koaBody({ multipart: true }), apiOnly, async ctx => {
  let { filenames: keys } = ctx.request.body;
  keys = Array.isArray(keys) ? keys : [keys];
  if (!isKeysParameterValid(keys)) {
    ctx.throw(400, 'Bad parameter "filenames"');
    return;
  }

  const allPublished = await Promise.all(keys.map(key => activeStorage.exists(key)));
  if (!allPublished) {
    ctx.throw(404, 'Not found');
    return;
  }

  await Promise.all(
    keys
      .flatMap(key => [key, ...thumbnailKeys(key)])
      .map(key => activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`)))
  );

  promDeletedImagesCounter.inc(1);
  ctx.body = { success: true };
});

router.post('/rotate', koaBody({ multipart: true }), apiOnly, async ctx => {
  const { rotation = '90', filename: key } = ctx.request.body;

  if (!isKeyParameterValid(key)) {
    ctx.throw(400, 'Bad parameter "filename".');
    return;
  }

  if (!isRotationParameterValid(rotation)) {
    ctx.throw(400, 'Bad parameter "rotation" must be -90, 90 or 180');
    return;
  }

  const published = await activeStorage.exists(key);

  if (!published) {
    ctx.throw(404, 'Not found');
    return;
  }

  const newKey = `${generateUniqueKeyPrefix()}${path.parse(key).ext}`;

  await rotateImages(key, newKey, rotation);

  promRotatedImagesCounter.inc(1);
  ctx.body = { success: true, filename: newKey };
});
