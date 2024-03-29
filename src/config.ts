import os from 'node:os';
import yn from 'yn';
import { z } from 'zod';

export const SERVICE_NAME = 'c2c_images';

export const SERVICE_PORT = Number.parseInt(process.env['SERVICE_PORT'] || '') || 8080;
export const METRICS_PORT = Number.parseInt(process.env['METRICS_PORT'] || '') || 8081;
export const METRICS_PATH = process.env['METRICS_PATH'] || '/metrics';
export const DISABLE_PROMETHEUS_METRICS = yn(process.env['DISABLE_PROMETHEUS_METRICS'], { default: false });

export const API_SECRET_KEY = process.env['API_SECRET_KEY'];

if (!process.env['STORAGE_BACKEND']) {
  throw new Error('STORAGE_BACKEND missing');
}
export const STORAGE_BACKEND = process.env['STORAGE_BACKEND'];
export const TEMP_FOLDER = process.env['TEMP_FOLDER'] || `${os.tmpdir()}/images/temp`;

// See documentation at http://www.imagemagick.org/Usage/resize
// If set via environment variable, should be in json format
const ResizeConfig = z.object({
  suffix: z.string(),
  convert: z.string().array()
});
export type ResizeConfig = z.infer<typeof ResizeConfig>;
export const RESIZING_CONFIG: ResizeConfig[] = process.env['RESIZING_CONFIG']
  ? z.array(ResizeConfig).parse(JSON.parse(process.env['RESIZING_CONFIG']))
  : [
      { suffix: 'BI', convert: ['-thumbnail', '1500x1500>', '-quality', '90'] },
      { suffix: 'MI', convert: ['-thumbnail', '400x400>', '-quality', '90'] },
      {
        suffix: 'SI',
        convert: ['-thumbnail', '200x200^', '-gravity', 'center', '-extent', '200x200', '-quality', '90']
      }
    ];
export const CACHE_CONTROL = process.env['CACHE_CONTROL'] || 'public, max-age=3600';
export const AUTO_ORIENT_ORIGINAL = yn(process.env['AUTO_ORIENT_ORIGINAL'], { default: false });
export const GENERATE_AVIF = yn(process.env['GENERATE_AVIF'], { default: false });
export const GENERATE_WEBP = yn(process.env['GENERATE_WEBP'], { default: false });

export const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '*').split(',');

export const PREFER_IDENTIFY_OVER_FILE = yn(process.env['PREFER_IDENTIFY_OVER_FILE'], { default: false });
export const THUMBNAILS_PUBLISH_DELAY = Number.parseInt(process.env['THUMBNAILS_PUBLISH_DELAY'] ?? '', 10) || 20000;
export const S3_EXPIRE_HOURS = 2;
