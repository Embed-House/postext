/**
 * Box shapes (DESIGN §12.8, #1059): a box with one radius per corner, a
 * border per side, and a card joined to its label tab, drawn as vector
 * outlines (`VDTDesignPathBlock`, §12.1) that every backend paints alike.
 *
 * An outline is a rectilinear polygon walked clockwise on the sheet (y
 * down): each vertex a corner, rounded convex (a box corner, a tab's outer
 * corner) or concave (the fillet where a tab meets the box), each edge on
 * one side of the box. The border's inner edge is the outline with each
 * edge moved in by its side's width: a convex corner's radius shrinks by
 * the widths beside it (an ellipse when they differ, CSS's inner border
 * edge), a fillet's grows. A side's piece of border runs between the two
 * corners where the side changes, each split where the widths meet (the
 * whole corner to a side whose neighbour has no width), as CSS splits it.
 */
import type { BorderSides, ColorValue, CornerRadius, Dimension } from '../types.js';
import type { BoundingBox, VDTDesignBoxStyle, VDTDesignPathBlock, VDTPathCommand } from '../vdt.js';
import { createBoundingBox } from '../vdt.js';

export type ShapeSide = 'top' | 'right' | 'bottom' | 'left';

export const SHAPE_SIDES: readonly ShapeSide[] = ['top', 'right', 'bottom', 'left'];

/** A corner of an outline: the point where its two edges meet and its
 *  radius (concave: a fillet). */
export interface ShapeVertex {
  x: number;
  y: number;
  r: number;
  concave?: boolean;
}

/** A closed rectilinear outline: `sides[i]` is the side of the edge from
 *  `vertices[i]` to the next vertex. */
export interface ShapeOutline {
  vertices: ShapeVertex[];
  sides: ShapeSide[];
}

/** A label tab grown out of a box (`label.joined`): it stands on the
 *  `edge` side, from `x0` to `x1` across, `height` out from the edge, its
 *  outer corners rounded `radius` (one for both, or the corner at `x0`
 *  and the one at `x1`, #1102), its sides meeting the box in fillets of
 *  `fillet`. */
export interface ShapeTab {
  edge: 'top' | 'bottom';
  x0: number;
  x1: number;
  height: number;
  radius: number | readonly [number, number];
  fillet: number;
}

/** Kappa: the control-point distance of a cubic quarter circle, as a
 *  fraction of its radius. */
const KAPPA = 0.5522847498307936;
/** A tab closer to the box's side than this (px) is flush with it. */
const FLUSH_EPS = 0.5;

type Pt = { x: number; y: number };
interface Arc { p0: Pt; p1: Pt; p2: Pt; p3: Pt; flat: boolean }

/** The outline of a box `(x, y, w, h)` with corner radii `[tl, tr, br,
 *  bl]` and, optionally, a joined tab. The radii are clamped so two
 *  corners never take more than their edge (each scaled by the edge's
 *  share, as CSS does per edge). */
export function boxOutline(box: BoundingBox, radii: readonly [number, number, number, number], tab?: ShapeTab): ShapeOutline {
  const { x, y, width: w, height: h } = box;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, r));
  const right = x + w;
  const foot = y + h;
  if (!tab || tab.x1 - tab.x0 <= 0 || tab.height <= 0) {
    return clampOutline({
      vertices: [{ x, y, r: tl }, { x: right, y, r: tr }, { x: right, y: foot, r: br }, { x, y: foot, r: bl }],
      sides: ['top', 'right', 'bottom', 'left'],
    });
  }
  const { a, b, flushL, flushR, th, top, rL, rR, ra, rb, fl, fr } = tabGeometry(box, [tl, tr, br, bl], tab);
  const vertices: ShapeVertex[] = [];
  const sides: ShapeSide[] = [];
  const push = (v: ShapeVertex, side: ShapeSide) => {
    vertices.push(v);
    sides.push(side);
  };
  if (top) {
    const ty = y - th;
    // Clockwise from the top-left: along the top, up round the tab.
    if (!flushL) {
      push({ x, y, r: rL }, 'top');
      push({ x: a, y, r: fl, concave: true }, 'top');
    }
    push({ x: a, y: ty, r: ra }, 'top');
    push({ x: b, y: ty, r: rb }, flushR ? 'right' : 'top');
    if (!flushR) {
      push({ x: b, y, r: fr, concave: true }, 'top');
      push({ x: right, y, r: rR }, 'right');
    }
    push({ x: right, y: foot, r: br }, 'bottom');
    push({ x, y: foot, r: bl }, 'left');
  } else {
    const ty = foot + th;
    push({ x, y, r: tl }, 'top');
    push({ x: right, y, r: tr }, 'right');
    if (!flushR) {
      push({ x: right, y: foot, r: rR }, 'bottom');
      push({ x: b, y: foot, r: fr, concave: true }, 'bottom');
    }
    push({ x: b, y: ty, r: rb }, 'bottom');
    push({ x: a, y: ty, r: ra }, flushL ? 'left' : 'bottom');
    if (!flushL) {
      push({ x: a, y: foot, r: fl, concave: true }, 'bottom');
      push({ x, y: foot, r: rL }, 'left');
    }
  }
  return clampOutline({ vertices, sides });
}

/** Where a joined tab stands on a box and the radii of its corners,
 *  clamped as {@link boxOutline} draws them: the box outline and the tab's
 *  own fill ({@link tabRegionOutline}) share them. */
function tabGeometry(box: BoundingBox, radii: readonly [number, number, number, number], tab: ShapeTab) {
  const { x, width: w } = box;
  const [tl, tr, br, bl] = radii;
  const right = x + w;
  const a = Math.max(x, Math.min(tab.x0, right));
  const b = Math.max(a, Math.min(tab.x1, right));
  const flushL = a - x <= FLUSH_EPS;
  const flushR = right - b <= FLUSH_EPS;
  const th = tab.height;
  // Room beside the tab: the box's corner and the fillet share it.
  const gapL = a - x;
  const gapR = right - b;
  const top = tab.edge === 'top';
  const cornerL = top ? tl : bl;
  const cornerR = top ? tr : br;
  const fL = flushL ? 0 : Math.min(tab.fillet, gapL / 2);
  const fR = flushR ? 0 : Math.min(tab.fillet, gapR / 2);
  const rL = flushL ? 0 : Math.min(cornerL, gapL - fL);
  const rR = flushR ? 0 : Math.min(cornerR, gapR - fR);
  const f = Math.max(0, Math.min(Math.max(fL, fR), th));
  const [radiusA, radiusB] = typeof tab.radius === 'number' ? [tab.radius, tab.radius] : tab.radius;
  const outer = (r: number) => Math.max(0, Math.min(r, (b - a) / 2, th - f));
  const ra = outer(radiusA);
  const rb = outer(radiusB);
  const fl = Math.min(fL, f);
  const fr = Math.min(fR, f);
  return { a, b, flushL, flushR, th, top, rL, rR, ra, rb, fl, fr };
}

/** The part of a joined box-and-tab outline that is the tab (#1102): the
 *  tab out of the box's edge with its outer corners and the fillets that
 *  flare into the edge, closed along the edge. Painted over the box's
 *  fill in the tab's own colour, under the border. */
export function tabRegionOutline(box: BoundingBox, radii: readonly [number, number, number, number], tab: ShapeTab): ShapeOutline {
  const { a, b, flushL, flushR, th, top, ra, rb, fl, fr } = tabGeometry(box, radii.map((r) => Math.max(0, r)) as [number, number, number, number], tab);
  const edgeY = top ? box.y : box.y + box.height;
  const vertices: ShapeVertex[] = [];
  const sides: ShapeSide[] = [];
  const push = (v: ShapeVertex, side: ShapeSide) => {
    vertices.push(v);
    sides.push(side);
  };
  if (top) {
    const ty = edgeY - th;
    if (!flushL && fl > 0) {
      push({ x: a - fl, y: edgeY, r: 0 }, 'top');
      push({ x: a, y: edgeY, r: fl, concave: true }, 'left');
    } else push({ x: a, y: edgeY, r: 0 }, 'left');
    push({ x: a, y: ty, r: ra }, 'top');
    push({ x: b, y: ty, r: rb }, 'right');
    if (!flushR && fr > 0) {
      push({ x: b, y: edgeY, r: fr, concave: true }, 'top');
      push({ x: b + fr, y: edgeY, r: 0 }, 'bottom');
    } else push({ x: b, y: edgeY, r: 0 }, 'bottom');
  } else {
    const ty = edgeY + th;
    if (!flushR && fr > 0) {
      push({ x: b + fr, y: edgeY, r: 0 }, 'bottom');
      push({ x: b, y: edgeY, r: fr, concave: true }, 'right');
    } else push({ x: b, y: edgeY, r: 0 }, 'right');
    push({ x: b, y: ty, r: rb }, 'bottom');
    push({ x: a, y: ty, r: ra }, 'left');
    if (!flushL && fl > 0) {
      push({ x: a, y: edgeY, r: fl, concave: true }, 'bottom');
      push({ x: a - fl, y: edgeY, r: 0 }, 'top');
    } else push({ x: a, y: edgeY, r: 0 }, 'top');
  }
  return clampOutline({ vertices, sides });
}

function clampOutline(o: ShapeOutline): ShapeOutline {
  const n = o.vertices.length;
  const len = (i: number) => {
    const p = o.vertices[i]!;
    const q = o.vertices[(i + 1) % n]!;
    return Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
  };
  const vertices = o.vertices.map((v, i) => {
    if (v.r <= 0) return { ...v, r: 0 };
    const prev = o.vertices[(i + n - 1) % n]!;
    const next = o.vertices[(i + 1) % n]!;
    const before = len((i + n - 1) % n);
    const after = len(i);
    const k = Math.min(1, before / (v.r + prev.r), after / (v.r + next.r));
    return { ...v, r: v.r * k };
  });
  return { vertices, sides: o.sides };
}

/** Direction of the edge from vertex `i` (a unit axis vector). */
function edgeDir(o: ShapeOutline, i: number): Pt {
  const n = o.vertices.length;
  const p = o.vertices[i]!;
  const q = o.vertices[(i + 1) % n]!;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** The rounded corner at vertex `i` with every edge moved in by its
 *  side's inset: from the point on the incoming edge to the point on the
 *  outgoing one, as a cubic. */
function cornerArc(o: ShapeOutline, i: number, inset: Record<ShapeSide, number>): Arc {
  const n = o.vertices.length;
  const v = o.vertices[i]!;
  const inI = (i + n - 1) % n;
  const dA = inset[o.sides[inI]!];
  const dB = inset[o.sides[i]!];
  const a = edgeDir(o, inI);
  const b = edgeDir(o, i);
  // Inward normals of a clockwise outline on a y-down sheet.
  const k: Pt = { x: v.x - a.y * dA - b.y * dB, y: v.y + a.x * dA + b.x * dB };
  const ra = v.r <= 0 ? 0 : v.concave ? v.r + dB : Math.max(0, v.r - dB);
  const rb = v.r <= 0 ? 0 : v.concave ? v.r + dA : Math.max(0, v.r - dA);
  const p0 = { x: k.x - a.x * ra, y: k.y - a.y * ra };
  const p3 = { x: k.x + b.x * rb, y: k.y + b.y * rb };
  return {
    p0,
    p1: { x: p0.x + (k.x - p0.x) * KAPPA, y: p0.y + (k.y - p0.y) * KAPPA },
    p2: { x: p3.x + (k.x - p3.x) * KAPPA, y: p3.y + (k.y - p3.y) * KAPPA },
    p3,
    flat: ra <= 0 && rb <= 0,
  };
}

const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** An arc cut at `t` (de Casteljau): the part before and the part after. */
function splitArc(c: Arc, t: number): [Arc, Arc] {
  const p01 = lerp(c.p0, c.p1, t);
  const p12 = lerp(c.p1, c.p2, t);
  const p23 = lerp(c.p2, c.p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    { p0: c.p0, p1: p01, p2: p012, p3: m, flat: c.flat },
    { p0: m, p1: p123, p2: p23, p3: c.p3, flat: c.flat },
  ];
}

const ZERO: Record<ShapeSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };

function curve(out: VDTPathCommand[], c: Arc): void {
  if (c.flat) return;
  out.push({ op: 'C', x1: c.p1.x, y1: c.p1.y, x2: c.p2.x, y2: c.p2.y, x: c.p3.x, y: c.p3.y });
}

/** The closed outline, moved in by `inset` per side (none: the outer
 *  edge). */
export function outlineSubpath(o: ShapeOutline, inset: Record<ShapeSide, number> = ZERO): VDTPathCommand[] {
  const arcs = o.vertices.map((_, i) => cornerArc(o, i, inset));
  const out: VDTPathCommand[] = [{ op: 'M', x: arcs[0]!.p3.x, y: arcs[0]!.p3.y }];
  for (let i = 1; i <= arcs.length; i++) {
    const c = arcs[i % arcs.length]!;
    out.push({ op: 'L', x: c.p0.x, y: c.p0.y });
    curve(out, c);
  }
  out.push({ op: 'Z' });
  return out;
}

/** Where a corner between sides is split: the part of its arc on the
 *  incoming side is `wA / (wA + wB)` of it (all of it to a side whose
 *  neighbour has no width, half when both have none). */
function splitAt(wA: number, wB: number): number {
  return wA + wB > 0 ? wA / (wA + wB) : 0.5;
}

/** The pieces of border, one closed subpath per run of edges on a side
 *  that has a width in `widths`. */
export function borderPieces(o: ShapeOutline, widths: Record<ShapeSide, number>): Map<ShapeSide, VDTPathCommand[][]> {
  const n = o.vertices.length;
  const outer = o.vertices.map((_, i) => cornerArc(o, i, ZERO));
  const inner = o.vertices.map((_, i) => cornerArc(o, i, widths));
  // The corners where the side changes, split where the widths meet.
  const cut = (arcs: Arc[], i: number): [Arc, Arc] => {
    const wA = widths[o.sides[(i + n - 1) % n]!];
    const wB = widths[o.sides[i]!];
    return splitArc(arcs[i]!, splitAt(wA, wB));
  };
  const pieces = new Map<ShapeSide, VDTPathCommand[][]>();
  const starts = o.vertices.map((_, i) => i).filter((i) => o.sides[(i + n - 1) % n] !== o.sides[i]);
  for (const s of starts) {
    const side = o.sides[s]!;
    if (!(widths[side] > 0)) continue;
    let e = s;
    while (o.sides[(e + 1) % n] === side && (e + 1) % n !== s) e = (e + 1) % n;
    const endV = (e + 1) % n;
    // The outer edge from the start corner's split to the end corner's.
    const path: VDTPathCommand[] = [];
    const [, oStart] = cut(outer, s);
    const [oEnd] = cut(outer, endV);
    path.push({ op: 'M', x: oStart.p0.x, y: oStart.p0.y });
    curve(path, oStart);
    for (let i = (s + 1) % n; i !== endV; i = (i + 1) % n) {
      path.push({ op: 'L', x: outer[i]!.p0.x, y: outer[i]!.p0.y });
      curve(path, outer[i]!);
    }
    path.push({ op: 'L', x: oEnd.p0.x, y: oEnd.p0.y });
    curve(path, oEnd);
    // Across to the inner edge and back along it, the other way round.
    const [iEnd] = cut(inner, endV);
    const [, iStart] = cut(inner, s);
    path.push({ op: 'L', x: iEnd.p3.x, y: iEnd.p3.y });
    reverseCurve(path, iEnd);
    for (let i = (endV + n - 1) % n; i !== s; i = (i + n - 1) % n) {
      path.push({ op: 'L', x: inner[i]!.p3.x, y: inner[i]!.p3.y });
      reverseCurve(path, inner[i]!);
    }
    path.push({ op: 'L', x: iStart.p3.x, y: iStart.p3.y });
    reverseCurve(path, iStart);
    path.push({ op: 'Z' });
    const list = pieces.get(side) ?? [];
    list.push(path);
    pieces.set(side, list);
  }
  return pieces;
}

function reverseCurve(out: VDTPathCommand[], c: Arc): void {
  if (c.flat) return;
  out.push({ op: 'C', x1: c.p2.x, y1: c.p2.y, x2: c.p1.x, y2: c.p1.y, x: c.p0.x, y: c.p0.y });
}

/** The border of a shape, per side: colour and width, `null` for none. */
export type ShapeBorder = Record<ShapeSide, { color: string; widthPx: number } | null>;

/** The ink box of `subpaths` (points and control points). */
function boundsOf(subpaths: readonly VDTPathCommand[][]): BoundingBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const sp of subpaths) {
    for (const c of sp) {
      if (c.op === 'Z') continue;
      add(c.x, c.y);
      if (c.op === 'C') {
        add(c.x1, c.y1);
        add(c.x2, c.y2);
      }
    }
  }
  return x0 <= x1 ? createBoundingBox(x0, y0, x1 - x0, y1 - y0) : createBoundingBox(0, 0, 0, 0);
}

/** The path blocks that paint `outline` filled in `fill` with `border`
 *  inside it: the fill, then the border — one ring when all four sides
 *  have a border of one colour, else the pieces of each colour. A border that
 *  leaves no room inside fills the shape in its colour. */
export function shapePathBlocks(outline: ShapeOutline, fill: string | undefined, border: ShapeBorder | undefined): VDTDesignPathBlock[] {
  const widths: Record<ShapeSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  const colors = new Map<string, ShapeSide[]>();
  for (const side of SHAPE_SIDES) {
    const b = border?.[side];
    if (!b || !(b.widthPx > 0) || !b.color) continue;
    widths[side] = b.widthPx;
    const list = colors.get(b.color) ?? [];
    list.push(side);
    colors.set(b.color, list);
  }
  const outer = outlineSubpath(outline);
  const bbox = boundsOf([outer]);
  const out: VDTDesignPathBlock[] = [];
  const solid = colors.size > 0 && (widths.left + widths.right >= bbox.width || widths.top + widths.bottom >= bbox.height);
  const widest = (sides: readonly ShapeSide[]) => Math.max(...sides.map((s) => widths[s]));
  if (solid) {
    const first = SHAPE_SIDES.find((s) => widths[s] > 0)!;
    return [{ kind: 'path', bbox: { ...bbox }, subpaths: [outer], fill: border![first]!.color, boxPart: 'border', borderWidthPx: widest(SHAPE_SIDES) }];
  }
  // Each block its own box: the passes that move blocks move them in place.
  if (fill) out.push({ kind: 'path', bbox: { ...bbox }, subpaths: [outer], fill, boxPart: 'fill' });
  // One ring when every side has a border of one colour; otherwise the
  // pieces, so no edge of the inner outline lies on the outer one (a
  // rasteriser draws such an edge as a hairline).
  if (colors.size === 1 && SHAPE_SIDES.every((side) => widths[side] > 0)) {
    const [[color, sides]] = [...colors];
    out.push({
      kind: 'path', bbox: { ...bbox }, subpaths: [outer.map((c) => ({ ...c })), outlineSubpath(outline, widths)], fill: color, fillRule: 'evenodd',
      boxPart: 'border', borderWidthPx: widest(sides),
    });
  } else if (colors.size > 0) {
    const pieces = borderPieces(outline, widths);
    for (const [color, sides] of colors) {
      const subpaths = sides.flatMap((s) => pieces.get(s) ?? []);
      if (subpaths.length > 0) out.push({ kind: 'path', bbox: boundsOf(subpaths), subpaths, fill: color, boxPart: 'border', borderWidthPx: widest(sides) });
    }
  }
  return out;
}

/** Whether a box style needs the shape painter: corners of more than one
 *  radius, or a border that differs per side. A box with neither paints
 *  as it always has. */
export function boxNeedsShape(style: VDTDesignBoxStyle): boolean {
  return style.borderRadiiPx !== undefined || style.borderSides !== undefined;
}

/** The per-side border of a box style: its `borderSides`, else the whole
 *  border on every side. */
export function boxStyleBorder(style: VDTDesignBoxStyle): ShapeBorder {
  if (style.borderSides) return style.borderSides;
  const whole = style.borderColor && style.borderWidthPx > 0 ? { color: style.borderColor, widthPx: style.borderWidthPx } : null;
  return { top: whole, right: whole, bottom: whole, left: whole };
}

/** The corner radii of a box style. */
export function boxStyleRadii(style: VDTDesignBoxStyle): [number, number, number, number] {
  const r = style.borderRadiusPx;
  return style.borderRadiiPx ?? [r, r, r, r];
}

/** The path blocks of a box style painted at `(x, y, w, h)`: what the
 *  backends draw for a box that {@link boxNeedsShape}. */
export function boxStylePathBlocks(x: number, y: number, w: number, h: number, style: VDTDesignBoxStyle): VDTDesignPathBlock[] {
  if (w <= 0 || h <= 0) return [];
  const outline = boxOutline(createBoundingBox(x, y, w, h), boxStyleRadii(style));
  return shapePathBlocks(outline, style.backgroundColor, boxStyleBorder(style));
}

/** A box style with its corners and sides folded down to the plain fields
 *  when they say no more than those (every corner one radius, every side
 *  the same border), so a style that sets them alike paints as before. */
export function normalizeBoxStyle(style: VDTDesignBoxStyle): VDTDesignBoxStyle {
  const out: VDTDesignBoxStyle = { ...style };
  const radii = style.borderRadiiPx;
  if (radii) {
    out.borderRadiusPx = Math.max(...radii);
    if (radii.every((r) => r === radii[0])) delete out.borderRadiiPx;
  }
  const sides = style.borderSides;
  if (sides) {
    const list = SHAPE_SIDES.map((s) => sides[s]);
    const first = list.find((b) => b !== null);
    out.borderColor = first?.color;
    out.borderWidthPx = Math.max(0, ...list.map((b) => b?.widthPx ?? 0));
    if (!first) {
      delete out.borderColor;
      out.borderWidthPx = 0;
      delete out.borderSides;
    } else if (list.every((b) => b !== null && b.color === first.color && b.widthPx === first.widthPx)) {
      delete out.borderSides;
    }
  }
  return out;
}

/** Whether a corner radius names its corners (`{ topLeft, … }`) rather
 *  than being one length for all four. */
export function isCornerRadii(r: CornerRadius | undefined): r is Exclude<CornerRadius, Dimension> {
  return typeof r === 'object' && r !== null && !('value' in r && 'unit' in r);
}

/** The radius of every corner when a corner radius is one length; absent
 *  when it names its corners. */
export function uniformRadius(r: CornerRadius | undefined): Dimension | undefined {
  return r === undefined || isCornerRadii(r) ? undefined : r;
}

/** The four radii (px), top-left, top-right, bottom-right, bottom-left, of
 *  a corner radius: one length on every corner, or each corner's own (a
 *  corner left out is square). */
export function cornerRadiiPx(r: CornerRadius | undefined, toPx: (d: Dimension) => number): [number, number, number, number] {
  if (r === undefined) return [0, 0, 0, 0];
  if (!isCornerRadii(r)) {
    const v = Math.max(0, toPx(r));
    return [v, v, v, v];
  }
  const one = (d: Dimension | undefined) => (d && typeof d === 'object' ? Math.max(0, toPx(d)) : 0);
  return [one(r.topLeft), one(r.topRight), one(r.bottomRight), one(r.bottomLeft)];
}

/** The border per side of a box (px / hex): each side over the whole
 *  border's `enabled`, colour and width; a side is drawn when it is on and
 *  has a colour and a width. */
export function borderSidesPx(
  whole: { enabled: boolean; color: ColorValue | undefined; width: Dimension | undefined },
  sides: BorderSides | undefined,
  toPx: (d: Dimension) => number,
): ShapeBorder {
  const out = {} as ShapeBorder;
  for (const side of SHAPE_SIDES) {
    const own = sides && typeof sides === 'object' ? sides[side] : undefined;
    const o = own && typeof own === 'object' ? own : undefined;
    const enabled = o?.enabled ?? whole.enabled;
    const color = o?.color ?? whole.color;
    const width = o?.width ?? whole.width;
    const widthPx = width ? toPx(width) : 0;
    out[side] = enabled && color?.hex && widthPx > 0 ? { color: color.hex, widthPx } : null;
  }
  return out;
}
