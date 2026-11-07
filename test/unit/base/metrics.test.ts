import type { Histogram } from 'prom-client';
import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';
import { metricsApp } from '../../../src/metrics/metrics.js';
import * as metrics from '../../../src/metrics/prometheus.js';
import { metricValue } from '../../helpers/metrics.js';

const httpRequests = async (labels: Record<string, string | number>): Promise<number> => {
  const histogram = (await import('prom-client')).register.getSingleMetric(
    'c2corg_images_http_request_duration_seconds'
  ) as Histogram;
  return metricValue(histogram, labels);
};

describe('metrics', () => {
  test.each([
    ['GET', '/ping', '/ping', 200],
    ['GET', '/nope', 'unmatched', 404],
    ['PUT', '/upload', '/upload', 405]
  ])('%s %s is counted with the route %s', async (method, path, route, code) => {
    const before = await httpRequests({ method, route, code });
    await request(app)[method === 'GET' ? 'get' : 'put'](path);
    expect(await httpRequests({ method, route, code })).toBe(before + 1);
  });

  test.each([
    ['format', 'test/data/music.tiff'],
    ['pixels', 'test/data/bomb.png']
  ])('refused uploads: %s', async (reason, file) => {
    const before = await metricValue(metrics.promRefusedUploadsCounter, { reason });
    expect((await request(app).post('/upload').attach('file', file)).status).toBe(400);
    expect(await metricValue(metrics.promRefusedUploadsCounter, { reason })).toBe(before + 1);
  });

  test('refused uploads: svg', async () => {
    const before = await metricValue(metrics.promRefusedUploadsCounter, { reason: 'svg' });
    // read by libvips, but without the SVG namespace: refused by the sanitizer
    const svg = '<svg width="10" height="10"><rect width="5" height="5"/></svg>';
    expect((await request(app).post('/upload').attach('file', Buffer.from(svg), 'x.svg')).status).toBe(400);
    expect(await metricValue(metrics.promRefusedUploadsCounter, { reason: 'svg' })).toBe(before + 1);
  });

  test('uploaded images, by format', async () => {
    const before = await metricValue(metrics.promUploadedImagesCounter, { format: 'png' });
    expect((await request(app).post('/upload').attach('file', 'test/data/piano.png')).status).toBe(200);
    expect(await metricValue(metrics.promUploadedImagesCounter, { format: 'png' })).toBe(before + 1);
  });

  test('the counter of unpublished thumbnails has no labels', async () => {
    const before = await metricValue(metrics.promPublishedThumbnailsErrorCounter);
    metrics.promPublishedThumbnailsErrorCounter.inc(2);
    expect(await metricValue(metrics.promPublishedThumbnailsErrorCounter)).toBe(before + 2);
  });

  test('/metrics: every metric is named c2corg_images_*', async () => {
    const response = await request(metricsApp).get('/metrics');
    expect(response.status).toBe(200);
    const names = response.text
      .split('\n')
      .filter(line => line.startsWith('# TYPE '))
      .map(line => line.split(' ')[2]);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter(name => !name?.startsWith('c2corg_images_'))).toEqual([]);
  });
});
