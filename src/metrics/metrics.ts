import Router from '@koa/router';
import Koa from 'koa';
import { register } from 'prom-client';
import { METRICS_PATH } from '../config.js';

const koa = new Koa();
const router = new Router();
router.get(METRICS_PATH, async ctx => {
  ctx.body = await register.metrics();
});
koa.use(router.routes());

export const metricsKoa = koa;
