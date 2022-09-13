import { koa } from './app.js';
import { METRICS_PORT, SERVICE_PORT } from './config.js';
import { imageMagickVersion, rsvgConvertVersion } from './convert.js';
import { log } from './log.js';
import { metricsServer } from './metrics.js';

// check required tools exist
log.info('Using rsvg-convert', rsvgConvertVersion());
log.info('Using imagemagick', imageMagickVersion());

// Listen for REST request
koa.listen(SERVICE_PORT);

// Export metrics for prometheus
metricsServer.listen(METRICS_PORT);

log.info('Service starting');
