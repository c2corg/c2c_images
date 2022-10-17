import { DISABLE_PROMETHEUS_METRICS, METRICS_PATH, METRICS_PORT, SERVICE_PORT } from './config.js';
import { imageMagickVersion, rsvgConvertVersion } from './image/convert.js';
import { koa } from './koa/app.js';
import { log } from './log.js';
import { metricsServer } from './metrics/metrics.js';

// check required tools exist
log.info('Using rsvg-convert =>', rsvgConvertVersion());
log.info('Using imagemagick =>', imageMagickVersion());

// Listen for REST request
koa.listen(SERVICE_PORT);
log.info(`Service starting on port ${SERVICE_PORT}`);

// Export metrics for prometheus
if (!DISABLE_PROMETHEUS_METRICS) {
  metricsServer.listen(METRICS_PORT);
  log.info(`Prometheus metrics can be scrapped at http://localhost:${METRICS_PORT}${METRICS_PATH}`);
}
