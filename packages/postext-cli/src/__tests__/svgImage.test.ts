import { describe, expect, it } from 'bun:test';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { drawsSvgAtSize, holdsRasterImage, loadSvgImage, sizeSvgImage } from '../svgImage';

// #678. Skia rasterises an SVG at load, at the size the SVG declares, and
// stretches that bitmap when it is drawn larger: a hairline becomes a grey
// smear. The CLI's SVG images are rasterised again at the size they are
// drawn at.

/** 100 × 50 px, a black hairline down the middle of a white ground. */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#fff"/><rect x="49.75" y="0" width="0.5" height="50" fill="#000"/></svg>';

/** The darkest value of the canvas's middle row: 0 where the hairline is
 *  drawn solid, grey where a stretched bitmap smears it. */
function darkest(canvas: Canvas): number {
  const { data } = canvas.getContext('2d').getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1);
  let min = 255;
  for (let i = 0; i < data.length; i += 4) min = Math.min(min, data[i]!);
  return min;
}

describe('SVG images on Skia', () => {
  it('a plain loadImage is a bitmap of the declared size, stretched when drawn larger', async () => {
    const image = await loadImage(Buffer.from(SVG));
    expect([image.width, image.height]).toEqual([100, 50]);
    const canvas = createCanvas(800, 400);
    canvas.getContext('2d').drawImage(image, 0, 0, 800, 400);
    // Half a pixel of black over a pixel of white, stretched ×8: grey.
    expect(darkest(canvas)).toBeGreaterThan(90);
  });

  it('is rasterised at the size it is drawn at', async () => {
    const image = await loadSvgImage(SVG);
    const canvas = drawsSvgAtSize(createCanvas(800, 400));
    canvas.getContext('2d').drawImage(image, 0, 0, 800, 400);
    expect([image.width, image.height]).toEqual([800, 400]);
    // The hairline is 4 px of solid black.
    expect(darkest(canvas)).toBeLessThan(8);
  });

  it('follows the scale of the context it is drawn on', async () => {
    const image = await loadSvgImage(SVG);
    const canvas = drawsSvgAtSize(createCanvas(600, 300));
    const ctx = canvas.getContext('2d');
    ctx.scale(3, 3);
    ctx.drawImage(image, 50, 25, 100, 50);
    expect([image.width, image.height]).toEqual([300, 150]);
  });

  it('only grows, in the proportions the SVG declares, up to a bound', async () => {
    const image = await loadSvgImage(SVG);
    sizeSvgImage(image, 400, 100);
    expect([image.width, image.height]).toEqual([400, 200]);
    sizeSvgImage(image, 200, 100);
    expect([image.width, image.height]).toEqual([400, 200]);
    sizeSvgImage(image, 1e6, 1e6);
    expect([image.width, image.height]).toEqual([8192, 4096]);
  });

  it('leaves any other image alone', async () => {
    const image = await loadImage(Buffer.from(SVG));
    sizeSvgImage(image, 800, 400);
    expect([image.width, image.height]).toEqual([100, 50]);
    const canvas = drawsSvgAtSize(createCanvas(800, 400));
    canvas.getContext('2d').drawImage(image, 0, 0, 800, 400);
    expect(image.width).toBe(100);
  });
});

// #771. Skia's SVG renderer draws no `<image>`: a raster given as a data
// URI came out transparent in the page images while the PDF and the
// Sandbox painted it. Such an SVG is rasterised by resvg.

/** A 4 × 4 PNG of one colour, as a data URI. */
async function pngUri(fill: string): Promise<string> {
  const canvas = createCanvas(4, 4);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 4, 4);
  return `data:image/png;base64,${(await canvas.encode('png')).toString('base64')}`;
}

/** The four SVGs of the issue: a raster by `href`, by `xlink:href`, in
 *  `<defs>` drawn by `<use>` (as `pdftocairo -svg` writes it), and a plain
 *  vector square. 60 × 60 px. */
async function variants(): Promise<Record<string, string>> {
  const red = await pngUri('#dc1e1e');
  const open = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="60" height="60" viewBox="0 0 60 60">';
  return {
    href: `${open}<image href="${red}" width="60" height="60"/></svg>`,
    xlink: `${open}<image xlink:href="${red}" width="60" height="60"/></svg>`,
    defsUse: `${open}<defs><image id="s" width="60" height="60" xlink:href="${red}"/></defs><use xlink:href="#s"/></svg>`,
    vector: `${open}<rect width="60" height="60" fill="#1e64dc"/></svg>`,
  };
}

function centre(canvas: Canvas): number[] {
  return [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
}

describe('SVG images holding a raster', () => {
  it('Skia alone leaves the raster out', async () => {
    const { href } = await variants();
    const canvas = createCanvas(60, 60);
    canvas.getContext('2d').drawImage(await loadImage(Buffer.from(href)), 0, 0, 60, 60);
    expect(centre(canvas)[3]).toBe(0);
  });

  it('are painted, by href, by xlink:href and through <defs> and <use>', async () => {
    for (const [name, svg] of Object.entries(await variants())) {
      const canvas = drawsSvgAtSize(createCanvas(60, 60));
      canvas.getContext('2d').drawImage(await loadSvgImage(svg), 0, 0, 60, 60);
      expect([name, ...centre(canvas)]).toEqual(name === 'vector' ? [name, 30, 100, 220, 255] : [name, 220, 30, 30, 255]);
    }
  });

  it('are told apart from the SVGs Skia draws whole', async () => {
    const v = await variants();
    expect([v.href, v.xlink, v.defsUse, v.vector].map(holdsRasterImage)).toEqual([true, true, true, false]);
    expect(holdsRasterImage('<svg><image href="red.png"/></svg>')).toBe(false);
  });

  it('keep the size the SVG declares and are rasterised again at the size they are drawn at', async () => {
    const svg = SVG.replace('<rect width="100" height="50" fill="#fff"/>', `<rect width="100" height="50" fill="#fff"/><image href="${await pngUri('#fff')}" width="1" height="1"/>`);
    expect(holdsRasterImage(svg)).toBe(true);
    const image = await loadSvgImage(svg);
    expect([image.width, image.height]).toEqual([100, 50]);
    const canvas = drawsSvgAtSize(createCanvas(800, 400));
    canvas.getContext('2d').drawImage(image, 0, 0, 800, 400);
    expect([image.width, image.height]).toEqual([100, 50]);
    // The hairline is 4 px of solid black, not a stretched smear.
    expect(darkest(canvas)).toBeLessThan(8);
  });

  it('keep a translucent area translucent when drawn larger', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="${await pngUri('#fff')}" width="1" height="1"/><rect width="20" height="20" fill="#dc1e1e" fill-opacity="0.5"/></svg>`;
    const canvas = drawsSvgAtSize(createCanvas(200, 200));
    canvas.getContext('2d').drawImage(await loadSvgImage(svg), 0, 0, 200, 200);
    const [r, g, b, a] = centre(canvas);
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(136);
    expect([Math.abs(r! - 220) <= 2, Math.abs(g! - 30) <= 2, Math.abs(b! - 30) <= 2]).toEqual([true, true, true]);
  });
});
