/**
 * How the backends paint a composed page (#855, DESIGN §4): the frames in
 * layer order with the template's decoration at layer 0, each frame's
 * blocks turned by its matrix and clipped to its box when its content
 * overflows; on a page of a spread (#861) all of it clipped to the page's
 * share of the sheet. Shared by canvas, PDF and HTML so the three agree.
 */
import type { VDTBlock, VDTComposedPage, VDTFrame, VDTPage } from '../vdt';

/** One step of a composed page's paint order. */
export type ComposedPaintItem =
  /** `facing`: the half of a frame read on the facing page of a spread
   *  (`VDTFrame.facingBlocks`, #861): painted, never read. */
  | { kind: 'frame'; frame: VDTFrame; blocks: VDTBlock[]; facing: boolean }
  | { kind: 'decoration' };

/** Ids of the floats a composed page's frames hold: the backends paint
 *  them with their frames ({@link composedPaintOrder}), not with the
 *  page's other floats. Empty for any other page. */
export function composedFrameBlockIds(page: VDTPage): Set<string> {
  const ids = new Set<string>();
  for (const f of page.composed?.frames ?? []) for (const id of f.blockIds) ids.add(id);
  return ids;
}

/** The paint order of a composed page: frames of a layer below 0, the
 *  decoration (layer 0), then the frames of layer 0 and up; frames of
 *  one layer in template order. Each frame comes with its blocks, in
 *  `page.floats` order (its box first). */
export function composedPaintOrder(page: VDTPage): ComposedPaintItem[] {
  const composed = page.composed;
  if (!composed) return [];
  const byId = new Map<string, VDTBlock>();
  for (const b of page.floats ?? []) byId.set(b.id, b);
  const frames = composed.frames
    .map((frame, order) => ({ frame, order }))
    .sort((a, b) => a.frame.layer - b.frame.layer || a.order - b.order);
  const out: ComposedPaintItem[] = [];
  let decorated = false;
  for (const { frame } of frames) {
    if (!decorated && frame.layer >= 0) {
      out.push({ kind: 'decoration' });
      decorated = true;
    }
    if (frame.facingBlocks) {
      out.push({ kind: 'frame', frame, blocks: frame.facingBlocks, facing: true });
      continue;
    }
    const blocks: VDTBlock[] = [];
    for (const id of frame.blockIds) {
      const b = byId.get(id);
      if (b) blocks.push(b);
    }
    out.push({ kind: 'frame', frame, blocks, facing: false });
  }
  if (!decorated) out.push({ kind: 'decoration' });
  return out;
}

/** The items of a paint order (`composedPaintOrder`) in reading order
 *  (#862): the decoration first, then the frames by the Markdown order of
 *  their content (the lowest content index of their blocks; a frame with
 *  no content keeps its place after those that have some). The pieces of
 *  one story (`next`) follow each other, as their content does. What the
 *  HTML writes in this order and paints by `z-index`; the tagged PDF reads
 *  the same order (`readFloat`'s `readAt`). */
export function composedReadingOrder(paint: readonly ComposedPaintItem[]): ComposedPaintItem[] {
  const byId = new Map<string, VDTFrame>();
  for (const item of paint) if (item.kind === 'frame') byId.set(item.frame.id, item.frame);
  /** How many frames a chain passes through before this one: a piece of a
   *  paragraph cut at a frame's foot has the head's content index. */
  const depth = (frame: VDTFrame): number => {
    let n = 0;
    for (let f = frame.continuedFrom ? byId.get(frame.continuedFrom) : undefined; f && n < byId.size; f = f.continuedFrom ? byId.get(f.continuedFrom) : undefined) n++;
    return n;
  };
  const firstIndex = (item: ComposedPaintItem): number => {
    if (item.kind === 'decoration') return -Infinity;
    let min = Infinity;
    for (const b of item.blocks) if (b.contentIndex !== undefined && b.contentIndex < min) min = b.contentIndex;
    return min + depth(item.frame) / 1000;
  };
  return paint
    .map((item, order) => ({ item, order, at: firstIndex(item) }))
    .sort((a, b) => (a.at === b.at ? a.order - b.order : a.at - b.at))
    .map((e) => e.item);
}

/** On a page of a spread (#861): the box the page's frames and decoration
 *  are painted clipped to (`VDTComposedPage.sheetClip`), so what crosses
 *  the spine shows its own half on each page; undefined on any other
 *  page. */
export function composedSheetClip(page: Pick<VDTPage, 'composed'>): { x: number; y: number; width: number; height: number } | undefined {
  return page.composed?.sheetClip;
}

/** The affine matrix `[a, b, c, d, e, f]` (canvas `transform` order,
 *  y down) that turns a frame `rotate` degrees clockwise about the centre
 *  of its box; undefined for an upright frame. */
export function frameMatrix(frame: Pick<VDTFrame, 'rect' | 'rotate'>): [number, number, number, number, number, number] | undefined {
  const deg = frame.rotate % 360;
  if (!Number.isFinite(deg) || Math.abs(deg) < 1e-9) return undefined;
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = frame.rect.x + frame.rect.width / 2;
  const cy = frame.rect.y + frame.rect.height / 2;
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/** Whether a frame's content is clipped to its box: some of it runs past
 *  the frame's foot. */
export function frameClips(frame: Pick<VDTFrame, 'overflowPx'>): boolean {
  return frame.overflowPx > 0.5;
}

/** The axis-aligned box a frame covers on the page once turned. */
export function frameBounds(frame: Pick<VDTFrame, 'rect' | 'rotate'>): { x: number; y: number; width: number; height: number } {
  const m = frameMatrix(frame);
  const r = frame.rect;
  if (!m) return { ...r };
  const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].map(([x, y]) => [
    m[0] * x! + m[2] * y! + m[4],
    m[1] * x! + m[3] * y! + m[5],
  ]);
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The frame of `composed` holding block `id`, if any. */
export function frameOfBlock(composed: VDTComposedPage | undefined, id: string): VDTFrame | undefined {
  return composed?.frames.find((f) => f.blockIds.includes(id));
}
