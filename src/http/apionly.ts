import type { RequestHandler } from 'express';
import createHttpError from 'http-errors';

import { ApiSecret } from './validation.js';

/**
 * Ensures that the requests come with a valid API secret
 */
export const apiOnly: RequestHandler = (req, _res, next) => {
  const result = ApiSecret.safeParse(req.body);

  if (result.success) {
    next();
    return;
  }

  if (result.error.issues[0]?.message === 'Required') {
    throw createHttpError(401, 'Missing secret key.');
  }

  throw createHttpError(403, 'Bad secret key.');
};
