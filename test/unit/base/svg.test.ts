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

  test.each([
    ['quoted local references', '<rect fill="url(\'#g\')"/>', `fill="url('#g')"`],
    ['double-quoted local references', '<rect style=\'fill: url("#g")\'/>', 'fill: url(&quot;#g&quot;)'],
    ['spaced local references', '<rect fill="url( #g )"/>', 'fill="url( #g )"'],
    [
      'style sheets with quoted local references',
      '<style>rect { fill: url("#g") }</style>',
      'rect { fill: url("#g") }'
    ],
    [
      'embedded image/jpg images',
      '<image width="1" height="1" xlink:href="data:image/jpg;base64,AAAA"/>',
      'data:image/jpg;base64,AAAA'
    ],
    [
      'embedded SVG images',
      '<image width="1" height="1" xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/>',
      'data:image/svg+xml;base64,PHN2Zy8+'
    ]
  ])('keeps the %s', (_, element, text) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${element}</svg>`;
    expect(sanitizeSvg(svg)).toContain(text);
  });

  test.each([
    ['quoted', `<rect fill="url('https://evil.example/a.svg#g')"/>`],
    ['spaced', '<rect fill="url( https://evil.example/a.svg#g )"/>'],
    ['in a style sheet', '<style>rect { fill: url("#g") } circle { fill: url(https://evil.example/a.svg#g) }</style>']
  ])('removes the external references, %s', (_, element) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${element}</svg>`;
    expect(sanitizeSvg(svg)).not.toContain('evil.example');
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

  test('keeps the SVG elements written with a prefix (svg:svg), without it', () => {
    const clean = sanitizeSvg(
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="10" height="10"><svg:rect fill="url(#g)" width="5" height="5"/><svg:script>alert(1)</svg:script></svg:svg>'
    );
    expect(clean).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="url(#g)"');
    expect(clean).not.toContain('script');
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
