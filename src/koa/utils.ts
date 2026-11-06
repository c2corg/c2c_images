import crypto from 'node:crypto';

export const generateUniqueKeyPrefix = (): string =>
  `${Math.floor(Date.now() / 1000)}_${crypto.randomInt(9999999999).toString().padStart(10, '0')}`;
