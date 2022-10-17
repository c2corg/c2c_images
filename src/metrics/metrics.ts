import http from 'http';
import { register } from 'prom-client';
import { METRICS_PATH } from '../config.js';

const server = http.createServer();
server.on('request', async (request, response) => {
  if (request.url !== METRICS_PATH) {
    response.writeHead(404);
    response.end();
  }
  response.end(await register.metrics());
});

export const metricsServer = server;
