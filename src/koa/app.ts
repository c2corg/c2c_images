import cors from '@koa/cors';
import Koa, { Context } from 'koa';
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
    allowMethods: 'GET,POST',
    allowHeaders: 'Origin, Content-Type, Accept, Authorization',
    maxAge: '1728000'
  })
);

// Track response times
koa.use(promHttpReporter);

// Top level error handling
koa.use(async (ctx, next) => {
  try {
    await next();
    if (ctx.status === 404) {
      // No route matched
      ctx.throw(404);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    let message = {};
    switch (error.status) {
      case 400:
      case 401:
      case 403:
      case 404:
      case 405:
      case 408:
      case 409:
      case 501:
      case 504:
        message = error.message;
        break;
      default:
        if (['development', 'demo'].includes(process.env['NODE_ENV'] ?? '')) {
          message = typeof error?.message === 'string' ? error.message : JSON.stringify(error.message);
        } else {
          message = 'Internal server error';
        }
        break;
    }
    ctx.status = error.statusCode || error.status || 500;
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
koa.use(router.allowedMethods({ throw: true }));

export { koa };
