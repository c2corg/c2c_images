import { identify } from './convert.js';

export const getFileSize = (filename: string): string => {
  return identify(filename, '%wx%h');
};
