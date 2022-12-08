import { identify } from '../exec/imagemagick.js';

export const getFileSize = (filename: string): string => {
  const { widthxheight } = identify(filename);
  return widthxheight;
};
