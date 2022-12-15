import { transform } from '../exec/imagemagick.js';
import { log } from '../log.js';
import { imageAutoorientHistogram } from '../metrics/prometheus.js';

export const autoOrient = async (file: string): Promise<void> => {
  log.info(`Change orientation for image ${file}`);
  const end = imageAutoorientHistogram.startTimer();
  await transform(file, file, ['-auto-orient']);
  end();
};
