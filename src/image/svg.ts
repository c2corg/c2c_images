import fs from 'node:fs';

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Uploaded SVG are published as they are, on the media domain: only static drawings are kept. Scripts, event handlers,
// animations, foreign objects and the references to anything outside the file (links, external images, CSS imports and
// urls) are removed; local references (#id) and embedded raster images (data:image/...) stay.

const purify = createDOMPurify(new JSDOM('').window);

// url(...) pointing outside the document, in an attribute or a style sheet. Local references may be quoted and spaced:
// url('#a') and url( "#a" ) are local too
const externalUrl = /url\((?![\s'"]*#)/i;
// image/jpg: not a registered type, but written by some editors, and shown by browsers. image/svg+xml: an SVG
// referenced by <image> is rendered as an image, without scripts or external resources (logos in some topos)
const allowedHref = /^(#|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'style') {
    const css = node.textContent ?? '';
    if (/@import/i.test(css) || externalUrl.test(css)) {
      node.parentNode?.removeChild(node);
    }
  }
});

purify.addHook('uponSanitizeAttribute', (_node, data) => {
  const value = data.attrValue.trim();
  if (data.attrName === 'href' || data.attrName === 'xlink:href') {
    data.keepAttr = allowedHref.test(value);
  } else if (externalUrl.test(value)) {
    data.keepAttr = false;
  }
});

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Sanitizes an SVG document. Throws when it is not well-formed XML with an svg root (external entities included).
 */
export const sanitizeSvg = (svg: string): string => {
  const { window } = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const root = window.document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) {
    throw new Error('Not an SVG document');
  }
  // An element removed goes with its content, as browsers render nothing inside an SVG element they do not know: kept,
  // the <rect> of the text area of Inkscape's flowed text (<flowRoot>, SVG 1.2 draft) became a visible box.
  purify.sanitize(root, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    IN_PLACE: true,
    KEEP_CONTENT: false
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new window.XMLSerializer().serializeToString(root)}\n`;
};

/**
 * The share of the drawing covered by embedded raster images (<image>), from 0 to 1: a photo with a route drawn on it
 * is close to 1, a drawing close to 0. From the width and height of the images against the viewBox (or the size) of
 * the document; transforms are not taken into account.
 */
export const rasterShare = (svg: string): number => {
  const root = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document.documentElement;
  const number = (value: string | null): number => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const [width, height] =
    viewBox.length === 4
      ? [viewBox[2] ?? 0, viewBox[3] ?? 0]
      : [number(root.getAttribute('width')), number(root.getAttribute('height'))];
  if (!width || !height) {
    return 0;
  }
  let area = 0;
  for (const image of root.getElementsByTagName('image')) {
    area += number(image.getAttribute('width')) * number(image.getAttribute('height'));
  }
  return Math.min(1, area / (width * height));
};

export const isDrawing = async (file: string): Promise<boolean> =>
  rasterShare(await fs.promises.readFile(file, 'utf8')) < 0.5;

export const sanitizeSvgFile = async (file: string): Promise<void> => {
  const svg = await fs.promises.readFile(file, 'utf8');
  await fs.promises.writeFile(file, sanitizeSvg(svg));
};
