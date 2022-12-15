import { sync as commandExists } from 'command-exists';
import { runAsync, runSync } from './run.js';

// 'magick' is the base command for version 7
// 'identify' and 'convert' for version 6
// We rely on 'identify' to detect if it is installed since windows as a built-in convert command
const useImageMagick7 = commandExists('magick');
export const imageMagickCmdExists = useImageMagick7 || commandExists('identify');

export const transform = async (originalFile: string, targetFile: string, options: string[]) =>
  runAsync(useImageMagick7 ? 'magick' : 'convert', [originalFile, ...options, targetFile]);

// We don't use -format option because it creates decode delegate error
// depending on system and build configuration. We rather parse the default output,
// which doesn't and has all needed information.
// Depending on the system and the build configuration of imagemagick, it can
// return 'PNG' for SVG files.
export const identify = async (filename: string): Promise<{ format: string; widthxheight: string }> => {
  try {
    const result = useImageMagick7
      ? await runAsync('magick', ['identify', filename])
      : await runAsync('identify', [filename]);
    const [, format, widthxheight] = result.split(' ');

    if (!format || !widthxheight) {
      throw new Error();
    }

    return { format, widthxheight };
  } catch {
    throw new Error('Unsupported image format.');
  }
};

export const imageMagickVersion = () => {
  if (!imageMagickCmdExists) {
    throw new Error('Imagemagick is required.');
  }
  return runSync(useImageMagick7 ? 'magick' : 'convert', ['--version']).split('\n')[0];
};

const isFormatSupported = (format: string, action: 'r' | 'w' = 'w'): boolean =>
  runSync(useImageMagick7 ? 'magick' : 'convert', ['-list', 'format']).match(
    new RegExp(`^\\s+${format}\\*?\\s+\\w+\\s+([r-])([w-])[+-]`, 'm')
  )?.[action === 'r' ? 1 : 2] === action;

export const isWebpWriteSupported = isFormatSupported('WEBP', 'w');
export const isAvifWriteSupported = isFormatSupported('AVIF', 'w');
export const isSvgReadSupported = isFormatSupported('SVG', 'r');
