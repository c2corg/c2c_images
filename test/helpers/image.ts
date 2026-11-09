import sharp from 'sharp';

// the format, size and frames of an image file
export const imageInfo = async (
  file: string
): Promise<{ format: string | undefined; size: string; pages: number; orientation: number | undefined }> => {
  const { format, width, height, pages, pageHeight, orientation } = await sharp(file, { animated: true }).metadata();
  return { format, size: `${width}x${pageHeight ?? height}`, pages: pages ?? 1, orientation };
};

// an SVG embedding a blank PNG of that size, small whatever its size
export const svgWithEmbeddedImage = async (width: number, height: number): Promise<string> => {
  const png = await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><image width="100" height="100" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
};
