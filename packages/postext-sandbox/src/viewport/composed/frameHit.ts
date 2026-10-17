/**
 * What lies under the pointer on a composed page (#864, #863): the frames
 * of `page.composed`, in sheet px, the one painted on top first.
 *
 * Shared by the Content mode (a click on a frame moves the editor to its
 * slot) and the page-template editor (a drag moves or resizes a frame in
 * Design mode). Pure: sheet px, no DOM.
 */

import { flowRectToPage, frameClips, frameContentRect, frameMatrix, frameOfBlock, pageComics, pageToFlow, pointInPolygon, type VDTComicPage, type VDTComposedPage, type VDTFrame, type VDTPage } from 'postext';

/** Anything that may carry a composed page (a `VDTPage`, or a stand-in in a
 *  test). */
export type ComposedPageLike = Pick<VDTPage, 'composed'> | { composed?: VDTComposedPage };

export interface FramePoint {
  x: number;
  y: number;
}

/** The centre of a frame's box (the pivot of its turn). */
export function frameCentre(frame: Pick<VDTFrame, 'rect'>): FramePoint {
  const r = frame.rect;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** A sheet point in the frame's own upright box: the point turned back
 *  about the frame's centre by its `rotate`. */
export function toFrameSpace(frame: Pick<VDTFrame, 'rect' | 'rotate'>, x: number, y: number): FramePoint {
  if (!frame.rotate) return { x, y };
  const c = frameCentre(frame);
  const a = (-frame.rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = x - c.x;
  const dy = y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The four corners of a frame's box on the sheet, turned (top-left,
 *  top-right, bottom-right, bottom-left of the upright box). */
export function frameCorners(frame: Pick<VDTFrame, 'rect' | 'rotate'>): FramePoint[] {
  const r = frame.rect;
  const pts: FramePoint[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  if (!frame.rotate) return pts;
  const c = frameCentre(frame);
  const a = (frame.rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }));
}

/** Whether a sheet point lies in a frame's (turned) box, `pad` sheet px
 *  round it included. */
export function pointInFrame(frame: Pick<VDTFrame, 'rect' | 'rotate'>, x: number, y: number, pad = 0): boolean {
  const p = toFrameSpace(frame, x, y);
  const r = frame.rect;
  return p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;
}

/** A page's frames in hit order: the one painted last first (higher
 *  `layer`, then later in template order). Empty off a composed page. */
export function framesTopFirst(page: ComposedPageLike | null | undefined): VDTFrame[] {
  const frames = page?.composed?.frames ?? [];
  return frames
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.layer - a.f.layer || b.i - a.i)
    .map(({ f }) => f);
}

/** The frame under the sheet point `(x, y)` of `page`, the one on top
 *  first; null off every frame or off a composed page. */
export function frameHitAt(page: ComposedPageLike | null | undefined, x: number, y: number): VDTFrame | null {
  for (const f of framesTopFirst(page)) {
    if (pointInFrame(f, x, y)) return f;
  }
  return null;
}

/** A sheet point in the frame of `page`'s flow, where a composed page's
 *  frames are laid (#929): mirrored on a right-to-left page, turned on a
 *  vertical one, the point itself elsewhere. */
export function sheetToFlow(page: Pick<VDTPage, 'flow'> | null | undefined, x: number, y: number): FramePoint {
  return page?.flow ? pageToFlow(page, x, y) : { x, y };
}

/** A box of `page`'s flow frame (a frame's, turned by `rotate` about its
 *  centre) as the sheet shows it: the box mapped, and the turn reversed by
 *  a right-to-left page's mirror (a vertical page's quarter turn keeps it). */
export function flowBoxOnSheet(
  page: Pick<VDTPage, 'flow'> | null | undefined,
  rect: { x: number; y: number; width: number; height: number },
  rotate = 0,
): { rect: { x: number; y: number; width: number; height: number }; rotate: number } {
  if (!page?.flow) return { rect: { ...rect }, rotate };
  const mirrored = page.flow.writingMode === 'horizontal-tb';
  return { rect: flowRectToPage(page, rect), rotate: rotate && mirrored ? -rotate : rotate };
}

/** Anything that may carry a comic page or strips (a `VDTPage`, or a
 *  stand-in with only its `comic`). */
export type ComicPageLike = Pick<VDTPage, 'comic'> & Partial<Pick<VDTPage, 'columns' | 'floats' | 'flow'>>;

/** Whether a sheet point lies in a frame a comic's split generated
 *  (#885): in its outline when a slanted line cut it, else in its box. */
export function pointInComicFrame(frame: Pick<VDTFrame, 'rect' | 'polygon'>, x: number, y: number): boolean {
  const r = frame.rect;
  if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) return false;
  return frame.polygon && frame.polygon.length >= 3 ? pointInPolygon(frame.polygon, { x, y }) : true;
}

/** The text frame of a comic (`::panel{text}`, #885) under the sheet point
 *  with its comic, the one on top first: the page's comic page or a strip
 *  it holds (#959); null off them. The frames of a comic's picture panels
 *  are the comic tools' (`comicHit`). */
export function comicTextHitAt(page: ComicPageLike | null | undefined, x: number, y: number): { comic: VDTComicPage; frame: VDTFrame } | null {
  if (!page) return null;
  const comics = pageComics({ comic: page.comic, columns: page.columns ?? [], ...(page.floats ? { floats: page.floats } : {}), ...(page.flow ? { flow: page.flow } : {}) });
  for (let k = comics.length - 1; k >= 0; k--) {
    const comic = comics[k]!;
    const frames = (comic.frames ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f.blockIds.length > 0);
    frames.sort((a, b) => b.f.layer - a.f.layer || b.i - a.i);
    for (const { f } of frames) if (pointInComicFrame(f, x, y)) return { comic, frame: f };
  }
  return null;
}

/** The text frame under the sheet point ({@link comicTextHitAt}). */
export function comicTextFrameAt(page: ComicPageLike | null | undefined, x: number, y: number): VDTFrame | null {
  return comicTextHitAt(page, x, y)?.frame ?? null;
}

/** The frame with this id (`cp<fence>:<name>`) on the page. */
export function frameById(page: ComposedPageLike | null | undefined, id: string): VDTFrame | null {
  return page?.composed?.frames.find((f) => f.id === id) ?? null;
}

/** The frame with this name on the page (the slot it receives). */
export function frameByName(page: ComposedPageLike | null | undefined, name: string): VDTFrame | null {
  return page?.composed?.frames.find((f) => f.name === name) ?? null;
}

/** The frame whose poured content holds the source offset (absolute), the
 *  narrowest when ranges nest; null when none does. */
export function frameAtSource(page: ComposedPageLike | null | undefined, offset: number): VDTFrame | null {
  let best: VDTFrame | null = null;
  for (const f of page?.composed?.frames ?? []) {
    if (f.sourceStart == null || f.sourceEnd == null) continue;
    if (offset < f.sourceStart || offset > f.sourceEnd) continue;
    if (!best || f.sourceEnd - f.sourceStart < (best.sourceEnd! - best.sourceStart!)) best = f;
  }
  return best;
}

/** Whether a frame holds nothing: no source poured into it and no
 *  continuation from another frame. */
export function frameIsEmpty(frame: Pick<VDTFrame, 'sourceStart' | 'sourceEnd' | 'continuedFrom'>): boolean {
  if (frame.continuedFrom) return false;
  return frame.sourceStart == null || frame.sourceEnd == null || frame.sourceEnd <= frame.sourceStart;
}

/** Where on a frame's box a point lies, for dragging (#863): one of the
 *  eight resize handles within `band` sheet px of an edge or a corner, or
 *  `move` inside. Edges are named in the frame's upright box. */
export type FrameHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function frameHandleAt(frame: Pick<VDTFrame, 'rect' | 'rotate'>, x: number, y: number, band: number): FrameHandle | null {
  if (!pointInFrame(frame, x, y, band)) return null;
  const p = toFrameSpace(frame, x, y);
  const r = frame.rect;
  const n = Math.abs(p.y - r.y) <= band;
  const s = Math.abs(p.y - (r.y + r.height)) <= band;
  const w = Math.abs(p.x - r.x) <= band;
  const e = Math.abs(p.x - (r.x + r.width)) <= band;
  const v = n ? 'n' : s ? 's' : '';
  const h = w ? 'w' : e ? 'e' : '';
  const handle = `${v}${h}`;
  return handle ? (handle as FrameHandle) : 'move';
}

/** A 2D affine matrix `[a b c d e f]` (canvas `transform` order, y down). */
export type FrameAffine = [number, number, number, number, number, number];

/** The matrix that puts the blocks of the frame holding block `blockId`
 *  on the page (`frameMatrix`: the frame's text scale, #858, and its turn),
 *  null when the block is in no frame or its frame is upright at full
 *  size (#910). The blocks of a composed frame keep the frame's own
 *  coordinates: the caret, the selection and a click read them through it. */
export function blockFrameMatrix(page: ComposedPageLike | null | undefined, blockId: string): FrameAffine | null {
  const composed = page?.composed;
  if (!composed || composed.frames.length === 0) return null;
  const frame = frameOfBlock(composed, blockId);
  return (frame && (frameMatrix(frame) as FrameAffine | undefined)) ?? null;
}

/** Whether a point in a frame block's own coordinates (see
 *  {@link intoBlockSpace}) is painted: false past the foot of a frame
 *  whose content overflows its box, where the backends clip it. */
export function blockPointShown(page: ComposedPageLike | null | undefined, blockId: string, p: FramePoint): boolean {
  const composed = page?.composed;
  if (!composed || composed.frames.length === 0) return true;
  const frame = frameOfBlock(composed, blockId);
  if (!frame || !frameClips(frame)) return true;
  const r = frameContentRect(frame);
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** A page point in the blocks' own coordinates of a frame whose matrix is
 *  `m` (the inverse of {@link blockFrameMatrix}); the point itself when
 *  `m` is null. */
export function intoBlockSpace(m: FrameAffine | null, x: number, y: number): FramePoint {
  if (!m) return { x, y };
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return { x, y };
  const dx = x - e;
  const dy = y - f;
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
}

/** A point of a frame's blocks on the page (through `m`, as painted). */
export function fromBlockSpace(m: FrameAffine | null, x: number, y: number): FramePoint {
  if (!m) return { x, y };
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
