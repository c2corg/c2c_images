import { collectDefaultMetrics, Counter, Gauge, register } from 'prom-client';
import { SERVICE_NAME } from './config.js';

register.setDefaultLabels({ service: SERVICE_NAME });

// default metrics
if (!process.env['JEST_WORKER_ID']) {
  collectDefaultMetrics();
}

// errors counter
export const promErrorsCounter = new Counter({
  name: 'error_counter',
  help: 'Errors counter'
});

// service info
const info = new Gauge({
  name: `service_info`,
  help: 'Service info',
  labelNames: ['version', 'env']
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
info.labels(process.env['npm_package_version']!, process.env['NODE_ENV'] || '').set(1);
