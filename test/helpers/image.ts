import sharp from 'sharp';

// the format, size and frames of an image file
export const imageInfo = async (
  file: string
): Promise<{ format: string | undefined; size: string; pages: number; orientation: number | undefined }> => {
  const { format, width, height, pages, pageHeight, orientation } = await sharp(file, { animated: true }).metadata();
  return { format, size: `${width}x${pageHeight ?? height}`, pages: pages ?? 1, orientation };
};
