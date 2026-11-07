import crypto from 'node:crypto';

import type { RequestHandler } from 'express';
import createHttpError from 'http-errors';

import { API_SECRET_KEY } from '../config.js';

const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
const secretDigest = digest(API_SECRET_KEY);

// compared in constant time; the digests have the same length whatever the length of the value
const isApiSecret = (value: string): boolean => crypto.timingSafeEqual(digest(value), secretDigest);

/**
 * Ensures that the requests come with a valid API secret
 */
export const apiOnly: RequestHandler = (req, _res, next) => {
  const secret: unknown = (req.body as Record<string, unknown> | undefined)?.['secret'];

  // eslint-disable-next-line security/detect-possible-timing-attacks -- only whether a secret was sent, its value is compared in constant time below
  if (secret === undefined) {
    throw createHttpError(401, 'Missing secret key.');
  }

  if (typeof secret !== 'string' || !isApiSecret(secret)) {
    throw createHttpError(403, 'Bad secret key.');
  }

  next();
};
