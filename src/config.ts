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
// cropped around the center. quality: of JPEG, WebP and AVIF.
const ResizeConfig = z.object({
  suffix: z.string().regex(/^[A-Z]+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(['inside', 'cover']),
  quality: z.number().int().min(1).max(100).default(90)
});
export type ResizeConfig = z.infer<typeof ResizeConfig>;

// as v6_images: big, medium and small images
const DEFAULT_RESIZING_CONFIG: ResizeConfig[] = [
  { suffix: 'BI', width: 1500, height: 1500, fit: 'inside', quality: 90 },
  { suffix: 'MI', width: 400, height: 400, fit: 'inside', quality: 90 },
  { suffix: 'SI', width: 200, height: 200, fit: 'cover', quality: 90 }
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
  // in bytes, 200 MiB as before (the default of koa-body)
  MAX_UPLOAD_SIZE: positiveInt(200 * 1024 * 1024),
  // uploads per minute and client address, on each instance. Generous: the UI uploads the images of a batch together
  UPLOAD_RATE_LIMIT: positiveInt(100),
  // requests to the API routes with a missing or bad secret, per minute and client address, on each instance
  AUTH_FAILURE_RATE_LIMIT: positiveInt(10),
  // default: the private networks, where HAProxy is
  TRUST_PROXY: z.string().default('loopback, uniquelocal').transform(parseTrustProxy),

  RESIZING_CONFIG: json(z.array(ResizeConfig).nonempty()).default(DEFAULT_RESIZING_CONFIG),
  CACHE_CONTROL: z.string().default('public, max-age=3600'),
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
  UPLOAD_RATE_LIMIT,
  AUTH_FAILURE_RATE_LIMIT,
  TRUST_PROXY,
  RESIZING_CONFIG,
  CACHE_CONTROL,
  AUTO_ORIENT_ORIGINAL,
  GENERATE_AVIF,
  GENERATE_WEBP,
  ALLOWED_ORIGINS,
  THUMBNAILS_PUBLISH_DELAY
} = parseEnv(process.env);
export const S3_EXPIRE_HOURS = 2;
