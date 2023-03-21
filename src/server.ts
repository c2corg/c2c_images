import { retry, type ErrorCallback } from 'async';
import type { Server } from 'node:http';
import { DISABLE_PROMETHEUS_METRICS, METRICS_PATH, METRICS_PORT, SERVICE_PORT } from './config.js';
import { fileCmdExists } from './exec/file.js';
import {
  imageMagickVersion,
  isAvifWriteSupported,
  isSvgReadSupported,
  isWebpWriteSupported
} from './exec/imagemagick.js';
import { rsvgConvertVersion } from './exec/librsvg.js';
import { koa } from './koa/app.js';
import { log } from './log.js';
import { metricsKoa } from './metrics/metrics.js';

const closeServer = async (server: Server): Promise<void> => {
  const checkPendingRequests = (callback: ErrorCallback<Error | undefined>): void => {
    server.getConnections((err: Error | null, pendingRequests: number) => {
      if (err) {
        callback(err);
      } else if (pendingRequests) {
        callback(new Error(`Number of pending requests: ${pendingRequests}`));
      } else {
        callback();
      }
    });
  };

  return new Promise<void>((resolve, reject) => {
    retry({ times: 10, interval: 1000 }, checkPendingRequests, (error?: Error | null) => {
      if (error) {
        server.close(() => reject(error));
      } else {
        server.close(() => resolve());
      }
    });
  });
};

const closeGracefully = async (signal: string, ...servers: Server[]): Promise<void> => {
  log.info(`Received signal to terminate: ${signal}`);

  koa.context['shuttingDown'] = true;

  try {
    await Promise.all(servers.map(closeServer));
  } catch (error) {
    log.error('Error in graceful shutdown ', error);
  }

  process.kill(process.pid, signal);
};

// check required tools exist
log.info('Using rsvg-convert =>', rsvgConvertVersion());
log.info('Using imagemagick =>', imageMagickVersion());
log.info(`Webp write is ${isWebpWriteSupported ? '' : 'un'}supported`);
log.info(`Avif write is ${isAvifWriteSupported ? '' : 'un'}supported`);
log.info(`Svg read is ${isSvgReadSupported ? '' : 'un'}supported`);
log.info(`Using ${fileCmdExists ? 'file' : 'imagemagick'} to detect file formats`);

const servers: Server[] = [];

// Listen for REST request
servers.push(koa.listen(SERVICE_PORT));
log.info(`Service starting on port ${SERVICE_PORT}`);

// Export metrics for prometheus
if (!DISABLE_PROMETHEUS_METRICS) {
  servers.push(metricsKoa.listen(METRICS_PORT));
  log.info(`Prometheus metrics can be scrapped at port ${METRICS_PORT} path ${METRICS_PATH}`);
}

process.once('SIGINT', (signal: string) => void closeGracefully(signal, ...servers));
process.once('SIGTERM', (signal: string) => void closeGracefully(signal, ...servers));
