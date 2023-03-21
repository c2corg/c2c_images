import cors from '@koa/cors';
import Koa, { HttpError, type Context } from 'koa';
import { ALLOWED_ORIGINS } from '../config.js';
import { log } from '../log.js';
import { promErrorsCounter, promHttpReporter } from '../metrics/prometheus.js';
import { router } from './routes.js';

const koa = new Koa();

// handle gracefull shutdown: reject any new connection attempt
koa.use(async (ctx: Context, next: () => Promise<unknown>): Promise<void> => {
  if (ctx['shuttingDown']) {
    ctx.status = 503;
    ctx.set('Connection', 'close');
    ctx.body = 'Server is shutting down';
  } else {
    await next();
  }
});

koa.use(
  cors({
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Origin', 'Content-Type', 'Accept', 'Authorization'],
    maxAge: '1728000',
    origin: ctx => {
      if (ALLOWED_ORIGINS.includes('*')) {
        return '*';
      }

      const requestOrigin = ctx.get('Origin');
      if (ALLOWED_ORIGINS.includes(requestOrigin)) {
        return requestOrigin;
      }

      return '';
    }
  })
);

// Track response times
koa.use(promHttpReporter);

// Top level error handling
koa.use(async (ctx, next) => {
  try {
    await next();
    if (ctx.status === 404) {
      ctx.throw(404);
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status ?? error.statusCode : undefined;
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    let message = error instanceof HttpError ? error.message : `${error}`;
    if (status === 500 && !['development', 'demo'].includes(process.env['NODE_ENV'] ?? '')) {
      message = 'Internal server error';
    }
    ctx.status = status || 500;
    ctx.body = message;

    ctx.app.emit('error', error, ctx);

    promErrorsCounter.inc();
  }
});

koa.on('error', (error: unknown, context?: Koa.Context) => {
  log.error('[koa]', error, context);
});

// REST requests logging
koa.use(async (ctx, next) => {
  if (ctx.url !== '/ping') {
    log.info(`${ctx.method} ${ctx.url}`);
  }
  await next();
});

koa.use(router.routes());
koa.use(router.allowedMethods());

export { koa };
