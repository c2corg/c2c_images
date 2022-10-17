import path from 'node:path';

export const optimizeImage = (file: string): void => {
  const { ext } = path.parse(file);

  switch (ext) {
    case '.png':
      optimizePng(file);
      return;
    case '.jpg':
      optimizeJpg(file);
      return;
    default:
      return;
  }
};

const optimizePng = (file: string): void => {
  console.log(file);
  return;
};

const optimizeJpg = (file: string): void => {
  console.log(file);
  return;
};
