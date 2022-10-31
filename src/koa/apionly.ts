import type Koa from 'koa';
import { ApiSecret } from './validation.js';

/**
 * Ensures that the requests come with a valid API secret
 */
export const apiOnly: Koa.Middleware = async (ctx, next) => {
  const result = ApiSecret.safeParse(ctx.request.body);
  if (!result.success) {
    if (result.error.issues[0]?.message === 'Required') {
      ctx.throw(401, 'Missing secret key.');
    }
    ctx.throw(403, 'Bad secret key.');
  }
  await next();
};
