import os from 'node:os';
import yn from 'yn';

export const SERVICE_NAME = 'c2c_images';

export const SERVICE_PORT = process.env['SERVICE_PORT'] || 8080;
export const METRICS_PORT = process.env['METRICS_PORT'] || 8081;
export const METRICS_PATH = process.env['METRICS_PATH'] || '/metrics';
export const DISABLE_PROMETHEUS_METRICS = yn(process.env['DISABLE_PROMETHEUS_METRICS'], { default: false });

export const API_SECRET_KEY = process.env['API_SECRET_KEY'];

if (!process.env['STORAGE_BACKEND']) {
  throw new Error('STORAGE_BACKEND missing');
}
export const STORAGE_BACKEND = process.env['STORAGE_BACKEND'];
export const TEMP_FOLDER = process.env['TEMP_FOLDER'] || `${os.tmpdir()}/images/temp`;

export interface ResizeConfig {
  suffix: string;
  convert: string[];
}
// See documentation at http://www.imagemagick.org/Usage/resize
// If set via env variable, should be in json format
export const RESIZING_CONFIG: ResizeConfig[] = process.env['RESIZING_CONFIG']
  ? JSON.parse(process.env['RESIZING_CONFIG'])
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

export const S3_EXPIRE_HOURS = 2;

export const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '*').split(',');

export const PREFER_IDENTIFY_OVER_FILE = yn(process.env['PREFER_IDENTIFY_OVER_FILE'], { default: false });
