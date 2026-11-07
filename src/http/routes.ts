import fs from 'node:fs';
import path from 'node:path';

import express, { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import createHttpError from 'http-errors';
import multer from 'multer';

import {
  AUTO_ORIENT_ORIGINAL,
  MAX_UPLOAD_SIZE,
  TEMP_FOLDER,
  THUMBNAILS_PUBLISH_DELAY,
  UPLOAD_RATE_LIMIT
} from '../config.js';
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

export const router = Router();
// v6_api posts form-encoded bodies, the filenames of /delete as repeated fields
const bodyParsers = [express.urlencoded({ extended: false }), express.json()] as const;
// by client address (X-Forwarded-For of HAProxy, see trust proxy), before the file is received
const uploadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: UPLOAD_RATE_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});
const fileParser = multer({ dest: TEMP_FOLDER, limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 } }).single('file');

// Health endpoint
router.get('/ping', (_req, res) => {
  res.type('text/plain').send('Pong!');
});

// Uploaded images are verified, resized images generated and stored in the incoming storage
// This endpoint is called directly by the UI.
router.post('/upload', uploadRateLimit, fileParser, async (req, res) => {
  try {
    res.json(await upload(req.file));
  } finally {
    // the file received, if it was not renamed. Multer names it in the temp folder; the check keeps any other path out.
    if (req.file) {
      const received = path.resolve(TEMP_FOLDER, path.basename(req.file.path));
      if (received.startsWith(path.resolve(TEMP_FOLDER) + path.sep)) {
        await fs.promises.rm(received, { force: true });
      }
    }
  }
});

const upload = async (uploadedFile?: Express.Multer.File): Promise<{ success: true; filename: string }> => {
  const keyPrefix = generateUniqueKeyPrefix();
  const { file } = validate(uploadedFile && { file: uploadedFile }, UploadFiles);

  const uploadImage = async (key: string): Promise<void> => tempStorage.move(key, incomingStorage);
  const uploadOriginalAndBaseThumbnails = async (key: string): Promise<void[]> =>
    Promise.all([tempStorage.copy(key, incomingStorage), ...baseThumbnailKeys(key).map(uploadImage)]);
  const uploadModernThumbnails = async (key: string): Promise<void[]> =>
    Promise.all([tempStorage.delete(key), ...modernThumbnailKeys(key).map(uploadImage)]);

  let format: string;
  try {
    format = await getFileFormat(file.path);
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw createHttpError(400, error instanceof Error ? error.message : `${error}`);
  }

  // rename with 'official' extension
  const originalKey = `${keyPrefix}.${format}`;
  fs.renameSync(file.path, tempStorage.path(originalKey));

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
  return {
    success: true,
    filename: `${keyPrefix}.${format}`
  };
};

// Publish images from incoming storage to active storage
// Only called by api service
router.post('/publish', ...bodyParsers, apiOnly, async (req, res) => {
  const { filename: key } = validate(req.body, PublishBody);

  const published = await activeStorage.exists(key);
  const incoming = await incomingStorage.exists(key);

  if (!published && !incoming) {
    throw createHttpError(404, 'Unknown image.');
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

  res.json({ success: true });
});

// Delete a file from active storage
// Only called by api service
router.post('/delete', ...bodyParsers, apiOnly, async (req, res) => {
  const { filenames: keys } = validate(req.body, DeleteBody);

  // as v6_images: no check that the files exist, the archives of a document may list files deleted since
  await Promise.all(
    keys
      .flatMap(key => [key, ...allThumbnailKeys(key)])
      .map(key => activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`)))
  );

  promDeletedImagesCounter.inc(1);
  res.json({ success: true });
});

// Rotate the image and return a new key
// Only called by api service
router.post('/rotate', ...bodyParsers, apiOnly, async (req, res) => {
  const { rotation = '90', filename: key } = validate(req.body, RotateBody);
  const { ext } = path.parse(key);

  if (ext === '.svg') {
    throw createHttpError(400, 'SVG images rotation is not supported.');
  }

  const published = await activeStorage.exists(key);

  if (!published) {
    throw createHttpError(404, 'Not found');
  }

  const newKey = `${generateUniqueKeyPrefix()}${ext}`;

  await rotateImages(key, newKey, rotation);

  promRotatedImagesCounter.inc(1);
  res.json({ success: true, filename: newKey });
});

// Other methods on the known paths, with an Allow header
const methodNotAllowed =
  (allow: string): RequestHandler =>
  (_req, res) => {
    res.set('Allow', allow).status(405).type('text/plain').send('Method Not Allowed');
  };
router.all('/ping', methodNotAllowed('HEAD, GET'));
for (const path of ['/upload', '/publish', '/delete', '/rotate']) {
  router.all(path, methodNotAllowed('POST'));
}
