import Router from '@koa/router';
import { koaBody } from 'koa-body';
import fs from 'node:fs';
import path from 'node:path';
import { AUTO_ORIENT_ORIGINAL, THUMBNAILS_PUBLISH_DELAY } from '../config.js';
import { autoOrient } from '../image/autoorient.js';
import { getFileFormat } from '../image/filetype.js';
import { rotateImages } from '../image/rotate.js';
import { allThumbnailKeys, baseThumbnailKeys, createThumbnails, modernThumbnailKeys } from '../image/thumbnails.js';
import { log } from '../log.js';
import {
  promDeletedImagesCounter,
  promErrorsCounter,
  promPublishedImagesCounter,
  promPublishedThumbnailsErrorCounter,
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
router.get('/ping', ctx => {
  ctx.body = 'Pong!';
});

// Uploaded images are verified, resized images generated and stored in the incoming storage
// This endpoint is called directly by the UI.
router.post('/upload', bodyParser, async ctx => {
  const keyPrefix = generateUniqueKeyPrefix();
  const { file } = validate(ctx, UploadFiles, 'files');

  const uploadImage = (key: string) => tempStorage.move(key, incomingStorage);
  const uploadOriginalAndBaseThumbnails = (key: string) =>
    Promise.all([tempStorage.copy(key, incomingStorage), ...baseThumbnailKeys(key).map(uploadImage)]);
  const uploadModernThumbnails = (key: string) =>
    Promise.all([tempStorage.delete(key), ...modernThumbnailKeys(key).map(uploadImage)]);

  let format: string;
  try {
    format = await getFileFormat(file.filepath);
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    ctx.throw(400, error instanceof Error ? error.message : `${error}`);
    return;
  }

  // rename with 'official' extension
  const originalKey = `${keyPrefix}.${format}`;
  fs.renameSync(file.filepath, tempStorage.path(originalKey));

  // auto orient
  if (AUTO_ORIENT_ORIGINAL && format === 'jpg') {
    await autoOrient(tempStorage.path(originalKey));
  }

  // create resized images
  const { allRendered } = await createThumbnails(tempStorage.path(originalKey));

  log.debug(`${keyPrefix} - uploading original file`);

  await uploadOriginalAndBaseThumbnails(originalKey);
  allRendered
    .then(async () => uploadModernThumbnails(originalKey))
    .catch(error => {
      log.error(error);
      promErrorsCounter.inc();
    });

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
    const publishThumbnails = async (thumbnailKeys: string[]): Promise<string[]> => {
      const unrenderedThumbnailKeys: string[] = [];
      await Promise.all(
        thumbnailKeys.map(async resizedKey => {
          if (await incomingStorage.exists(resizedKey)) {
            return incomingStorage.move(resizedKey, activeStorage);
          } else {
            unrenderedThumbnailKeys.push(resizedKey);
          }
        })
      );
      return unrenderedThumbnailKeys;
    };

    const missingThumbnailKeys = await publishThumbnails(allThumbnailKeys(key));

    // In some cases, it could be that all "modern" thumbnails are not yet generated (they are generated asyncrhonously)
    // In that case, we give it some more time to fullfill. This will be done asynchronously, and will not prevent the response to be sent.
    if (missingThumbnailKeys.length) {
      setTimeout(() => {
        publishThumbnails(missingThumbnailKeys)
          .then(({ length }) => {
            if (!length) {
              return;
            }
            // some thumbnails were not generated
            log.error(`${length} thumbnails could not be published for image ${key}`);
            promPublishedThumbnailsErrorCounter.labels({ key }).inc(length);
          })
          .catch(error => {
            log.error(error);
            promErrorsCounter.inc();
          });
      }, THUMBNAILS_PUBLISH_DELAY);
    }

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
      .flatMap(key => [key, ...allThumbnailKeys(key)])
      .map(key => activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`)))
  );

  promDeletedImagesCounter.inc(1);
  ctx.body = { success: true };
});

// Rotate the image and return a new key
// Only called by api service
router.post('/rotate', bodyParser, apiOnly, async ctx => {
  const { rotation = '90', filename: key } = validate(ctx, RotateBody);
  const { ext } = path.parse(key);

  if (ext === '.svg') {
    ctx.throw(400, 'SVG images rotation is not supported.');
  }

  const published = await activeStorage.exists(key);

  if (!published) {
    ctx.throw(404, 'Not found');
  }

  const newKey = `${generateUniqueKeyPrefix()}${ext}`;

  await rotateImages(key, newKey, rotation);

  promRotatedImagesCounter.inc(1);
  ctx.body = { success: true, filename: newKey };
});
