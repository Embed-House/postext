// SVG pictures on Skia (#678). `loadImage` rasterises an SVG once, into a
// bitmap of the size the SVG declares (`width="86mm"` is 325 px), and
// `drawImage` stretches that bitmap to whatever size it is asked for: a
// figure placed larger than its SVG says came out soft. An SVG `Image`
// rasterises again when its width and height are set, so the pictures
// loaded here are given, before each draw, the size they are drawn at on
// the device.

import { loadImage, type Canvas, type Image } from '@napi-rs/canvas';

const svgImages = new WeakSet<object>();
/** Past this many pixels on a side the image stays as it is. */
const SVG_MAX_SIDE = 8192;

/** Decode an SVG, remembered as one: see {@link sizeSvgImage}. */
export async function loadSvgImage(svgText: string): Promise<Image> {
  const image = await loadImage(Buffer.from(svgText));
  svgImages.add(image);
  return image;
}

/** Give an image of {@link loadSvgImage} at least `width` × `height`
 *  pixels: Skia rasterises the SVG again at that size. It only ever grows
 *  (a later draw at a smaller size reduces the larger bitmap), keeps the
 *  proportions the SVG declares and stops at {@link SVG_MAX_SIDE}. Any
 *  other image is left alone. */
export function sizeSvgImage(image: unknown, width: number, height: number): void {
  if (typeof image !== 'object' || image === null || !svgImages.has(image)) return;
  const img = image as Image;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!(nw > 0) || !(nh > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const k = Math.min(Math.max(width / nw, height / nh), SVG_MAX_SIDE / Math.max(nw, nh));
  const w = Math.ceil(nw * k);
  const h = Math.ceil(nh * k);
  if (w <= img.width && h <= img.height) return;
  img.width = Math.max(w, img.width);
  img.height = Math.max(h, img.height);
}

type Draw = (...args: unknown[]) => void;
const patched = new WeakSet<object>();

/** Make the 2D context of `canvas` size the SVG images it draws
 *  ({@link sizeSvgImage}) to the box they are drawn into, in device pixels
 *  under the context's transform. Returns the canvas. */
export function drawsSvgAtSize<T extends Canvas>(canvas: T): T {
  const getContext = canvas.getContext.bind(canvas) as (...args: unknown[]) => unknown;
  (canvas as unknown as { getContext: (...args: unknown[]) => unknown }).getContext = (...args: unknown[]) => {
    const ctx = getContext(...args) as { drawImage: Draw; getTransform(): { a: number; b: number; c: number; d: number } } | null;
    if (!ctx || patched.has(ctx)) return ctx;
    patched.add(ctx);
    const drawImage = ctx.drawImage;
    ctx.drawImage = function (...draw: unknown[]): void {
      // drawImage(image, dx, dy, dw, dh): the form the engine draws a
      // registered picture with.
      if (draw.length === 5) {
        const m = ctx.getTransform();
        sizeSvgImage(draw[0], Math.abs(draw[3] as number) * Math.hypot(m.a, m.b), Math.abs(draw[4] as number) * Math.hypot(m.c, m.d));
      }
      drawImage.apply(ctx, draw);
    };
    return ctx;
  };
  return canvas;
}
