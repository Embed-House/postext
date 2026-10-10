import { describe, expect, it } from 'bun:test';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { drawsSvgAtSize, loadSvgImage, sizeSvgImage } from '../svgImage';

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
