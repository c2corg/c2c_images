import { describe, expect, test } from 'vitest';

import { app } from '../../../src/http/app.js';

// HAProxy, on the private network, sends the address of the client in X-Forwarded-For
describe('trust proxy', () => {
  test('trusts X-Forwarded-For from the private networks only', () => {
    const trust = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('172.18.0.2', 0)).toBe(true);
    expect(trust('10.0.0.3', 0)).toBe(true);
    expect(trust('203.0.113.7', 0)).toBe(false);
  });
});
