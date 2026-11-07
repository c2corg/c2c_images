import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import createHttpError, { isHttpError } from 'http-errors';
import multer from 'multer';

import { ALLOWED_ORIGINS, TRUST_PROXY } from '../config.js';
import { log } from '../log.js';
import { promErrorsCounter, promHttpReporter, promRefusedUploadsCounter } from '../metrics/prometheus.js';

import { router } from './routes.js';

let shuttingDown = false;

// graceful shutdown: the application then answers 503 to every request
export const setShuttingDown = (value: boolean): void => {
  shuttingDown = value;
};

const rejectWhenShuttingDown: RequestHandler = (_req, res, next) => {
  if (shuttingDown) {
    res.set('Connection', 'close').status(503).type('text/plain').send('Server is shutting down');
    return;
  }
  next();
};

// REST requests logging
const logRequest: RequestHandler = (req, _res, next) => {
  if (req.path !== '/ping') {
    log.info(`${req.method} ${req.originalUrl} from ${req.ip}`);
  }
  next();
};

// Errors are answered as plain text: the message of HTTP errors, a generic message for anything else
const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  log.error('[express]', error);

  let status = 500;
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  let message = `${error}`;
  if (isHttpError(error)) {
    ({ status, message } = error);
  } else if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = error.message;
    promRefusedUploadsCounter.inc({ reason: status === 413 ? 'size' : 'format' });
  }
  if (status >= 500) {
    promErrorsCounter.inc({ kind: 'request' });
  }
  if (status >= 500 && !['development', 'demo'].includes(process.env['NODE_ENV'] ?? '')) {
    message = 'Internal server error';
  }
  res.status(status).type('text/plain').send(message);
};

const app = express();

// HAProxy sends the address of the client in X-Forwarded-For
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');

app.use(rejectWhenShuttingDown);
app.use(
  cors({
    methods: ['GET', 'POST'],
    allowedHeaders: ['Origin', 'Content-Type', 'Accept', 'Authorization'],
    maxAge: 1728000,
    origin: (origin, callback) => {
      if (ALLOWED_ORIGINS.includes('*')) {
        callback(null, '*');
      } else {
        callback(null, origin !== undefined && ALLOWED_ORIGINS.includes(origin) ? origin : false);
      }
    }
  })
);
app.use(promHttpReporter);
app.use(logRequest);
app.use(router);
app.use((_req, _res, next) => {
  next(createHttpError(404));
});
app.use(errorHandler);

export { app };
