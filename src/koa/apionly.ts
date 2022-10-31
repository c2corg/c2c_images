import type Koa from 'koa';
import { API_SECRET_KEY } from '../config.js';

/**
 * Ensures that the requests comes with a valid API secret
 */
export const apiOnly: Koa.Middleware = async (ctx, next) => {
  const secret = typeof ctx.request.body === 'object' && ctx.request.body?.secret;
  if (!secret || secret !== API_SECRET_KEY) {
    ctx.throw(403, 'Bad secret key.');
  }
  await next();
};
