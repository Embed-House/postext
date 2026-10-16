/**
 * What lies under the pointer on a composed page (#864, #863): the frames
 * of `page.composed`, in sheet px, the one painted on top first.
 *
 * Shared by the Content mode (a click on a frame moves the editor to its
 * slot) and the page-template editor (a drag moves or resizes a frame in
 * Design mode). Pure: sheet px, no DOM.
 */

import type { VDTComposedPage, VDTFrame, VDTPage } from 'postext';

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
