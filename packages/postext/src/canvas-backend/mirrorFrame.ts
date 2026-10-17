/**
 * Painting the flow of a right-to-left page on the canvas
 * (`VDTMirroredFlowFrame`).
 *
 * The flow is laid out as a left-to-right page and turned over the sheet's
 * vertical axis: the page paints it through `transform(-1, 0, 0, 1, W, 0)`,
 * so columns, rules, frames, backgrounds and every position land mirrored,
 * as the layout means them. Text and pictures must not read mirrored:
 * while the frame is on, the context's `fillText`, `strokeText` and
 * `drawImage` turn what they paint back about its own box (the run's
 * advance from where its alignment puts it, the image's destination
 * rect), so a glyph run lands where the mirrored layout puts its box and
 * reads as written. Every painter of the flow (lines, bullets, chips,
 * ruby, captions, table cells, callout icons, figures) goes through these
 * three calls, so none of them needs to know about the frame; a run the
 * painter sets right to left (`ctx.direction = 'rtl'`) is turned about the
 * box its direction and alignment give it, and shapes as it would on a
 * left-to-right page. A formula drawn as paths rather than a bitmap asks
 * {@link counterFlipBox} itself, and a word painted with several
 * `fillText`s (a tracked word in pieces, #663) asks {@link paintAsOneRun}:
 * turned piece by piece, its pieces would stand in the mirror's order
 * ("five" as "vefi", #685).
 *
 * The interception is an own property on the context instance, set for
 * the flow pass and removed after it: running heads, folios and crop marks
 * paint on the sheet untouched.
 */

import { restoreContext, saveContext } from './contextState';

/** Whether the flow of a mirrored page is being painted (see the module
 *  comment). */
let active = 0;

export function mirroredPaintActive(): boolean {
  return active > 0;
}

/** Whether a run painted in several calls is being painted (see
 *  {@link paintAsOneRun}): the frame turned the whole of it back, so the
 *  calls inside paint as on a left-to-right page. */
let whole = 0;

type Patched = 'fillText' | 'strokeText' | 'drawImage';
const PATCHED: readonly Patched[] = ['fillText', 'strokeText', 'drawImage'];

/** Left edge and width of the run `text` painted at `x` with the context's
 *  alignment and direction. */
function runBox(ctx: CanvasRenderingContext2D, text: string, x: number, maxWidth?: number): { left: number; width: number } {
  let width = ctx.measureText(text).width;
  if (maxWidth !== undefined && maxWidth < width) width = Math.max(0, maxWidth);
  const rtl = 'direction' in ctx && ctx.direction === 'rtl';
  const align = ctx.textAlign;
  const fromRight = align === 'right' || (align === 'start' && rtl) || (align === 'end' && !rtl);
  const left = align === 'center' ? x - width / 2 : fromRight ? x - width : x;
  return { left, width };
}

/** Turn what `paint` draws back about the horizontal extent
 *  `[left, left + width]`, inside a mirrored frame: the box stays where
 *  the layout put it and its content reads unmirrored. Outside a mirrored
 *  frame it just paints. */
export function counterFlipBox(ctx: CanvasRenderingContext2D, left: number, width: number, paint: () => void): void {
  if (!mirroredPaintActive()) {
    paint();
    return;
  }
  saveContext(ctx);
  ctx.translate(2 * left + width, 0);
  ctx.scale(-1, 1);
  try {
    paint();
  } finally {
    restoreContext(ctx);
  }
}

/**
 * Paint, with `paint`, a run made of several `fillText`s (the pieces of a
 * word) whose box is `[left, left + width]`: inside a mirrored frame the
 * run is turned back once, about that box, and each call of `paint` lands
 * as on a left-to-right page, so the pieces keep their reading order and
 * their places in the run. Turned one by one, each about its own box, they
 * would stand where the mirror puts them: the first at the right end.
 * Outside a mirrored frame it just paints.
 */
export function paintAsOneRun(ctx: CanvasRenderingContext2D, left: number, width: number, paint: () => void): void {
  if (!mirroredPaintActive() || whole > 0) {
    paint();
    return;
  }
  whole++;
  try {
    counterFlipBox(ctx, left, width, paint);
  } finally {
    whole--;
  }
}

/** Width of an image source as `drawImage` with no size takes it. */
function sourceWidth(image: CanvasImageSource): number {
  const s = image as { displayWidth?: number; naturalWidth?: number; width?: number | { baseVal?: { value: number } } };
  if (typeof s.displayWidth === 'number') return s.displayWidth;
  if (typeof s.naturalWidth === 'number' && s.naturalWidth > 0) return s.naturalWidth;
  if (typeof s.width === 'number') return s.width;
  return s.width?.baseVal?.value ?? 0;
}

/**
 * Paint, with `paint`, content that must land on the sheet as a
 * left-to-right page would put it, inside a mirrored frame (#955): the
 * frame is reflected back about the vertical axis of the box
 * `[left, left + width]` (so the box keeps its place on the sheet while
 * what stands in it reads from its other side) and the text and pictures
 * are no longer turned back, since nothing is mirrored any more. A vertical
 * label does it: its cells cannot be turned back run by run, as the line of
 * a horizontal label's. Outside a mirrored frame it just paints.
 */
export function paintUnmirrored(ctx: CanvasRenderingContext2D, left: number, width: number, paint: () => void): void {
  if (!mirroredPaintActive()) {
    paint();
    return;
  }
  saveContext(ctx);
  ctx.transform(-1, 0, 0, 1, 2 * left + width, 0);
  active--;
  whole++;
  try {
    paint();
  } finally {
    whole--;
    active++;
    restoreContext(ctx);
  }
}

/**
 * Begin painting the flow of a page mirrored about `originX` (its
 * `flow.mirror.originX`): saves the context, applies the frame and turns
 * text runs and images back (see the module comment). Returns the
 * function that ends it, restoring the context.
 */
export function beginMirroredFlow(ctx: CanvasRenderingContext2D, originX: number): () => void {
  saveContext(ctx);
  ctx.transform(-1, 0, 0, 1, originX, 0);
  const own = new Map<Patched, PropertyDescriptor | undefined>();
  for (const name of PATCHED) own.set(name, Object.getOwnPropertyDescriptor(ctx, name));
  const fillText = ctx.fillText;
  const strokeText = ctx.strokeText;
  const drawImage = ctx.drawImage as (...args: unknown[]) => void;
  const target = ctx as unknown as Record<Patched, unknown>;
  target.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
    const put = (): void => {
      if (maxWidth === undefined) fillText.call(ctx, text, x, y);
      else fillText.call(ctx, text, x, y, maxWidth);
    };
    // A piece of a run already turned back (`paintAsOneRun`).
    if (whole > 0) {
      put();
      return;
    }
    const { left, width } = runBox(ctx, text, x, maxWidth);
    counterFlipBox(ctx, left, width, put);
  };
  target.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
    const put = (): void => {
      if (maxWidth === undefined) strokeText.call(ctx, text, x, y);
      else strokeText.call(ctx, text, x, y, maxWidth);
    };
    if (whole > 0) {
      put();
      return;
    }
    const { left, width } = runBox(ctx, text, x, maxWidth);
    counterFlipBox(ctx, left, width, put);
  };
  target.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]): void {
    if (whole > 0) {
      drawImage.apply(ctx, args);
      return;
    }
    const image = args[0] as CanvasImageSource;
    // drawImage(image, dx, dy[, dw, dh]) or (image, sx, sy, sw, sh, dx, dy, dw, dh).
    const dx = (args.length >= 9 ? args[5] : args[1]) as number;
    const dw = (args.length >= 9 ? args[7] : args.length >= 5 ? args[3] : sourceWidth(image)) as number;
    const left = Math.min(dx, dx + dw);
    counterFlipBox(ctx, left, Math.abs(dw), () => drawImage.apply(ctx, args));
  };
  active++;
  return () => {
    active--;
    for (const name of PATCHED) {
      const d = own.get(name);
      if (d) Object.defineProperty(ctx, name, d);
      else delete target[name];
    }
    restoreContext(ctx);
  };
}
