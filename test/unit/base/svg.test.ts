import fs from 'node:fs';

import sharp from 'sharp';
import { describe, expect, test } from 'vitest';

import { rasterShare, sanitizeSvg } from '../../../src/image/svg.js';

const unsafe = fs.readFileSync('test/data/unsafe.svg', 'utf8');

describe('sanitizeSvg', () => {
  const clean = sanitizeSvg(unsafe);

  test.each([
    ['scripts', '<script'],
    ['event handlers', 'onload'],
    ['event handlers', 'onclick'],
    ['javascript: links', 'javascript:'],
    ['external resources', 'evil.example'],
    ['CSS imports', '@import'],
    ['foreign objects', 'foreignObject'],
    ['animations', '<animate'],
    ['animations', '<set']
  ])('removes the %s (%s)', (_, text) => {
    expect(clean).not.toContain(text);
  });

  test.each([
    ['local references', 'fill="url(#g)"'],
    ['local references', 'xlink:href="#c"'],
    ['local style sheets', 'circle { fill: url(#g) }'],
    ['embedded images', 'data:image/png;base64,'],
    ['text', 'Hi &amp; bye']
  ])('keeps the %s (%s)', (_, text) => {
    expect(clean).toContain(text);
  });

  test('drops the elements it does not know with their content, as browsers do (Inkscape flowed text)', async () => {
    const original = fs.readFileSync('test/data/flowed-text.svg');
    const clean = sanitizeSvg(original.toString('utf8'));
    expect(clean).not.toContain('flowRoot');
    expect(clean).not.toContain('x="120"');
    const render = async (svg: Buffer): Promise<Buffer> =>
      sharp(svg, { density: 96 }).flatten({ background: 'white' }).raw().toBuffer();
    expect((await render(Buffer.from(clean))).equals(await render(original))).toBe(true);
  });

  test('keeps the drawing of a real SVG pixel for pixel', async () => {
    const original = fs.readFileSync('test/data/pipe_organ.svg');
    const render = async (svg: Buffer): Promise<Buffer> =>
      sharp(svg, { density: 96 }).flatten({ background: 'white' }).raw().toBuffer();
    expect((await render(Buffer.from(sanitizeSvg(original.toString('utf8'))))).equals(await render(original))).toBe(
      true
    );
  });

  test.each([
    [
      'external entities',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>'
    ],
    ['malformed XML', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ['another root', '<html xmlns="http://www.w3.org/1999/xhtml"><svg xmlns="http://www.w3.org/2000/svg"/></html>'],
    ['an svg without the SVG namespace', '<svg><script>alert(1)</script></svg>']
  ])('refuses %s', (_, svg) => {
    expect(() => sanitizeSvg(svg)).toThrow();
  });
});

describe('rasterShare', () => {
  test.each([
    ['a photo with a route drawn on it', 'route-on-photo.svg', 1],
    ['a drawing', 'pipe_organ.svg', 0]
  ])('%s: %s', (_, file, share) => {
    expect(rasterShare(fs.readFileSync(`test/data/${file}`, 'utf8'))).toBe(share);
  });

  test('a document without size', () => {
    expect(rasterShare('<svg xmlns="http://www.w3.org/2000/svg"><image width="10" height="10"/></svg>')).toBe(0);
  });
});
