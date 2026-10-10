/**
 * Device pixels per page pixel of a 2D context (#674).
 *
 * `renderPageToCanvas` paints a page of `scale` ≠ 1 by scaling the context,
 * and a turned block, a vertical page or a mirrored one adds its own
 * transform. Text and paths follow the transform on their own; a picture
 * rasterised into an offscreen bitmap (an SVG, a formula) does not: its
 * bitmap must be made at the size it shows at on the device, or the blit
 * resamples it.
 */

/** Device pixels per unit along the context's x and y axes. */
export interface DeviceScale {
  x: number;
  y: number;
}

const UNIT: DeviceScale = { x: 1, y: 1 };

/** The page rounded to whole device pixels stretches the context by a
 *  fraction of a pixel over its width (`paintContext`): not a scale to
 *  rasterise for. */
const SCALE_EPS = 1e-3;

/**
 * The scale of the context's current transform along each of its axes: the
 * length on the device of one unit of x and of one unit of y, so it holds
 * through a quarter turn and a mirror. 1 on a context without
 * `getTransform` (and for a degenerate transform).
 */
export function deviceScaleOf(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): DeviceScale {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
  if (!m) return UNIT;
  const x = Math.hypot(m.a, m.b);
  const y = Math.hypot(m.c, m.d);
  if (!(x > 0) || !(y > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return UNIT;
  return { x, y };
}

/**
 * The factor a vector picture's bitmap is enlarged by over its size in page
 * pixels: the context's scale above 1, and 1 at or below it. A page drawn
 * smaller than its own resolution keeps the bitmap of its page pixels, so
 * a host that repaints at several reductions (the Sandbox follows the
 * window) rasterises each picture once.
 */
export function rasterScaleOf(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): DeviceScale {
  const s = deviceScaleOf(ctx);
  const x = s.x > 1 + SCALE_EPS ? s.x : 1;
  const y = s.y > 1 + SCALE_EPS ? s.y : 1;
  return x === 1 && y === 1 ? UNIT : { x, y };
}
