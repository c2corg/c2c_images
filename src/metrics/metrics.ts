import express from 'express';
import { register } from 'prom-client';

import { METRICS_PATH } from '../config.js';

export const metricsApp = express();
metricsApp.disable('x-powered-by');
metricsApp.get(METRICS_PATH, async (_req, res) => {
  res.type(register.contentType).send(await register.metrics());
});
