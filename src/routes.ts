import Router from '@koa/router';
import koaBody from 'koa-body';
import fs from 'node:fs';
import { apiOnly } from './apionly.js';
import { autoOrient } from './autoorient.js';
import { AUTO_ORIENT_ORIGINAL } from './config.js';
import { getFileFormat } from './filetype.js';
import { log } from './log.js';
import { promDeletedImagesCounter, promPublishedImagesCounter, promUploadedImagesCounter } from './prometheus.js';
import { createResizedImages, resizedKeys } from './resizing.js';
import { activeStorage, incomingStorage, tempStorage } from './storage.js';
import { generateUniqueKeyPrefix, isFileParameterValid, isKeyParameterValid, isKeysParameterValid } from './utils.js';

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
    format = getFileFormat(file.path);
  } catch (error: unknown) {
    ctx.throw(400, error instanceof Error ? error.message : `${error}`);
    return;
  }

  // rename with 'official' extension
  const originalKey = `${keyPrefix}.${format}`;
  fs.renameSync(file.path, tempStorage.path(originalKey));

  // auto orient
  if (AUTO_ORIENT_ORIGINAL && format === 'jpg') {
    autoOrient(tempStorage.path(originalKey));
  }

  // create resized images
  createResizedImages(tempStorage.path(originalKey));

  log.debug(`${keyPrefix} - uploading original file`);
  await tempStorage.move(originalKey, incomingStorage);

  for (const key of resizedKeys(originalKey)) {
    await tempStorage.move(key, incomingStorage);
  }

  log.debug(`${keyPrefix} - returning response`);

  promUploadedImagesCounter.inc({ format }, 1);
  ctx.body = {
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
    for (const resizedKey of resizedKeys(key)) {
      if (await incomingStorage.exists(resizedKey)) {
        await incomingStorage.move(resizedKey, activeStorage);
      }
    }

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

  for (const key of keys) {
    try {
      await activeStorage.delete(key);
    } catch {
      log.error(`Deleting ${key} failed`);
    }
    for (const resizedKey of resizedKeys(key)) {
      try {
        await activeStorage.delete(resizedKey);
      } catch {
        log.error(`Deleting ${resizedKey} failed`);
      }
    }
  }

  promDeletedImagesCounter.inc(1);
  ctx.body = { success: true };
});
