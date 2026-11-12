import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, test } from 'vitest';

import { checkEmbeddedImages, embeddedImagePixels, rasterShare, sanitizeSvg } from '../../../src/image/svg.js';
import { svgWithEmbeddedImage } from '../../helpers/image.js';

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
    ['JPEG', 'jpeg', 'jpeg'],
    ['PNG', 'png', 'png'],
    ['GIF', 'gif', 'gif'],
    ['WebP', 'webp', 'webp']
  ] as const)(
    'keeps the embedded %s images without a type (data:;base64), given their type',
    async (_, format, type) => {
      const data = (
        await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
          .toFormat(format)
          .toBuffer()
      ).toString('base64');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="2" height="2" xlink:href="data:;base64,${data}"/></svg>`;
      expect(sanitizeSvg(svg)).toContain(`xlink:href="data:image/${type};base64,${data}"`);
    }
  );

  test.each([
    ['not an image', 'data:;base64,PHN2Zy8+'],
    ['not base64', 'data:,hello']
  ])('removes the embedded data without a type, %s', (_, href) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="1" height="1" xlink:href="${href}"/></svg>`;
    expect(sanitizeSvg(svg)).not.toContain('data:');
  });

  test('renders a photo embedded without its type as before the sanitizing', async () => {
    const photo = (
      await sharp({ create: { width: 20, height: 10, channels: 3, background: 'blue' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
    const original = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="10"><image width="20" height="10" xlink:href="data:;base64,${photo}"/></svg>`
    );
    const render = async (svg: Buffer): Promise<Buffer> =>
      sharp(svg, { density: 96 }).flatten({ background: 'white' }).raw().toBuffer();
    const clean = Buffer.from(sanitizeSvg(original.toString('utf8')));
    expect((await render(clean)).equals(await render(original))).toBe(true);
    expect(
      (await sharp(await render(clean), { raw: { width: 20, height: 10, channels: 3 } }).stats()).channels[2]?.mean
    ).toBeGreaterThan(200);
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

describe('embeddedImagePixels', () => {
  const svg = (content: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${content}</svg>`;
  const png = async (width: number, height: number): Promise<string> =>
    (
      await sharp({ create: { width, height, channels: 3, background: '#000' } })
        .png()
        .toBuffer()
    ).toString('base64');

  test('none in a drawing', async () => {
    expect(await embeddedImagePixels(fs.readFileSync('test/data/pipe_organ.svg', 'utf8'))).toBe(0);
  });

  test('the photo under a route', async () => {
    expect(await embeddedImagePixels(fs.readFileSync('test/data/route-on-photo.svg', 'utf8'))).toBeGreaterThan(0);
  });

  test('all the images, from their size and not the size they are drawn at', async () => {
    const content = svg(
      `<image width="1" height="1" href="data:image/png;base64,${await png(300, 200)}"/>` +
        `<filter id="f"><feImage xlink:href="data:image/png;base64,${await png(10, 10)}"/></filter>`
    );
    expect(await embeddedImagePixels(content)).toBe(300 * 200 + 10 * 10);
  });

  test('the images of the embedded SVGs, base64 or URL-encoded', async () => {
    const inner = svg(`<image href="data:image/png;base64,${await png(30, 20)}"/>`);
    const content = svg(
      `<image href="data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}"/>` +
        `<image href="data:image/svg+xml,${encodeURIComponent(inner)}"/>`
    );
    expect(await embeddedImagePixels(content)).toBe(2 * 30 * 20);
  });

  test('SVGs nested too deep count as too large', async () => {
    let content = svg('');
    for (let i = 0; i < 6; i++) {
      content = svg(`<image href="data:image/svg+xml,${encodeURIComponent(content)}"/>`);
    }
    expect(await embeddedImagePixels(content)).toBe(Number.POSITIVE_INFINITY);
  });

  test('ignores the unreadable images and the local references', async () => {
    expect(await embeddedImagePixels(svg('<image href="data:image/png;base64,AAAA"/><image href="#a"/><image/>'))).toBe(
      0
    );
  });

  test('checkEmbeddedImages refuses the files over the limit', async () => {
    const file = path.join(os.tmpdir(), `embedded-${process.pid}.svg`);
    fs.writeFileSync(file, await svgWithEmbeddedImage(100, 50));
    try {
      await expect(checkEmbeddedImages(file, 5000)).resolves.toBeUndefined();
      await expect(checkEmbeddedImages(file, 4999)).rejects.toThrow('Image too large.');
    } finally {
      fs.rmSync(file);
    }
  });
});
