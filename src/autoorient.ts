import { transform } from './convert.js';
import { log } from './log.js';

export const autoOrient = (file: string): void => {
  log.info(`Change orientation for image ${file}`);
  transform(file, file, ['-auto-orient']);
};
