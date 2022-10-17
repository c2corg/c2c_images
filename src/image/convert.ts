import { sync as commandExists } from 'command-exists';
import spawn from 'cross-spawn';
import { log } from '../log.js';

const useImageMagick7 = commandExists('magick');

export const rasterizeSvg = (svgFile: string, pngFile: string) => {
  log.info(`Rasterizing SVG ${svgFile}`);
  runSync('rsvg-convert', ['-b', 'white', svgFile, '-o', pngFile]);
};

export const transform = (originalFile: string, targetFile: string, options: string[]) => {
  runSync(useImageMagick7 ? 'magick' : 'convert', [originalFile, ...options, targetFile]);
};

export const identify = (filename: string, pattern = '%m'): string => {
  try {
    const format = useImageMagick7
      ? runSync('magick', ['identify', '-format', pattern, filename])
      : runSync('identify', ['-format', pattern, filename]);
    if (!format) {
      throw new Error();
    }
    return format;
  } catch {
    throw new Error('Unrecognized image format.');
  }
};

export const rsvgConvertVersion = () => {
  if (!commandExists('rsvg-convert')) {
    throw new Error('Rsvg convert is required');
  }
  return runSync('rsvg-convert', ['--version']).split('\n')[0];
};

export const imageMagickVersion = () => {
  // magick is the base command for version 7
  // identify and convert for version 6, we rely on identify since windows as a built-in convert command
  if (!commandExists('magick') && !commandExists('identify')) {
    throw new Error('Imagemagick is required');
  }
  return runSync(useImageMagick7 ? 'magick' : 'convert', ['--version']).split('\n')[0];
};

const runSync = (command: string, args: string[]) => {
  const { error, status, stdout } = spawn.sync(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });

  log.debug(`${command} ${args.join(' ')}`);

  if (error) {
    throw error;
  }

  if (status !== 0) {
    throw new Error(`Command failed, exited with code #${status}`);
  }

  return stdout.toString();
};

const isFormatSupported = (format: string): boolean =>
  runSync(useImageMagick7 ? 'magick' : 'convert', ['-list', 'format']).match(
    new RegExp(`^\\s+${format}\\*?\\s+\\w+\\s+[r-]([w-])[+-]`, 'm')
  )?.[1] === 'w';

export const isWebpSupported = isFormatSupported('WEBP');
export const isAvifSupported = isFormatSupported('AVIF');
