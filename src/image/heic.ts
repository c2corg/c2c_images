import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';

import { log } from '../log.js';

import { encode, openImage, ORIGINAL_JPEG_QUALITY, sharp } from './sharp.js';

// HEIC: HEIF with HEVC images. The prebuilt libvips of sharp decodes AV1 (AVIF) only: HEVC is left out for its patents.
// The HEVC images are decoded by libheif and libde265 compiled to WebAssembly (heic-decode), then encoded by sharp.
export const isHeic = (format: string | undefined, compression: string | undefined): boolean =>
  format === 'heif' && compression === 'hevc';

// --- ISO BMFF boxes

interface Box {
  type: string;
  start: number; // of the content
  end: number;
}

// The boxes between start and end. Stops at the first malformed box.
const readBoxes = (buffer: Buffer, start: number, end: number): Box[] => {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        break;
      }
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) {
      break;
    }
    boxes.push({ type: buffer.toString('latin1', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
};

// The item properties of the file (meta > iprp > ipco)
const readItemProperties = (buffer: Buffer): Box[] => {
  const meta = readBoxes(buffer, 0, buffer.length).find(box => box.type === 'meta');
  // meta is a full box: version and flags first
  const iprp = meta && readBoxes(buffer, meta.start + 4, meta.end).find(box => box.type === 'iprp');
  const ipco = iprp && readBoxes(buffer, iprp.start, iprp.end).find(box => box.type === 'ipco');
  return ipco ? readBoxes(buffer, ipco.start, ipco.end) : [];
};

// The colour primaries of an nclx colour property (ITU-T H.273): 1 BT.709 (sRGB), 12 Display P3...
const readNclxPrimaries = (buffer: Buffer, properties: Box[]): number | undefined => {
  for (const { type, start, end } of properties) {
    if (type === 'colr' && end - start >= 6 && buffer.toString('latin1', start, start + 4) === 'nclx') {
      return buffer.readUInt16BE(start + 4);
    }
  }
  return undefined;
};

// --- EXIF

// The TIFF structure of an EXIF block, without its 'Exif\0\0' header
const exifTiff = (exif: Buffer): Buffer | undefined => {
  const offsets = [exif.indexOf('MM\0*', 0, 'latin1'), exif.indexOf('II*\0', 0, 'latin1')].filter(
    offset => offset >= 0
  );
  return offsets.length ? Buffer.from(exif.subarray(Math.min(...offsets))) : undefined;
};

// Reads the Orientation of the first IFD of a TIFF structure and sets it to 1 (upright), in place
const resetOrientation = (tiff: Buffer): number | undefined => {
  if (tiff.length < 8) {
    return undefined;
  }
  const littleEndian = tiff.toString('latin1', 0, 2) === 'II';
  const uint16 = (offset: number): number => (littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const ifd = littleEndian ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  if (ifd + 2 > tiff.length) {
    return undefined;
  }
  const count = uint16(ifd);
  for (let entry = ifd + 2; entry + 12 <= tiff.length && entry < ifd + 2 + count * 12; entry += 12) {
    if (uint16(entry) === 0x0112) {
      const orientation = uint16(entry + 8);
      if (littleEndian) {
        tiff.writeUInt16LE(1, entry + 8);
      } else {
        tiff.writeUInt16BE(1, entry + 8);
      }
      return orientation;
    }
  }
  return undefined;
};

// the rotations of the EXIF orientations; the mirrored ones (2, 4, 5, 7) do not come out of cameras
const ROTATIONS = new Map([
  [3, 180],
  [6, 90],
  [8, 270]
]);

// --- PNG

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

// Adds chunks after the IHDR chunk of a PNG: 8 bytes of signature, IHDR of 25 bytes
const insertPngChunks = (png: Buffer, chunks: Buffer[]): Buffer =>
  Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)]);

// --- decoding

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// a decoding takes about 1 s and 200 MB for 12 megapixels, synchronously: in a worker, not in the event loop, and
// 2 at most at a time. The worker ends with the decoding, and the memory of WebAssembly with it.
const MAX_CONCURRENT_DECODINGS = 2;
const DECODING_TIMEOUT = 60_000;

const heicDecodeModule = createRequire(import.meta.url).resolve('heic-decode');

const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
require(workerData.module)({ buffer: workerData.buffer }).then(
  ({ width, height, data }) => parentPort.postMessage({ width, height, data }, [data.buffer]),
  error => parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
);
`;

let runningDecodings = 0;
const waitingDecodings: (() => void)[] = [];

const decodeInWorker = (buffer: Buffer): Promise<DecodedImage> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { module: heicDecodeModule, buffer } });
    const timeout = setTimeout(() => {
      reject(new Error('HEIC decoding timed out.'));
      void worker.terminate();
    }, DECODING_TIMEOUT);
    worker.once('message', (message: DecodedImage | { error: string }) => {
      clearTimeout(timeout);
      if ('error' in message) {
        reject(new Error(`HEIC decoding failed: ${message.error}`));
      } else {
        resolve(message);
      }
      void worker.terminate();
    });
    worker.once('error', (error: unknown) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once('exit', code => {
      clearTimeout(timeout);
      // after a message or an error, the promise is already settled
      reject(new Error(`HEIC decoding stopped (exit code ${code}).`));
    });
  });

const decodeHeic = async (buffer: Buffer): Promise<DecodedImage> => {
  if (runningDecodings >= MAX_CONCURRENT_DECODINGS) {
    await new Promise<void>(resolve => waitingDecodings.push(resolve));
  }
  runningDecodings++;
  try {
    return await decodeInWorker(buffer);
  } finally {
    runningDecodings--;
    waitingDecodings.shift()?.();
  }
};

// the Display P3 profile of libvips, for the HEIC that describe their colours by an nclx property
let displayP3Profile: Promise<Buffer | undefined> | undefined;
const getDisplayP3Profile = async (): Promise<Buffer | undefined> => {
  displayP3Profile ??= sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .withIccProfile('p3')
    .png()
    .toBuffer()
    .then(async png => (await sharp(png).metadata()).icc);
  return displayP3Profile;
};

const DISPLAY_P3_PRIMARIES = 12;
// BT.709 (the primaries of sRGB), unspecified
const SRGB_PRIMARIES = [1, 2];

/**
 * Converts a HEIC image to a JPEG: upright, in sRGB, with its EXIF (date, position, camera) and orientation 1.
 */
export const convertHeicToJpeg = async (file: string, jpegFile: string): Promise<void> => {
  const buffer = await fs.promises.readFile(file);
  const { icc, exif } = await openImage(file).metadata();
  const properties = readItemProperties(buffer);

  // libheif applies the rotation and mirroring of the file (irot, imir): then the EXIF orientation only repeats it, as
  // in the photos of iPhones and Samsung phones. Without them, the EXIF orientation is the only one.
  const transformed = properties.some(({ type }) => type === 'irot' || type === 'imir');
  const tiff = exif && exifTiff(exif);
  const exifOrientation = tiff && resetOrientation(tiff);
  const rotation = transformed || !exifOrientation ? undefined : ROTATIONS.get(exifOrientation);

  let profile = icc;
  if (!profile) {
    const primaries = readNclxPrimaries(buffer, properties);
    if (primaries === DISPLAY_P3_PRIMARIES) {
      profile = await getDisplayP3Profile();
    } else if (primaries !== undefined && !SRGB_PRIMARIES.includes(primaries)) {
      log.warn(`HEIC colour primaries ${primaries} not supported, read as sRGB`);
    }
  }

  const { width, height, data } = await decodeHeic(buffer);
  // a PNG carries the colour profile and the EXIF to sharp, with the pixels as decoded: sharp converts to sRGB from it
  const png = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 4 }
  })
    .removeAlpha()
    .png({ compressionLevel: 0 })
    .toBuffer();
  const chunks: Buffer[] = [];
  if (profile) {
    chunks.push(pngChunk('iCCP', Buffer.concat([Buffer.from('icc\0\0', 'latin1'), zlib.deflateSync(profile)])));
  }
  if (tiff) {
    chunks.push(pngChunk('eXIf', tiff));
  }

  let image = openImage(insertPngChunks(png, chunks)).keepExif().toColourspace('srgb');
  if (rotation) {
    image = image.rotate(rotation);
  }
  await encode(image, '.jpg', { jpeg: ORIGINAL_JPEG_QUALITY }).toFile(jpegFile);
};
