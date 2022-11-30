import { identify } from './convert.js';

export const getFileSize = (filename: string): string => {
  const { widthxheight } = identify(filename);
  return widthxheight;
};
