import type Koa from 'koa';
import { collectDefaultMetrics, Counter, exponentialBuckets, Gauge, Histogram, register } from 'prom-client';
import { DISABLE_PROMETHEUS_METRICS, SERVICE_NAME } from '../config.js';

register.setDefaultLabels({ service: SERVICE_NAME });

// default metrics
if (!process.env['JEST_WORKER_ID'] && !DISABLE_PROMETHEUS_METRICS) {
  collectDefaultMetrics();
}

// API response times
const promHttpRequests = new Histogram({
  name: 'http_requests_time',
  help: 'Duration of HTTP requests',
  labelNames: ['method', 'code', 'endpoint'] as const
});

export const promHttpReporter: Koa.Middleware = async (ctx, next) => {
  let endpoint: string;
  switch (ctx.path) {
    case '/ping':
    case '/upload':
    case '/publish':
    case '/delete':
      endpoint = ctx.path.substring(1);
      break;
    default:
      endpoint = 'notfound';
  }
  const end = promHttpRequests.startTimer({ method: ctx.method, endpoint });
  await next();
  end({ code: ctx.status });
};

// errors counter
export const promErrorsCounter = new Counter({
  name: 'error_counter',
  help: 'Errors counter'
});

// uploaded images
export const promUploadedImagesCounter = new Counter({
  name: 'uploaded_images',
  help: 'Counter of images uploaded to the incoming bucket',
  labelNames: ['format'] as const
});

// published images
export const promPublishedImagesCounter = new Counter({
  name: 'published_images',
  help: 'Counter of images published to the active bucket'
});

// deleted images
export const promDeletedImagesCounter = new Counter({
  name: 'deleted_images',
  help: 'Counter of images deleted from the active bucket'
});

// rotated images
export const promRotatedImagesCounter = new Counter({
  name: 'rotated_images',
  help: 'Counter of images rotated in the active bucket'
});

// image generation times
export const imageGenerationsHistogram = new Histogram({
  name: 'thumbnail_generations_time',
  help: 'Histogram of time taken to generate thumbnails',
  labelNames: ['format', 'size'],
  buckets: exponentialBuckets(1, 2, 7)
});

// image rotation times
export const imageRotationsHistogram = new Histogram({
  name: 'thumbnail_rotations_time',
  help: 'Histogram of time taken to rotate an image',
  buckets: exponentialBuckets(0.5, 2, 7)
});

// jpeg auto orient
export const imageAutoorientHistogram = new Histogram({
  name: 'autoorient_time',
  help: 'Histogram of time taken to autoorient a jpeg image'
});

// service info
new Gauge({
  name: `service_info`,
  help: 'Service info',
  labelNames: ['version', 'env']
})
  .labels(process.env['npm_package_version'] ?? 'dev', process.env['NODE_ENV'] ?? 'dev')
  .set(1);
