import { sync as commandExists } from 'command-exists';
import { log } from '../log.js';
import { imageGenerationsHistogram } from '../metrics/prometheus.js';
import { runAsync, runSync } from './run.js';

const cmd = 'rsvg-convert';
const cmdExists = commandExists(cmd);

export const rasterizeSvg = async (svgFile: string, pngFile: string) => {
  log.info(`Rasterizing SVG ${svgFile}`);
  const end = imageGenerationsHistogram.startTimer({ format: 'svg', size: 'original' });
  await runAsync('rsvg-convert', ['-b', 'white', svgFile, '-o', pngFile]);
  end();
};

export const rsvgConvertVersion = () => {
  if (!cmdExists) {
    throw new Error('Rsvg convert is required');
  }
  return runSync(cmd, ['--version']).split('\n')[0];
};
