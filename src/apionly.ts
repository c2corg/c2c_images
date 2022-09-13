import type Koa from 'koa';
import { API_SECRET_KEY } from './config.js';

export const apiOnly: Koa.Middleware = async (ctx, next) => {
  const { secret } = ctx.request.body;
  if (!secret || secret !== API_SECRET_KEY) {
    return ctx.throw(403, 'Bad secret key.');
  }
  await next();
  return;
};
