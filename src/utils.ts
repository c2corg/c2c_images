import type { File } from 'formidable';
import crypto from 'node:crypto';
import { RESIZING_CONFIG } from './config.js';

export const keyRegex = new RegExp(
  `^\\d{10}_\\d{10}(${RESIZING_CONFIG.map(({ suffix }) => suffix).join('|')})?\\.(jpg|png|gif|svg)$`
);

export const isFileParameterValid = (file: File | File[] | undefined): file is File =>
  !!file && !Array.isArray(file) && file.size > 0;

export const isKeyParameterValid = (input?: unknown): input is string =>
  !!input && !Array.isArray(input) && typeof input === 'string' && keyRegex.test(input);

export const isKeysParameterValid = (inputs?: unknown): inputs is string | string[] =>
  !!inputs && Array.isArray(inputs) && inputs.every(input => typeof input === 'string' && keyRegex.test(input));

export const generateUniqueKeyPrefix = () =>
  `${Math.floor(Date.now() / 1000)}_${crypto.randomInt(9999999999).toString().padStart(10, '0')}`;
