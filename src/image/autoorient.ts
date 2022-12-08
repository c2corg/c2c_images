import { transform } from '../exec/imagemagick.js';
import { log } from '../log.js';
import { imageAutoorientHistogram } from '../metrics/prometheus.js';

export const autoOrient = (file: string): void => {
  log.info(`Change orientation for image ${file}`);
  const end = imageAutoorientHistogram.startTimer();
  transform(file, file, ['-auto-orient']);
  end();
};
