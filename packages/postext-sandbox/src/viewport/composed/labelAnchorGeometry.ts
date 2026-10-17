/**
 * Where the drawn labels of a page's figures stand on the sheet (#866): the
 * anchor point each one is set at, the box it covers, and the way back from
 * a point of the sheet to a point of the picture (fractions of the whole
 * picture, as `Resource.anchors` keeps them). Pure.
 *
 * A label's layout is in its block's frame (P6, #860): its point is
 * `(x, y)` px from the top-left of the picture's body as drawn (the crop
 * applied). The block's frame reaches the sheet through, innermost first,
 * the quarter turn of a turned picture, then the frame of the composed
 * page it stands in (`blockFrameMatrix`, #910: scaled text, a turned frame) or the
 * page's flow frame (a vertical page, a right-to-left page, where the
 * label's layout is mirrored about the body). Every step is affine, so the
 * whole is one matrix and its inverse.
 */

import {
  figureLabelMatrix,
  flowToPage,
  frameOfBlock,
  pageIsMirrored,
  type VDTDocument,
  type VDTFigureLabel,
} from 'postext';
import { blockFrameMatrix } from './frameHit';

type VDTBlock = VDTDocument['blocks'][number];
type VDTPage = VDTDocument['pages'][number];

/** `[a, b, c, d, e, f]`: `(x, y) → (a·x + c·y + e, b·x + d·y + f)`. */
export type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `outer · inner`: `inner` first. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function invertAffine(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A drawn label of a page, located on the sheet. */
export interface PageLabel {
  block: VDTBlock;
  label: VDTFigureLabel;
  resourceId: string;
  /** The anchor it is set at; unset for one placed by percentages. */
  anchorId?: string;
  /** The anchor point on the sheet (page px). */
  point: { x: number; y: number };
  /** The four corners of the label's box (its plate, else its lines) on the
   *  sheet, clockwise from its top-left in its own frame. */
  corners: Array<{ x: number; y: number }>;
  /** Still wider than its width at its style's smallest scale. */
  overflow: boolean;
  /** The scale it was set at to fit, below 1. */
  scale?: number;
  styleId?: string;
  /** Block frame → sheet. */
  matrix: Affine;
  /** The picture's body in the block's frame and the part of the picture
   *  it shows. */
  body: { x: number; y: number; width: number; height: number };
  source: { x: number; y: number; width: number; height: number };
  /** The label's layout is mirrored about the body (a right-to-left page). */
  mirrored: boolean;
}

/** The block frame of a resource block's body and the quarter turn that
 *  puts it on the block's frame (as `composed/labels.ts` reads it). */
function bodyFrame(block: VDTBlock): { bx: number; by: number; turn: Affine } {
  const rb = block.resourceBlock!;
  const rot = rb.rotation;
  if (!rot) return { bx: block.bbox.x + rb.bodyRect.x, by: block.bbox.y + rb.bodyRect.y, turn: IDENTITY };
  const turn: Affine = rot.direction === 'ccw' ? [0, -1, 1, 0, rot.originX, rot.originY] : [0, 1, -1, 0, rot.originX, rot.originY];
  return { bx: rb.bodyRect.x, by: rb.bodyRect.y, turn };
}

/** The affine form of `flowToPage` for `page`. */
function flowAffine(page: VDTPage): Affine {
  const flow = page.flow;
  if (!flow) return IDENTITY;
  const o = flowToPage(page, 0, 0);
  const ex = flowToPage(page, 1, 0);
  const ey = flowToPage(page, 0, 1);
  return [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y];
}

/** The blocks of page `pageIndex` that hold drawn labels. */
function labelledBlocks(doc: VDTDocument, pageIndex: number): VDTBlock[] {
  const out: VDTBlock[] = [];
  const seen = new Set<VDTBlock>();
  const add = (b: VDTBlock) => {
    if (seen.has(b) || b.hidden || !b.resourceBlock?.labels?.some((l) => l.layout)) return;
    seen.add(b);
    out.push(b);
  };
  for (const b of doc.blocks) if (b.pageIndex === pageIndex) add(b);
  for (const b of doc.pages[pageIndex]?.floats ?? []) add(b);
  return out;
}

/** Every drawn label of page `pageIndex`, located on the sheet. */
export function labelsOnPage(doc: VDTDocument, pageIndex: number): PageLabel[] {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const out: PageLabel[] = [];
  for (const block of labelledBlocks(doc, pageIndex)) {
    const rb = block.resourceBlock!;
    // In a frame of a composed page: its matrix (none for an upright frame
    // at full size); else the page's flow frame.
    const inFrame = frameOfBlock(page.composed, block.id) !== undefined;
    const outer: Affine = inFrame ? blockFrameMatrix(page, block.id) ?? IDENTITY : flowAffine(page);
    const { bx, by, turn } = bodyFrame(block);
    const matrix = composeAffine(outer, turn);
    const mirrored = pageIsMirrored(page);
    const source = rb.bodySource ?? { x: 0, y: 0, width: 1, height: 1 };
    for (const label of rb.labels ?? []) {
      const layout = label.layout;
      if (!layout) continue;
      const own = figureLabelMatrix(layout, bx, by) as Affine;
      const toSheet = composeAffine(matrix, own);
      const r = layout.background?.rect ?? layout.box;
      const corners = [
        applyAffine(toSheet, r.x, r.y),
        applyAffine(toSheet, r.x + r.width, r.y),
        applyAffine(toSheet, r.x + r.width, r.y + r.height),
        applyAffine(toSheet, r.x, r.y + r.height),
      ];
      const anchorId = 'anchor' in label.at ? label.at.anchor : undefined;
      out.push({
        block,
        label,
        resourceId: rb.resource.id,
        ...(anchorId ? { anchorId } : {}),
        point: applyAffine(matrix, bx + layout.x, by + layout.y),
        corners,
        overflow: layout.overflow === true,
        ...(layout.scale !== undefined && layout.scale < 1 ? { scale: layout.scale } : {}),
        ...(layout.styleId ? { styleId: layout.styleId } : {}),
        matrix,
        body: { x: bx, y: by, width: rb.bodyRect.width, height: rb.bodyRect.height },
        source: { ...source },
        mirrored,
      });
    }
  }
  return out;
}

/** The point of the whole picture (fractions, not clamped) under the
 *  sheet point `(x, y)`, for the picture `pl` stands on. */
export function sheetToPicture(pl: Pick<PageLabel, 'matrix' | 'body' | 'source' | 'mirrored'>, x: number, y: number): { x: number; y: number } | null {
  const inv = invertAffine(pl.matrix);
  if (!inv) return null;
  const q = applyAffine(inv, x, y);
  let lx = q.x - pl.body.x;
  const ly = q.y - pl.body.y;
  if (pl.mirrored) lx = pl.body.width - lx;
  const w = pl.body.width > 0 ? pl.body.width : 1;
  const h = pl.body.height > 0 ? pl.body.height : 1;
  const sw = pl.source.width > 0 ? pl.source.width : 1;
  const sh = pl.source.height > 0 ? pl.source.height : 1;
  return { x: pl.source.x + (lx / w) * sw, y: pl.source.y + (ly / h) * sh };
}

/** The sheet point of the picture point `(fx, fy)` (fractions). */
export function pictureToSheet(pl: Pick<PageLabel, 'matrix' | 'body' | 'source' | 'mirrored'>, fx: number, fy: number): { x: number; y: number } {
  const sw = pl.source.width > 0 ? pl.source.width : 1;
  const sh = pl.source.height > 0 ? pl.source.height : 1;
  let lx = ((fx - pl.source.x) / sw) * pl.body.width;
  const ly = ((fy - pl.source.y) / sh) * pl.body.height;
  if (pl.mirrored) lx = pl.body.width - lx;
  return applyAffine(pl.matrix, pl.body.x + lx, pl.body.y + ly);
}

/** Whether `(x, y)` lies inside the polygon `corners`. */
export function insideCorners(corners: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i]!;
    const b = corners[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The label of `labels` a press at `(x, y)` takes: the anchor point within
 *  `tolerance` (sheet px) first, the nearest; else the topmost box holding
 *  the point. Only labels set at an anchor can be moved. */
export function labelAt(labels: readonly PageLabel[], x: number, y: number, tolerance: number): PageLabel | null {
  let best: PageLabel | null = null;
  let bestD = tolerance;
  for (const pl of labels) {
    if (!pl.anchorId) continue;
    const d = Math.hypot(pl.point.x - x, pl.point.y - y);
    if (d <= bestD) {
      best = pl;
      bestD = d;
    }
  }
  if (best) return best;
  for (let i = labels.length - 1; i >= 0; i--) {
    const pl = labels[i]!;
    if (pl.anchorId && insideCorners(pl.corners, x, y)) return pl;
  }
  return null;
}

/** The upright box of `corners`. */
export function cornersBounds(corners: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
