import fs from 'node:fs';
import path from 'node:path';

import express, { Router, type RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import createHttpError from 'http-errors';
import multer from 'multer';

import {
  AUTH_FAILURE_RATE_LIMIT,
  AUTO_ORIENT_ORIGINAL,
  MAX_UPLOAD_SIZE,
  TEMP_FOLDER,
  THUMBNAILS_PUBLISH_DELAY,
  UPLOAD_RATE_LIMIT
} from '../config.js';
import { autoOrient } from '../image/autoorient.js';
import { CONVERTED_FORMATS, convertImage, previewDataUrl } from '../image/convert.js';
import { getFileFormat } from '../image/filetype.js';
import { convertHeicToJpeg } from '../image/heic.js';
import { describeOriginal, reduceOriginal } from '../image/original.js';
import { rotateImages } from '../image/rotate.js';
import { checkEmbeddedImages, sanitizeSvgFile } from '../image/svg.js';
import { removeFromTemp } from '../image/temp.js';
import { allThumbnailKeys, baseThumbnailKeys, createThumbnails, modernThumbnailKeys } from '../image/thumbnails.js';
import { log } from '../log.js';
import {
  countRateLimited,
  promDeletedImagesCounter,
  promErrorsCounter,
  promPublishedImagesCounter,
  promPublishedThumbnailsErrorCounter,
  promRefusedUploadsCounter,
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
// Rate limits, by client address (X-Forwarded-For of HAProxy, see trust proxy). None on /ping: the health checks of
// HAProxy must never be refused, and it does nothing.
const limitOptions = {
  windowMs: 60_000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // the answer of express-rate-limit, counted
  handler: (req, res, _next, { statusCode, message }) => {
    countRateLimited(req);
    if (req.path === '/upload') {
      promRefusedUploadsCounter.inc({ reason: 'rate' });
    }
    res.status(statusCode).send(message);
  }
} as const satisfies Partial<Options>;
// uploads, before the file is received
const uploadRateLimit = rateLimit({ ...limitOptions, limit: UPLOAD_RATE_LIMIT });
// API routes: only the requests with a missing or bad secret count, against guessing it; the calls of v6_api never do.
// The requests in progress count until they end, but HAProxy sends at most 2 at a time to an instance.
const apiRateLimit = rateLimit({
  ...limitOptions,
  limit: AUTH_FAILURE_RATE_LIMIT,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401 && res.statusCode !== 403
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
    res.json(await upload(req.file, { preview: req.query['preview'] === '1' }));
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

// The response: the key of the original, and its size as stored (width and height as displayed, size in bytes), but SVG.
// With ?preview=1, a small JPEG of it as a data URL (convert.ts), but SVG.
interface Uploaded {
  success: true;
  filename: string;
  width?: number;
  height?: number;
  size?: number;
  preview?: string;
}

const upload = async (
  uploadedFile: Express.Multer.File | undefined,
  options: { preview: boolean }
): Promise<Uploaded> => {
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
    promRefusedUploadsCounter.inc({
      reason: error instanceof Error && error.message === 'Image too large.' ? 'pixels' : 'format'
    });
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw createHttpError(400, error instanceof Error ? error.message : `${error}`);
  }

  // only static SVG are kept
  if (format === 'svg') {
    try {
      await sanitizeSvgFile(file.path);
    } catch {
      promRefusedUploadsCounter.inc({ reason: 'svg' });
      throw createHttpError(400, 'Unsupported image format.');
    }
    // the embedded images are decoded whole by librsvg, whatever the size of the rendering (#1215)
    try {
      await checkEmbeddedImages(file.path);
    } catch {
      promRefusedUploadsCounter.inc({ reason: 'pixels' });
      throw createHttpError(400, 'Image too large.');
    }
  }

  // HEIC: stored as JPEG, as the browsers do not display it (only Safari)
  const uploadedFormat = format;
  // WebP, AVIF, TIFF, GIF: stored as JPEG, or PNG when transparent (GIF: PNG), reduced to the limits
  if (CONVERTED_FORMATS.has(format)) {
    try {
      format = await convertImage(file.path, format, `${file.path}.converted`);
      fs.renameSync(`${file.path}.converted`, file.path);
    } catch (error) {
      log.warn(error);
      fs.rmSync(`${file.path}.converted`, { force: true });
      promRefusedUploadsCounter.inc({ reason: 'format' });
      throw createHttpError(400, 'Unsupported image format.');
    }
  }
  if (format === 'heic') {
    try {
      await convertHeicToJpeg(file.path, `${file.path}.jpg`);
      fs.renameSync(`${file.path}.jpg`, file.path);
    } catch (error) {
      log.warn(error);
      fs.rmSync(`${file.path}.jpg`, { force: true });
      promRefusedUploadsCounter.inc({ reason: 'format' });
      throw createHttpError(400, 'Unsupported image format.');
    }
    format = 'jpg';
  }

  // rename with 'official' extension
  const originalKey = `${keyPrefix}.${format}`;
  fs.renameSync(file.path, tempStorage.path(originalKey));
  let stored: Omit<Uploaded, 'success' | 'filename'>;

  try {
    // auto orient
    if (AUTO_ORIENT_ORIGINAL && format === 'jpg') {
      await autoOrient(tempStorage.path(originalKey));
    }

    // over the limits of the originals: reduced (the converted images already are)
    if (uploadedFormat === format) {
      await reduceOriginal(tempStorage.path(originalKey), `.${format}`);
    }
    // the image document takes its size from the original as stored (SVG: the size of the drawing, from the UI)
    stored = format === 'svg' ? {} : await describeOriginal(tempStorage.path(originalKey));
    // for the UI, when the browser cannot decode the file
    if (options.preview && format !== 'svg') {
      stored.preview = await previewDataUrl(tempStorage.path(originalKey));
    }

    // create resized images
    const { allRendered } = await createThumbnails(tempStorage.path(originalKey));
    // handled below, also when the upload fails in the meantime
    allRendered.catch(() => undefined);

    log.debug(`${keyPrefix} - uploading original file`);
    await uploadOriginalAndBaseThumbnails(originalKey);

    allRendered
      .then(async () => uploadModernThumbnails(originalKey))
      .catch(async (error: unknown) => {
        log.error(error);
        promErrorsCounter.inc({ kind: 'background' });
        await removeFromTemp(originalKey);
      })
      .catch((error: unknown) => log.error(error));
  } catch (error) {
    await removeFromTemp(originalKey);
    throw error;
  }

  log.debug(`${keyPrefix} - returning response`);

  promUploadedImagesCounter.inc({ format: uploadedFormat });
  return {
    success: true,
    filename: `${keyPrefix}.${format}`,
    ...stored
  };
};

// Publish images from incoming storage to active storage
// Only called by api service
router.post('/publish', apiRateLimit, ...bodyParsers, apiOnly, async (req, res) => {
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
            promPublishedThumbnailsErrorCounter.inc(length);
          })
          .catch(error => {
            log.error(error);
            promErrorsCounter.inc({ kind: 'background' });
          });
      }, THUMBNAILS_PUBLISH_DELAY);
    }

    await incomingStorage.move(key, activeStorage);

    promPublishedImagesCounter.inc();
  }

  res.json({ success: true });
});

// Delete a file from active storage
// Only called by api service
router.post('/delete', apiRateLimit, ...bodyParsers, apiOnly, async (req, res) => {
  const { filenames: keys } = validate(req.body, DeleteBody);

  // as v6_images: no check that the files exist, the archives of a document may list files deleted since
  await Promise.all(
    keys
      .flatMap(key => [key, ...allThumbnailKeys(key)])
      .map(key => activeStorage.delete(key).catch(() => log.error(`Deleting ${key} failed`)))
  );

  promDeletedImagesCounter.inc(keys.length);
  res.json({ success: true });
});

// Rotate the image and return a new key
// Only called by api service
router.post('/rotate', apiRateLimit, ...bodyParsers, apiOnly, async (req, res) => {
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

  promRotatedImagesCounter.inc();
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
