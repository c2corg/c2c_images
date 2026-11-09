import type { Request, RequestHandler } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from 'prom-client';

import { DISABLE_PROMETHEUS_METRICS, SERVICE_NAME } from '../config.js';

// Every name starts with c2corg_images_: the Grafana Alloy agent keeps the c2corg_* metrics only. Labels have a few values
// each (no key, address or user agent): the series of Grafana Cloud are counted.
const PREFIX = 'c2corg_images_';

register.setDefaultLabels({ service: SERVICE_NAME });

// process and Node.js metrics (CPU, memory, event loop, GC)
if (!DISABLE_PROMETHEUS_METRICS) {
  collectDefaultMetrics({ prefix: PREFIX });
}

// sharp renders a thumbnail in tens of ms, an upload takes up to seconds (S3)
const DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// --- HTTP

const httpRequestDuration = new Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'Duration of the HTTP requests, by route pattern (unmatched for the unknown paths)',
  labelNames: ['method', 'route', 'code'] as const,
  buckets: DURATION_BUCKETS
});

// the route pattern of a request, 'unmatched' when no route matched (the router is mounted at the root)
const routeOf = (req: Request): string => (req.route as { path?: string } | undefined)?.path ?? 'unmatched';

export const promHttpReporter: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: routeOf(req), code: res.statusCode });
  });
  next();
};

export const promRateLimitedCounter = new Counter({
  name: `${PREFIX}rate_limited_requests_total`,
  help: 'Requests refused by a rate limit (429), by route',
  labelNames: ['route'] as const
});

export const countRateLimited = (req: Request): void => {
  promRateLimitedCounter.inc({ route: routeOf(req) });
};

// request: answered 500; background: after the answer (modern thumbnails, delayed publication)
export const promErrorsCounter = new Counter({
  name: `${PREFIX}errors_total`,
  help: 'Internal errors, of requests or of work done after the answer',
  labelNames: ['kind'] as const
});

// --- images

export const promUploadedImagesCounter = new Counter({
  name: `${PREFIX}uploaded_images_total`,
  help: 'Images uploaded to the incoming bucket, by format as uploaded (heic: stored as jpg)',
  labelNames: ['format'] as const
});

// format: not an accepted image; svg: not a well-formed SVG; size: over MAX_UPLOAD_SIZE; pixels: over MAX_IMAGE_PIXELS
// or MAX_SVG_IMAGE_PIXELS (embedded images); rate: over UPLOAD_RATE_LIMIT
export const promRefusedUploadsCounter = new Counter({
  name: `${PREFIX}refused_uploads_total`,
  help: 'Uploads refused, by reason',
  labelNames: ['reason'] as const
});

export const promPublishedImagesCounter = new Counter({
  name: `${PREFIX}published_images_total`,
  help: 'Images published to the active bucket'
});

export const promPublishedThumbnailsErrorCounter = new Counter({
  name: `${PREFIX}unpublished_thumbnails_total`,
  help: 'Thumbnails still missing in the incoming bucket after the grace period of the publication'
});

export const promDeletedImagesCounter = new Counter({
  name: `${PREFIX}deleted_images_total`,
  help: 'Images deleted from the active bucket, thumbnails not counted'
});

export const promRotatedImagesCounter = new Counter({
  name: `${PREFIX}rotated_images_total`,
  help: 'Images rotated in the active bucket'
});

export const imageGenerationsHistogram = new Histogram({
  name: `${PREFIX}thumbnail_duration_seconds`,
  help: 'Duration of the rendering of a thumbnail, by format and size',
  labelNames: ['format', 'size'] as const,
  buckets: DURATION_BUCKETS
});

export const imageRotationsHistogram = new Histogram({
  name: `${PREFIX}rotation_duration_seconds`,
  help: 'Duration of the rotation of an image',
  buckets: DURATION_BUCKETS
});

export const imageAutoorientHistogram = new Histogram({
  name: `${PREFIX}autoorient_duration_seconds`,
  help: 'Duration of the auto-orientation of a JPEG image',
  buckets: DURATION_BUCKETS
});

// --- storage

export const s3RequestDuration = new Histogram({
  name: `${PREFIX}s3_request_duration_seconds`,
  help: 'Duration of the S3 requests, by operation and outcome (ok, not_found, error)',
  labelNames: ['operation', 'outcome'] as const,
  buckets: DURATION_BUCKETS
});

// by: rule (a lifecycle rule of the bucket), service (the service deletes the files), off
export const incomingCleanupInfo = new Gauge({
  name: `${PREFIX}incoming_cleanup_info`,
  help: 'How the files of the incoming bucket expire (1 for the current way)',
  labelNames: ['by'] as const
});

export const incomingCleanupDeleted = new Counter({
  name: `${PREFIX}incoming_cleanup_deleted_files_total`,
  help: 'Expired files of the incoming bucket deleted by the service'
});

// --- service

new Gauge({
  name: `${PREFIX}service_info`,
  help: 'Version and environment of the service',
  labelNames: ['version', 'env'] as const
})
  .labels(process.env['npm_package_version'] ?? 'dev', process.env['NODE_ENV'] ?? 'dev')
  .set(1);
