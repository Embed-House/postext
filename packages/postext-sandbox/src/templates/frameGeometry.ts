/**
 * The geometry of the page-template editor (#863): page pixels and the
 * template's millimetres, the drag of a frame (move, the eight resize
 * handles, a new frame drawn on the page), snapping to the margins, the
 * template grid and the other frames, and the write-back of a dragged box
 * into the frame's `placement` and size.
 *
 * A frame's box is where the engine laid it (`VDTFrame.rect`, page px). A
 * move keeps the frame's anchor and changes its offset by what the anchor
 * point moved: the pin of the anchor edge (`top-right` pins the box's
 * right side, `below` its top-left corner) says which point of the box
 * that is, as in the engine's `anchorOn`. A resize writes the new width or
 * height in millimetres.
 */

import type { AnchorEdge, Dimension, ElementPlacement, FrameConfig, FrameGridCell, PageTemplateGrid, ResolvedFrame } from 'postext';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MM_PER_IN = 25.4;

export const pxToMm = (px: number, dpi: number): number => (px * MM_PER_IN) / dpi;
export const mmToPx = (mm: number, dpi: number): number => (mm * dpi) / MM_PER_IN;

/** Tenths of a millimetre: what the fields show and the config stores. */
export const roundMm = (v: number): number => Math.round(v * 10) / 10 || 0;

export const mmDim = (v: number): Dimension => ({ value: roundMm(v), unit: 'mm' });

/** Millimetres per unit; `em` and `rem` take `emMm`. */
export function dimensionToMm(d: Dimension | undefined, emMm = 4.2333): number {
  if (!d) return 0;
  switch (d.unit) {
    case 'mm': return d.value;
    case 'cm': return d.value * 10;
    case 'in': return d.value * MM_PER_IN;
    case 'pt': return (d.value * MM_PER_IN) / 72;
    case 'px': return (d.value * MM_PER_IN) / 96;
    case 'em':
    case 'rem':
      return d.value * emMm;
    default: return d.value;
  }
}

/** The rectangles a template's frames refer to on a page (page px). */
export interface PageAreas {
  content: Rect;
  trim: Rect;
  bleed: Rect;
}

export function pageAreas(page: { width: number; height: number; contentArea: Rect }, trimOffset: number): PageAreas {
  const { x, y, width, height } = page.contentArea;
  return {
    content: { x, y, width, height },
    trim: { x: trimOffset, y: trimOffset, width: page.width - 2 * trimOffset, height: page.height - 2 * trimOffset },
    bleed: { x: 0, y: 0, width: page.width, height: page.height },
  };
}

const unionOf = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/**
 * The areas of a page of a spread (#861), in this page's px: the sheet is
 * the two pages side by side, the trims meeting at the spine, so the
 * facing page's boxes sit one trim width (`shift`) away, to the right of
 * the first page (`side` 0) or to the left of the second (`side` 1).
 * `content` is the union of both content areas; trim and bleed run outer
 * edge to outer edge, as the engine lays the sheet (`spreadSheet`).
 */
export function spreadPageAreas(
  page: { width: number; height: number; contentArea: Rect },
  facing: { contentArea: Rect },
  trimOffset: number,
  side: 0 | 1,
): PageAreas & { shift: number } {
  const own = pageAreas(page, trimOffset);
  const shift = own.trim.width;
  const dx = side === 0 ? shift : -shift;
  const moved = (r: Rect): Rect => ({ ...r, x: r.x + dx });
  return {
    content: unionOf(own.content, moved(facing.contentArea)),
    trim: unionOf(own.trim, moved(own.trim)),
    bleed: unionOf(own.bleed, moved(own.bleed)),
    shift,
  };
}

/** The template's `area` on the page. */
export function templateAreaRect(area: 'content' | 'trim' | 'bleed' | undefined, areas: PageAreas): Rect {
  return area === 'trim' ? areas.trim : area === 'bleed' ? areas.bleed : areas.content;
}

export type Pin = 'start' | 'middle' | 'end';

/** Which side of the box an anchor edge pins (the engine's `anchorOn`):
 *  `element` for an anchor to another frame or group (`'#name'`). */
export function anchorPins(edge: AnchorEdge, element: boolean): { pinX: Pin; pinY: Pin } {
  if (element) {
    switch (edge) {
      case 'right-of':
      case 'below':
      case 'align-top':
      case 'align-left':
        return { pinX: 'start', pinY: 'start' };
      case 'left-of':
      case 'align-right':
        return { pinX: 'end', pinY: 'start' };
      case 'above':
      case 'align-bottom':
        return { pinX: 'start', pinY: 'end' };
      default:
        break;
    }
  }
  switch (edge) {
    case 'top': return { pinX: 'middle', pinY: 'start' };
    case 'top-right': return { pinX: 'end', pinY: 'start' };
    case 'left': return { pinX: 'start', pinY: 'middle' };
    case 'center': return { pinX: 'middle', pinY: 'middle' };
    case 'right': return { pinX: 'end', pinY: 'middle' };
    case 'bottom-left': return { pinX: 'start', pinY: 'end' };
    case 'bottom': return { pinX: 'middle', pinY: 'end' };
    case 'bottom-right': return { pinX: 'end', pinY: 'end' };
    default: return { pinX: 'start', pinY: 'start' };
  }
}

const pinAt = (pin: Pin, start: number, size: number): number => (pin === 'start' ? start : pin === 'end' ? start + size : start + size / 2);

/** A template grid's columns and rows on a page (px). */
export interface GridGeometry {
  cols: { start: number; end: number }[];
  rows: { start: number; end: number }[];
}

export function gridGeometry(grid: PageTemplateGrid, area: Rect, dpi: number, emMm?: number): GridGeometry {
  const columns = Math.max(1, Math.round(grid.columns));
  const rows = Math.max(1, Math.round(grid.rows));
  const cg = mmToPx(dimensionToMm(grid.columnGap, emMm), dpi);
  const rg = mmToPx(dimensionToMm(grid.rowGap, emMm), dpi);
  const cw = (area.width - (columns - 1) * cg) / columns;
  const rh = (area.height - (rows - 1) * rg) / rows;
  return {
    cols: Array.from({ length: columns }, (_, i) => ({ start: area.x + i * (cw + cg), end: area.x + i * (cw + cg) + cw })),
    rows: Array.from({ length: rows }, (_, i) => ({ start: area.y + i * (rh + rg), end: area.y + i * (rh + rg) + rh })),
  };
}

const nearestIndex = (values: readonly number[], v: number): number => {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i]! - v) < Math.abs(values[best]! - v)) best = i;
  return best;
};

/** The grid cell a box covers best: its first column and row at the
 *  nearest track start, its spans to the nearest track end. */
export function gridCellFor(geom: GridGeometry, rect: Rect): Required<FrameGridCell> {
  const c0 = nearestIndex(geom.cols.map((c) => c.start), rect.x);
  const c1 = Math.max(c0, nearestIndex(geom.cols.map((c) => c.end), rect.x + rect.width));
  const r0 = nearestIndex(geom.rows.map((r) => r.start), rect.y);
  const r1 = Math.max(r0, nearestIndex(geom.rows.map((r) => r.end), rect.y + rect.height));
  return { col: c0 + 1, row: r0 + 1, cols: c1 - c0 + 1, rows: r1 - r0 + 1 };
}

/** What a drag grabs: the box itself or one of its eight handles. */
export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_HANDLES: readonly Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** A handle's point on a box. */
export function handlePoint(rect: Rect, handle: Exclude<Handle, 'move'>): { x: number; y: number } {
  const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

/** The handle within `tol` of a point (corners before sides), `'move'`
 *  inside the box, null outside. */
export function handleAt(rect: Rect, x: number, y: number, tol: number): Handle | null {
  let best: Handle | null = null;
  let bestD = Infinity;
  // Corners first: a tie goes to the corner.
  for (const h of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as const) {
    const p = handlePoint(rect, h);
    const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    if (d <= tol && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  if (best) return best;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height ? 'move' : null;
}

/** `start` dragged by `(dx, dy)` with `handle`; a side never crosses the
 *  opposite one (`minSize` apart). */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, minSize = 1): Rect {
  if (handle === 'move') return { ...start, x: start.x + dx, y: start.y + dy };
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.min(left + dx, right - minSize);
  if (handle.includes('e')) right = Math.max(right + dx, left + minSize);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - minSize);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + minSize);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The box between two points. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** The lines a dragged box snaps to (page px). */
export interface SnapLines {
  xs: number[];
  ys: number[];
}

/** The margins (the content area's edges and centre), the trim, the
 *  template area, the grid tracks and the other frames' edges and
 *  centres. */
export function snapLines(areas: PageAreas, area: Rect, grid: GridGeometry | undefined, others: readonly Rect[]): SnapLines {
  const xs: number[] = [];
  const ys: number[] = [];
  const box = (r: Rect, centre: boolean) => {
    xs.push(r.x, r.x + r.width);
    ys.push(r.y, r.y + r.height);
    if (centre) {
      xs.push(r.x + r.width / 2);
      ys.push(r.y + r.height / 2);
    }
  };
  box(areas.content, true);
  box(areas.trim, true);
  box(area, false);
  if (grid) {
    for (const c of grid.cols) xs.push(c.start, c.end);
    for (const r of grid.rows) ys.push(r.start, r.end);
  }
  for (const r of others) box(r, true);
  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 100) / 100))];
  return { xs: uniq(xs), ys: uniq(ys) };
}

/** The line within `tol` of any of `values` closest to one of them: the
 *  shift that puts it there, and the line. */
function nearestSnap(values: readonly number[], lines: readonly number[], tol: number): { shift: number; line: number } | null {
  let best: { shift: number; line: number } | null = null;
  for (const v of values) {
    for (const l of lines) {
      const d = l - v;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, line: l };
    }
  }
  return best;
}

export interface SnapResult {
  rect: Rect;
  /** The lines the box snapped to, to draw as guides. */
  guideX?: number;
  guideY?: number;
}

/** `rect` (dragged with `handle`) snapped: a moved box by its sides or its
 *  centre, a resized one by the sides the handle moves. */
export function snapRect(rect: Rect, handle: Handle, lines: SnapLines, tol: number): SnapResult {
  const out: SnapResult = { rect: { ...rect } };
  const r = out.rect;
  if (handle === 'move') {
    const sx = nearestSnap([r.x, r.x + r.width / 2, r.x + r.width], lines.xs, tol);
    if (sx) {
      r.x += sx.shift;
      out.guideX = sx.line;
    }
    const sy = nearestSnap([r.y, r.y + r.height / 2, r.y + r.height], lines.ys, tol);
    if (sy) {
      r.y += sy.shift;
      out.guideY = sy.line;
    }
    return out;
  }
  if (handle.includes('w')) {
    const s = nearestSnap([r.x], lines.xs, tol);
    if (s && s.shift < r.width) {
      r.x += s.shift;
      r.width -= s.shift;
      out.guideX = s.line;
    }
  } else if (handle.includes('e')) {
    const s = nearestSnap([r.x + r.width], lines.xs, tol);
    if (s && r.width + s.shift > 0) {
      r.width += s.shift;
      out.guideX = s.line;
    }
  }
  if (handle.includes('n')) {
    const s = nearestSnap([r.y], lines.ys, tol);
    if (s && s.shift < r.height) {
      r.y += s.shift;
      r.height -= s.shift;
      out.guideY = s.line;
    }
  } else if (handle.includes('s')) {
    const s = nearestSnap([r.y + r.height], lines.ys, tol);
    if (s && r.height + s.shift > 0) {
      r.height += s.shift;
      out.guideY = s.line;
    }
  }
  return out;
}

const EPS_MM = 0.05;

export interface FrameBoxChange {
  /** The frame as it resolves on the page. */
  resolved: Pick<ResolvedFrame, 'placement' | 'grid' | 'width' | 'height'>;
  /** Where the engine laid it, and where it was dropped (page px). */
  from: Rect;
  to: Rect;
  /** The template's area on the page. */
  area: Rect;
  dpi: number;
  /** The template grid on the page, for a frame set in a cell. */
  grid?: GridGeometry;
  emMm?: number;
}

/**
 * The fields to write on a frame dropped at `to`: a `grid` cell for a
 * frame set in the grid; otherwise its `placement` with the anchor kept
 * and the offset moved by what the anchor point moved (a frame with no
 * placement gets one at the area's top-left), and `width` / `height` in
 * millimetres for a side that changed (or that would change with the
 * move: a `'fill'` size runs to the area's edge from wherever it starts).
 */
export function frameBoxPatch(change: FrameBoxChange): Partial<FrameConfig> {
  const { resolved, from, to, area, dpi } = change;
  const mm = (px: number) => pxToMm(px, dpi);
  const moved = Math.abs(mm(to.x - from.x)) > EPS_MM || Math.abs(mm(to.y - from.y)) > EPS_MM;
  const resizedW = Math.abs(mm(to.width - from.width)) > EPS_MM;
  const resizedH = Math.abs(mm(to.height - from.height)) > EPS_MM;
  const patch: Partial<FrameConfig> = {};
  if (!moved && !resizedW && !resizedH) return patch;
  if (resolved.grid && change.grid) {
    patch.grid = gridCellFor(change.grid, to);
    return patch;
  }
  const fillW = resolved.width === 'fill';
  const fillH = resolved.height === 'fill';
  if (!resolved.placement) {
    patch.placement = {
      anchor: { to: 'container', edge: 'top-left' },
      offset: { x: mmDim(mm(to.x - area.x)), y: mmDim(mm(to.y - area.y)) },
    };
    patch.width = mmDim(mm(to.width));
    if (resizedH || fillH) patch.height = mmDim(mm(to.height));
    return patch;
  }
  const placement = resolved.placement;
  const element = placement.anchor.to.startsWith('#');
  const { pinX, pinY } = anchorPins(placement.anchor.edge, element);
  const dxa = pinAt(pinX, to.x, to.width) - pinAt(pinX, from.x, from.width);
  const dya = pinAt(pinY, to.y, to.height) - pinAt(pinY, from.y, from.height);
  if (Math.abs(mm(dxa)) > EPS_MM || Math.abs(mm(dya)) > EPS_MM) {
    const ox = dimensionToMm(placement.offset?.x, change.emMm) + mm(dxa);
    const oy = dimensionToMm(placement.offset?.y, change.emMm) + mm(dya);
    const next: ElementPlacement = { ...placement, offset: { x: mmDim(ox), y: mmDim(oy) } };
    patch.placement = next;
  }
  if (resizedW || (moved && fillW)) patch.width = mmDim(mm(to.width));
  if (resizedH || (moved && fillH)) patch.height = mmDim(mm(to.height));
  return patch;
}

/** A frame drawn on the page as `rect`: anchored to the area's top-left. */
export function frameFromRect(name: string, rect: Rect, area: Rect, dpi: number): FrameConfig {
  return {
    name,
    placement: {
      anchor: { to: 'container', edge: 'top-left' },
      offset: { x: mmDim(pxToMm(rect.x - area.x, dpi)), y: mmDim(pxToMm(rect.y - area.y, dpi)) },
    },
    width: mmDim(pxToMm(rect.width, dpi)),
    height: mmDim(pxToMm(rect.height, dpi)),
  };
}

/** A point turned `-deg` about the centre of `rect`: where it falls in the
 *  frame's own (upright) box. */
export function unrotatePoint(rect: Rect, deg: number, x: number, y: number): { x: number; y: number } {
  if (!deg) return { x, y };
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const a = (-deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}
