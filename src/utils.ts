import Application from 'koa';
import crypto from 'node:crypto';

export const multiParams = (
  ctx: Application.ParameterizedContext<unknown>,
  input: string | string[],
  name: string
): string[] => {
  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.some(value => typeof value !== 'string')) {
    return ctx.throw(400, `Bad parameter. "${name}"`);
  }
  return inputs;
};

export const uniqueParam = (
  ctx: Application.ParameterizedContext<unknown>,
  input: string | string[],
  name: string
): string => {
  if (Array.isArray(input) || typeof input !== 'string') {
    return ctx.throw(400, `Bad parameter. "${name}"`);
  }
  return input;
};

export const uniqueOptionalParam = (
  ctx: Application.ParameterizedContext<unknown>,
  input: string | string[],
  name: string
): string | undefined => {
  if (input) {
    return uniqueParam(ctx, input, name);
  }
  return undefined;
};

export const createUniqueKey = () =>
  `${Math.floor(Date.now() / 1000)}_${crypto.randomInt(9999999999).toString().padStart(10, '0')}`;
