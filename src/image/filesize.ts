import { identify } from '../exec/imagemagick.js';

export const getFileSize = async (filename: string): Promise<string> => {
  const { widthxheight } = await identify(filename);
  return widthxheight;
};
