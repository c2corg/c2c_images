import os from 'node:os';

import { z } from 'zod';

export const SERVICE_NAME = 'c2c_images';

// The proxies whose X-Forwarded-For header is trusted (Express' "trust proxy" setting): a number of hops, true or false, or a
// comma-separated list of addresses, subnets or names (loopback, linklocal, uniquelocal).
const parseTrustProxy = (value: string): boolean | number | string => {
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return value;
};

// A thumbnail size. fit: inside keeps the proportions within width x height, without enlarging; cover fills width x height,
// cropped around the center. The quality is per format (JPEG_QUALITY...); a `quality` here, from older configurations, is
// ignored.
const ResizeConfig = z.object({
  suffix: z.string().regex(/^[A-Z]+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(['inside', 'cover'])
});
export type ResizeConfig = z.infer<typeof ResizeConfig>;

// as v6_images: big, medium and small images
const DEFAULT_RESIZING_CONFIG: ResizeConfig[] = [
  { suffix: 'BI', width: 1500, height: 1500, fit: 'inside' },
  { suffix: 'MI', width: 400, height: 400, fit: 'inside' },
  { suffix: 'SI', width: 200, height: 200, fit: 'cover' }
];

// a JSON value in a string
const json = <T extends z.ZodType>(schema: T): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<unknown, string>>, T> =>
  z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.issues.push({ code: 'custom', message: 'Invalid JSON', input: value });
        return z.NEVER;
      }
    })
    .pipe(schema);

const port = (defaultPort: number): z.ZodDefault<z.ZodCoercedNumber> =>
  z.coerce.number().int().min(1).max(65535).default(defaultPort);
const positiveInt = (defaultValue: number): z.ZodDefault<z.ZodCoercedNumber> =>
  z.coerce.number().int().positive().default(defaultValue);
const quality = (defaultValue: number): z.ZodDefault<z.ZodCoercedNumber> =>
  z.coerce.number().int().min(1).max(100).default(defaultValue);
// 1, true, yes, on, y, enabled or their opposites, case-insensitive
const flag = z.stringbool().default(false);

const Storage = z.discriminatedUnion('STORAGE_BACKEND', [
  z.object({
    STORAGE_BACKEND: z.literal('local'),
    INCOMING_FOLDER: z.string(),
    ACTIVE_FOLDER: z.string()
  }),
  z.object({
    STORAGE_BACKEND: z.literal('s3'),
    INCOMING_BUCKET: z.string(),
    // the prefix of the variables of the S3 service: <prefix>_ENDPOINT, <prefix>_ACCESS_KEY_ID...
    INCOMING_PREFIX: z.string(),
    ACTIVE_BUCKET: z.string(),
    ACTIVE_PREFIX: z.string()
  })
]);
export type StorageConfig = z.infer<typeof Storage>;

const Env = z.object({
  SERVICE_PORT: port(8080),
  METRICS_PORT: port(8081),
  METRICS_PATH: z.string().startsWith('/').default('/metrics'),
  DISABLE_PROMETHEUS_METRICS: flag,

  API_SECRET_KEY: z.string(),

  TEMP_FOLDER: z.string().default(`${os.tmpdir()}/images/temp`),
  // in bytes
  MAX_UPLOAD_SIZE: positiveInt(20 * 1024 * 1024),
  // width x height x frames of an uploaded image, against decompression bombs. The originals are reduced to 16 megapixels
  // at most (#1205): 100 leaves room for large panoramas and the 50 to 200 megapixel modes of the phones (JPEG).
  MAX_IMAGE_PIXELS: positiveInt(100_000_000),
  // width x height of an uploaded HEIC: decoded whole in WebAssembly, about 800 MB at the peak for 48 megapixels, two at
  // a time. 50 covers the largest HEIC of the phones (48 megapixels).
  MAX_HEIC_PIXELS: positiveInt(50_000_000),
  // width x height x frames of the raster images embedded in an SVG, together. librsvg decodes them whole, in memory
  // (4 bytes a pixel, and copies): about 360 MB at the peak for a 20 megapixel JPEG (c2corg/c2c_images#1215)
  MAX_SVG_IMAGE_PIXELS: positiveInt(25_000_000),
  // uploads per minute and client address, on each instance. Generous: the UI uploads the images of a batch together
  UPLOAD_RATE_LIMIT: positiveInt(100),
  // requests to the API routes with a missing or bad secret, per minute and client address, on each instance
  AUTH_FAILURE_RATE_LIMIT: positiveInt(10),
  // default: the private networks, where HAProxy is
  TRUST_PROXY: z.string().default('loopback, uniquelocal').transform(parseTrustProxy),

  RESIZING_CONFIG: json(z.array(ResizeConfig).nonempty()).default(DEFAULT_RESIZING_CONFIG),
  CACHE_CONTROL: z.string().default('public, max-age=3600'),
  // Quality of the thumbnails, per format: the scales differ (AVIF 55 looks like JPEG 80-85). JPEG through mozjpeg.
  // Chosen on photos of the site (c2corg/c2c_images#55): the conservative side of the usual web values, for terrain detail.
  JPEG_QUALITY: quality(82),
  AVIF_QUALITY: quality(55),
  // SVG drawings (embedded raster under half of the drawing): lines and text stay sharp (#1198)
  AVIF_QUALITY_DRAWING: quality(80),
  WEBP_QUALITY: quality(80),
  // CPU spent by the AVIF encoder, 0 (fast) to 9 (small files). 3: 4-5 times faster than 4 on photos of the site, files
  // the same size, a little less faithful (PSNR -0.1 to -0.5 dB) (#1201)
  AVIF_EFFORT: z.coerce.number().int().min(0).max(9).default(3),
  AUTO_ORIENT_ORIGINAL: flag,
  GENERATE_AVIF: flag,
  GENERATE_WEBP: flag,
  // comma-separated, * for any
  ALLOWED_ORIGINS: z
    .string()
    .default('*')
    .transform(value =>
      value
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
    ),
  // Files of the incoming bucket (uploaded, never published) expired after INCOMING_MAX_AGE_HOURS. auto: by a lifecycle
  // rule of the bucket, created if it has none, else by the service every INCOMING_CLEANUP_INTERVAL_MINUTES; off: neither.
  // With INCOMING_CLEANUP_DRY_RUN, the service only logs what it would do.
  INCOMING_CLEANUP: z.enum(['auto', 'off']).default('auto'),
  INCOMING_MAX_AGE_HOURS: positiveInt(24),
  INCOMING_CLEANUP_INTERVAL_MINUTES: positiveInt(60),
  INCOMING_CLEANUP_DRY_RUN: flag,
  // in ms
  THUMBNAILS_PUBLISH_DELAY: z.coerce.number().int().nonnegative().default(20000)
});

// an empty variable is an unset one
export const parseEnv = (env: NodeJS.ProcessEnv): z.infer<typeof Env> & { STORAGE: StorageConfig } => {
  const values = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = Env.safeParse(values);
  const storage = Storage.safeParse(values);
  if (!result.success || !storage.success) {
    const errors = [result.error, storage.error].filter(error => error !== undefined).map(z.prettifyError);
    throw new Error(`Invalid configuration:\n${errors.join('\n')}`);
  }
  return { ...result.data, STORAGE: storage.data };
};

export const {
  SERVICE_PORT,
  METRICS_PORT,
  METRICS_PATH,
  DISABLE_PROMETHEUS_METRICS,
  API_SECRET_KEY,
  STORAGE,
  TEMP_FOLDER,
  MAX_UPLOAD_SIZE,
  MAX_IMAGE_PIXELS,
  MAX_HEIC_PIXELS,
  MAX_SVG_IMAGE_PIXELS,
  UPLOAD_RATE_LIMIT,
  AUTH_FAILURE_RATE_LIMIT,
  TRUST_PROXY,
  RESIZING_CONFIG,
  CACHE_CONTROL,
  JPEG_QUALITY,
  AVIF_QUALITY,
  AVIF_QUALITY_DRAWING,
  WEBP_QUALITY,
  AVIF_EFFORT,
  AUTO_ORIENT_ORIGINAL,
  GENERATE_AVIF,
  GENERATE_WEBP,
  ALLOWED_ORIGINS,
  THUMBNAILS_PUBLISH_DELAY,
  INCOMING_CLEANUP,
  INCOMING_MAX_AGE_HOURS,
  INCOMING_CLEANUP_INTERVAL_MINUTES,
  INCOMING_CLEANUP_DRY_RUN
} = parseEnv(process.env);
