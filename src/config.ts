export const SERVICE_NAME = 'c2c_images';

export const SERVICE_PORT = process.env.SERVICE_PORT || 8080;
export const METRICS_PORT = process.env.METRICS_PORT || 8081;
export const METRICS_PATH = process.env.METRICS_PATH || '/metrics';

export const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!process.env.STORAGE_BACKEND) {
  throw new Error('STORAGE_BACKEND missing');
}
if (!process.env.TEMP_FOLDER) {
  throw new Error('TEMP_FOLDER missing');
}
export const STORAGE_BACKEND = process.env.STORAGE_BACKEND;
export const TEMP_FOLDER = process.env.TEMP_FOLDER;

export interface ResizeConfig {
  suffix: string;
  convert: string[];
}
// See documentation at http://www.imagemagick.org/Usage/resize
// If set via env variable, should be in json format
export const RESIZING_CONFIG: ResizeConfig[] = process.env.RESIZING_CONFIG
  ? JSON.parse(process.env.RESIZING_CONFIG)
  : [
      { suffix: 'BI', convert: ['-resize', '1500x1500>', '-quality', '90'] },
      { suffix: 'MI', convert: ['-resize', '400x400>', '-quality', '90'] },
      { suffix: 'SI', convert: ['-resize', '200x200^', '-gravity', 'center', '-extent', '200x200', '-quality', '90'] }
    ];
export const AUTO_ORIENT_ORIGINAL = (process.env.AUTO_ORIENT_ORIGINAL || 0) === '1';
export const CACHE_CONTROL = process.env.CACHE_CONTROL || 'public, max-age=3600';
