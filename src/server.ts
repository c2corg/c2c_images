import type { Server } from 'node:http';

import {
  DISABLE_PROMETHEUS_METRICS,
  INCOMING_CLEANUP,
  INCOMING_CLEANUP_DRY_RUN,
  INCOMING_CLEANUP_INTERVAL_MINUTES,
  INCOMING_MAX_AGE_HOURS,
  METRICS_PATH,
  METRICS_PORT,
  SERVICE_PORT,
  STORAGE
} from './config.js';
import { app, setShuttingDown } from './http/app.js';
import { closeServer } from './http/shutdown.js';
import { sharp } from './image/sharp.js';
import { log } from './log.js';
import { metricsApp } from './metrics/metrics.js';
import { startIncomingCleanup } from './storage/incoming-cleanup.js';
import { incomingClient } from './storage/storage.js';

let stopIncomingCleanup = (): void => undefined;

const closeGracefully = async (signal: string, ...servers: Server[]): Promise<void> => {
  log.info(`Received signal to terminate: ${signal}`);
  stopIncomingCleanup();

  setShuttingDown(true);

  try {
    await Promise.all(servers.map(async server => closeServer(server)));
  } catch (error) {
    log.error('Error in graceful shutdown ', error);
  }

  process.kill(process.pid, signal);
};

const { sharp: sharpVersion, vips, rsvg } = sharp.versions;
log.info(`Using sharp ${sharpVersion}, libvips ${vips}, librsvg ${rsvg ?? 'none'}`);

const servers: Server[] = [];

// Listen for REST request
servers.push(app.listen(SERVICE_PORT));
log.info(`Service starting on port ${SERVICE_PORT}`);

// Export metrics for prometheus
if (!DISABLE_PROMETHEUS_METRICS) {
  servers.push(metricsApp.listen(METRICS_PORT));
  log.info(`Prometheus metrics can be scrapped at port ${METRICS_PORT} path ${METRICS_PATH}`);
}

process.once('SIGINT', (signal: string) => void closeGracefully(signal, ...servers));
process.once('SIGTERM', (signal: string) => void closeGracefully(signal, ...servers));

// expiration of the files uploaded, never published
if (STORAGE.STORAGE_BACKEND === 's3') {
  startIncomingCleanup(
    incomingClient(),
    STORAGE.INCOMING_BUCKET,
    {
      mode: INCOMING_CLEANUP,
      maxAgeHours: INCOMING_MAX_AGE_HOURS,
      intervalMinutes: INCOMING_CLEANUP_INTERVAL_MINUTES,
      dryRun: INCOMING_CLEANUP_DRY_RUN
    },
    log
  )
    .then(({ stop }) => {
      stopIncomingCleanup = stop;
    })
    .catch((error: unknown) => log.error('Incoming bucket: cleanup not started', error));
}
