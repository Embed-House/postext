/**
 * Contour wrap (#883): the shape of a picture that text runs round.
 *
 * A shape is a polygon (`Resource.contour.points`) or a bitmap's alpha
 * channel. The layout never decodes pictures (it knows their sizes only),
 * so the alpha channel is traced by the host that holds the file
 * ({@link traceResourceContour}: the bundle reader, the Sandbox) and comes
 * with the resource as `contour.traced`, rows of the picture with the
 * extent of their opaque pixels. Both kinds come to the same thing here:
 * rows of the picture, each with its leftmost and rightmost edge, in
 * fractions of the picture ({@link contourRowsOf}). The layout maps those
 * onto the page where the picture is set, through its crop and scale
 * ({@link contourOnPage}), and every line beside it is set short by the
 * shape's width at its height ({@link contourInsetSteps}).
 */
import type { ContourTrace, Resource, ResourceContour } from '../types';
import type { BoundingBox, ResolvedResourceBlock, VDTContourSpan, VDTExclusionContour } from '../vdt';
import type { LineInsetStep } from '../measure/types';
import { decodePngAlpha, isPng, type AlphaRaster } from './png';

export { decodePngAlpha, isPng, type AlphaRaster } from './png';

/** `ResourceContour.threshold` when unset. */
export const DEFAULT_CONTOUR_THRESHOLD = 0.5;
/** The most rows a picture is cut into. */
export const MAX_CONTOUR_ROWS = 256;

/** The shape of a picture in rows: per row, the leftmost and rightmost
 *  edge of the shape in fractions of its width (`-1` both for a row the
 *  shape does not reach). */
export interface ContourRows {
  rows: number;
  spans: readonly number[];
}

/** The threshold a contour reads its alpha channel at, 0 to 1. */
export function contourThreshold(contour: ResourceContour | undefined): number {
  const t = contour?.threshold;
  return typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : DEFAULT_CONTOUR_THRESHOLD;
}

/** Whether the contour's polygon can be used: three points or more, all
 *  finite. */
export function contourPolygon(contour: ResourceContour | undefined): { x: number; y: number }[] | undefined {
  const pts = contour?.points;
  if (!Array.isArray(pts) || pts.length < 3) return undefined;
  return pts.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : undefined;
}

/** Whether a resource's shape is read from its alpha channel: a bitmap
 *  with no polygon whose contour does not turn the alpha channel off. */
export function contourWantsAlpha(resource: Resource): boolean {
  return resource.kind === 'bitmap' && !contourPolygon(resource.contour) && resource.contour?.alpha !== false;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Trace an alpha raster at `threshold` (0 to 1): the picture is cut into
 * at most {@link MAX_CONTOUR_ROWS} rows, and each row keeps the leftmost
 * and rightmost edge of the pixels at least that opaque.
 */
export function traceAlpha(raster: AlphaRaster, threshold: number, fileId: string): ContourTrace {
  const { width, height, alpha } = raster;
  const rows = Math.max(1, Math.min(height, MAX_CONTOUR_ROWS));
  // A pixel belongs to the shape from this opacity on (at least 1: a fully
  // transparent pixel never does).
  const min = Math.max(1, Math.ceil(threshold * 255));
  const spans: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    let lo = width;
    let hi = -1;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = 0; x < lo; x++) {
        if (alpha[row + x]! >= min) { lo = x; break; }
      }
      for (let x = width - 1; x > hi; x--) {
        if (alpha[row + x]! >= min) { hi = x; break; }
      }
    }
    if (hi < lo) spans.push(-1, -1);
    else spans.push(round4(lo / width), round4((hi + 1) / width));
  }
  return { fileId, threshold, rows, spans };
}

/** RGBA pixels as a canvas gives them (`ImageData`). */
export interface RgbaPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** The alpha raster of RGBA pixels; `null` when every pixel is opaque. */
export function alphaOfRgba(pixels: RgbaPixels): AlphaRaster | null {
  const { width, height, data } = pixels;
  const alpha = new Uint8Array(width * height);
  let any = false;
  for (let i = 0; i < alpha.length; i++) {
    const a = data[i * 4 + 3]!;
    alpha[i] = a;
    if (a < 255) any = true;
  }
  return any ? { width, height, alpha } : null;
}

export interface TraceContourOptions {
  /** Decode a picture the engine does not read itself (a WebP, a GIF) to
   *  RGBA pixels. Default: `createImageBitmap` and an `OffscreenCanvas`,
   *  where the host has them (a browser, a worker). */
  decode?: (bytes: Uint8Array, mime: string) => Promise<RgbaPixels | undefined> | RgbaPixels | undefined;
}

/** The pixel rows the browser decoder reads at most (a large picture is
 *  traced from a smaller copy: rows are cut at 256 anyway). */
const DECODE_MAX = 1024;

async function decodeInBrowser(bytes: Uint8Array, mime: string): Promise<RgbaPixels | undefined> {
  const g = globalThis as {
    createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
    OffscreenCanvas?: new (w: number, h: number) => { getContext(k: '2d'): { drawImage(...a: unknown[]): void; getImageData(x: number, y: number, w: number, h: number): RgbaPixels } | null };
  };
  if (!g.createImageBitmap || !g.OffscreenCanvas || typeof Blob === 'undefined') return undefined;
  try {
    const bitmap = await g.createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const scale = Math.min(1, DECODE_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = new g.OffscreenCanvas(w, h).getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return undefined;
  }
}

/**
 * Trace the alpha channel of a bitmap resource from its file's bytes, for
 * `contour.traced` (#883). A PNG is read here, in any host; another format
 * goes through `options.decode` (by default the browser's decoder, where
 * there is one). `null`: the picture has no transparency (a JPEG, an
 * opaque PNG): it has no shape and runs round its box. `undefined`: the
 * resource asks for no alpha contour, or the file cannot be read here.
 */
export async function traceResourceContour(
  resource: Resource,
  bytes: ArrayBuffer | Uint8Array,
  mime: string,
  options: TraceContourOptions = {},
): Promise<ContourTrace | null | undefined> {
  if (!contourWantsAlpha(resource) || !resource.bitmap) return undefined;
  const fileId = resource.bitmap.fileId;
  const threshold = contourThreshold(resource.contour);
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isPng(u8)) {
    const raster = decodePngAlpha(u8);
    if (raster) return traceAlpha(raster, threshold, fileId);
    if (raster === null) return null;
  }
  if (/jpe?g/i.test(mime)) return null;
  const pixels = await (options.decode ?? decodeInBrowser)(u8, mime);
  if (!pixels) return undefined;
  const raster = alphaOfRgba(pixels);
  return raster ? traceAlpha(raster, threshold, fileId) : null;
}

/** The resource with `contour.traced` set to `trace` (or cleared). */
export function withContourTrace(resource: Resource, trace: ContourTrace | null | undefined): Resource {
  const { traced: _old, ...rest } = resource.contour ?? {};
  void _old;
  return { ...resource, contour: trace ? { ...rest, traced: trace } : rest };
}

/** Whether a trace was made from the resource's file at its threshold. */
function traceFits(resource: Resource, trace: ContourTrace | undefined): trace is ContourTrace {
  if (!trace || !resource.bitmap || trace.fileId !== resource.bitmap.fileId) return false;
  if (Math.abs(trace.threshold - contourThreshold(resource.contour)) > 1e-6) return false;
  return Number.isInteger(trace.rows) && trace.rows > 0 && Array.isArray(trace.spans) && trace.spans.length === trace.rows * 2;
}

const polygonCache = new WeakMap<readonly { x: number; y: number }[], ContourRows>();

/** A polygon (fractions of the picture) as rows: per row the extent of the
 *  polygon's intersection with it. */
export function polygonRows(points: readonly { x: number; y: number }[], rows = MAX_CONTOUR_ROWS): ContourRows {
  const cached = rows === MAX_CONTOUR_ROWS ? polygonCache.get(points) : undefined;
  if (cached) return cached;
  const spans: number[] = [];
  const n = points.length;
  for (let r = 0; r < rows; r++) {
    const y0 = r / rows;
    const y1 = (r + 1) / rows;
    let lo = Infinity;
    let hi = -Infinity;
    // The band's intersection with the polygon is bounded across by the
    // edges clipped to the band (a vertex inside it included).
    for (let i = 0; i < n; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y, b.y);
      if (bottom < y0 || top > y1) continue;
      const xs: number[] = [];
      if (Math.abs(b.y - a.y) < 1e-12) {
        xs.push(a.x, b.x);
      } else {
        const at = (y: number): number => a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
        xs.push(at(Math.max(top, y0)), at(Math.min(bottom, y1)));
      }
      for (const x of xs) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (hi < lo) spans.push(-1, -1);
    else spans.push(round4(Math.max(0, Math.min(1, lo))), round4(Math.max(0, Math.min(1, hi))));
  }
  const out = { rows, spans };
  if (rows === MAX_CONTOUR_ROWS) polygonCache.set(points, out);
  return out;
}

/**
 * The shape of a resource in rows, when it has one: its polygon, else the
 * alpha channel its host traced (a trace of this file at this threshold).
 * `undefined`: no shape is known (an SVG with no polygon, a bitmap whose
 * alpha channel was not traced, or has no transparency).
 */
export function contourRowsOf(resource: Resource): ContourRows | undefined {
  const poly = contourPolygon(resource.contour);
  if (poly) return polygonRows(poly);
  if (!contourWantsAlpha(resource)) return undefined;
  const trace = resource.contour?.traced;
  return traceFits(resource, trace) ? trace : undefined;
}

export interface ContourOnPageOptions {
  /** The margin kept round the shape (px). */
  margin: number;
  /** The page lays its flow out mirrored (a right-to-left page): the
   *  picture is painted unturned at a mirrored place, so its shape turns
   *  in the flow's coordinates. */
  mirrored?: boolean;
  /** `VDTExclusionContour.quantum`. */
  quantum?: number;
  /** Where the figure's block stands on the page: `rb.bodyRect` is
   *  relative to it. Default (0, 0). */
  originX?: number;
  originY?: number;
}

/**
 * The shape of a picture set on the page as `rb` (its body at
 * `rb.bodyRect` from the block's origin, showing `rb.bodySource` of the
 * picture: the crop within its safe area), in page px: the shape's rows
 * inside the crop, scaled to the body; and `box` (page px), the rest of
 * the figure (its caption and note under the picture) as bands of its own
 * width. `undefined` when the resource
 * has no known shape.
 */
export function contourOnPage(
  resource: Resource,
  rb: Pick<ResolvedResourceBlock, 'bodyRect' | 'bodySource'>,
  box: BoundingBox | undefined,
  options: ContourOnPageOptions,
): VDTExclusionContour | undefined {
  const shape = contourRowsOf(resource);
  if (!shape) return undefined;
  const body = { x: rb.bodyRect.x + (options.originX ?? 0), y: rb.bodyRect.y + (options.originY ?? 0), width: rb.bodyRect.width, height: rb.bodyRect.height };
  if (!(body.width > 0) || !(body.height > 0)) return undefined;
  const crop = rb.bodySource ?? { x: 0, y: 0, width: 1, height: 1 };
  if (!(crop.width > 0) || !(crop.height > 0)) return undefined;
  const spans: VDTContourSpan[] = [];
  const push = (s: VDTContourSpan): void => {
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.left - s.left) < 0.01 && Math.abs(last.right - s.right) < 0.01 && Math.abs(last.y + last.height - s.y) < 0.01) {
      last.height = s.y + s.height - last.y;
    } else {
      spans.push(s);
    }
  };
  const cropRight = crop.x + crop.width;
  const cropBottom = crop.y + crop.height;
  for (let r = 0; r < shape.rows; r++) {
    const l = shape.spans[r * 2]!;
    const rr = shape.spans[r * 2 + 1]!;
    if (l < 0 || rr < 0) continue;
    const sy0 = Math.max(crop.y, r / shape.rows);
    const sy1 = Math.min(cropBottom, (r + 1) / shape.rows);
    if (sy1 <= sy0) continue;
    const sl = Math.max(crop.x, l);
    const sr = Math.min(cropRight, rr);
    if (sr <= sl) continue;
    let u0 = (sl - crop.x) / crop.width;
    let u1 = (sr - crop.x) / crop.width;
    if (options.mirrored) [u0, u1] = [1 - u1, 1 - u0];
    const y = body.y + ((sy0 - crop.y) / crop.height) * body.height;
    const yEnd = body.y + ((sy1 - crop.y) / crop.height) * body.height;
    push({ y, height: yEnd - y, left: body.x + u0 * body.width, right: body.x + u1 * body.width });
  }
  if (box) {
    // The caption and note keep their box: the figure's width, above or
    // under the picture.
    const bx = box.x;
    const by = box.y;
    const bottom = by + box.height;
    if (body.y > by + 0.5) spans.unshift({ y: by, height: body.y - by, left: bx, right: bx + box.width });
    const bodyBottom = body.y + body.height;
    if (bottom > bodyBottom + 0.5) push({ y: bodyBottom, height: bottom - bodyBottom, left: bx, right: bx + box.width });
  }
  return { spans, margin: Math.max(0, options.margin), ...(options.quantum && options.quantum > 0 ? { quantum: options.quantum } : {}) };
}

/** A contour moved by `(dx, dy)`. */
export function shiftContour(c: VDTExclusionContour, dx: number, dy: number): VDTExclusionContour {
  return { ...c, spans: c.spans.map((s) => ({ y: s.y + dy, height: s.height, left: s.left + dx, right: s.right + dx })) };
}

/** A contour scaled by `s` about `(ox, oy)`: a frame's content laid out
 *  at another scale than it is painted (#858). `margin: false` keeps the
 *  margin (and the CJK quantum) as they are: they are page px already. */
export function scaleContourAbout(c: VDTExclusionContour, ox: number, oy: number, s: number, margin = true): VDTExclusionContour {
  return {
    spans: c.spans.map((sp) => ({ y: oy + (sp.y - oy) * s, height: sp.height * s, left: ox + (sp.left - ox) * s, right: ox + (sp.right - ox) * s })),
    margin: margin ? c.margin * s : c.margin,
    ...(c.quantum !== undefined ? { quantum: margin ? c.quantum * s : c.quantum } : {}),
  };
}

/** The contour's bounds, its margin included. */
export function contourBounds(c: VDTExclusionContour): BoundingBox | undefined {
  if (c.spans.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of c.spans) {
    x0 = Math.min(x0, s.left);
    x1 = Math.max(x1, s.right);
    y0 = Math.min(y0, s.y);
    y1 = Math.max(y1, s.y + s.height);
  }
  const m = c.margin;
  return { x: x0 - m, y: y0 - m, width: x1 - x0 + 2 * m, height: y1 - y0 + 2 * m };
}

/** The shape's extent across the band `[top, bottom]` of the page: the
 *  spans that lie within its margin of it. `undefined`: the band passes
 *  clear of the shape. */
export function contourExtent(c: VDTExclusionContour, top: number, bottom: number): { left: number; right: number } | undefined {
  let left = Infinity;
  let right = -Infinity;
  const m = c.margin;
  for (const s of c.spans) {
    if (s.y + s.height <= top - m + 0.01 || s.y >= bottom + m - 0.01) continue;
    if (s.left < left) left = s.left;
    if (s.right > right) right = s.right;
  }
  return right > left ? { left: left - m, right: right + m } : undefined;
}

/**
 * The insets of lines `from` to `to` (0-based, of a text whose line 0's
 * top is at `y0`, lines `lineHeight` apart) beside a shape at `side` of a
 * measure `[x, x + width]`: each line is set short by the room the shape
 * takes across its band (its margin included), none where it passes clear
 * of it. Line numbers in the steps count from `firstLine`.
 */
export function contourInsetSteps(
  c: VDTExclusionContour,
  side: 'left' | 'right',
  x: number,
  width: number,
  y0: number,
  lineHeight: number,
  from: number,
  to: number,
  firstLine = 0,
): LineInsetStep[] {
  const steps: LineInsetStep[] = [];
  const right = x + width;
  for (let li = from; li <= to; li++) {
    const top = y0 + li * lineHeight;
    const ext = contourExtent(c, top, top + lineHeight);
    let inset = 0;
    if (ext) inset = side === 'left' ? ext.right - x : right - ext.left;
    inset = Math.max(0, Math.min(width, inset));
    if (c.quantum && inset > 0) inset = Math.min(width, Math.ceil((inset - 0.01) / c.quantum) * c.quantum);
    if (inset <= 0.01) continue;
    const last = steps[steps.length - 1];
    const startInsetPx = side === 'left' ? inset : 0;
    const endInsetPx = side === 'right' ? inset : 0;
    if (last && last.toLine === firstLine + li - 1 && Math.abs(last.startInsetPx - startInsetPx) < 0.01 && Math.abs(last.endInsetPx - endInsetPx) < 0.01) {
      last.toLine = firstLine + li;
    } else {
      steps.push({ fromLine: firstLine + li, toLine: firstLine + li, startInsetPx, endInsetPx });
    }
  }
  return steps;
}
