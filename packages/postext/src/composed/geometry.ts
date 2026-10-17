/**
 * Frame geometry of a composed page (#855, DESIGN §2.2, §5.2): where each
 * frame of a resolved template stands, in page pixels. Pure: the content's
 * natural height comes from a callback (the layout measures it with the box
 * typesetter), so the rules can be tested without laying text out.
 *
 * - Position: a `grid` cell, else `placement` (the anchor / offset language
 *   of design slots: the nine-point grid of the template's `area`, the trim
 *   (`'page'`) or the bleed, or `'#frame'` / `'#group'` with the
 *   element-to-element edges `right-of`, `below`…), else the whole area.
 * - Size: a fixed `Dimension`, a percentage of the area, `'fill'` (from the
 *   anchor point to the area's edge the frame grows towards) or `'auto'`
 *   (height only: the content's natural height); then `min*` / `max*`
 *   (min wins over max).
 * - Order: a frame is placed after the frame or group it anchors to, after
 *   the frame its chain comes from (`next`), and frames that push text
 *   (`exclude: 'push'`) before the others; ties keep template order.
 */
import { physicalEdge } from '../design/logicalEdges';
import type { AnchorEdge, Dimension, ElementPlacement } from '../types';
import { dimensionToPx } from '../units';
import { anchorTarget, continueInFrame } from './templates';
import type { FrameSize, ResolvedFrame, ResolvedFrameGroup, ResolvedPageTemplate } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rectangles a template's anchors refer to on one page. */
export interface FrameAreas {
  /** The template's `area` (the content area, the trim or the bleed). */
  area: Rect;
  /** The trim box (`anchor.to: 'page'`) and the bleed box. */
  page: Rect;
  bleed: Rect;
}

export interface FrameGeometryContext {
  areas: FrameAreas;
  dpi: number;
  /** Ems of the page's body text, for `em` lengths. */
  emPx: number;
}

type Pin = 'start' | 'middle' | 'end';

/** The anchor point and the side of the box pinned to it. */
interface Anchor {
  x: number;
  y: number;
  pinX: Pin;
  pinY: Pin;
}

const ELEMENT_EDGES: ReadonlySet<string> = new Set(['right-of', 'left-of', 'below', 'above', 'align-top', 'align-bottom', 'align-left', 'align-right', 'align-start', 'align-end']);

/** The anchor of `edge` on `ref`: the nine-point grid of a container, or an
 *  element-to-element edge when `element` (an anchor to `'#name'`). An
 *  element edge on a container, or a container edge on an element, reads
 *  as `top-left` / `align-top`, as design slots do. */
export function anchorOn(given: AnchorEdge, ref: Rect, element: boolean): Anchor {
  // Frames are laid in the page's flow frame, mirrored or turned already:
  // the start is its left (#936).
  const edge = physicalEdge(given, false);
  if (element) {
    switch (edge) {
      case 'right-of': return { x: ref.x + ref.width, y: ref.y, pinX: 'start', pinY: 'start' };
      case 'left-of': return { x: ref.x, y: ref.y, pinX: 'end', pinY: 'start' };
      case 'below': return { x: ref.x, y: ref.y + ref.height, pinX: 'start', pinY: 'start' };
      case 'above': return { x: ref.x, y: ref.y, pinX: 'start', pinY: 'end' };
      case 'align-bottom': return { x: ref.x, y: ref.y + ref.height, pinX: 'start', pinY: 'end' };
      case 'align-right': return { x: ref.x + ref.width, y: ref.y, pinX: 'end', pinY: 'start' };
      case 'align-top':
      case 'align-left':
        return { x: ref.x, y: ref.y, pinX: 'start', pinY: 'start' };
      default:
        // A nine-point edge on another frame: that point of its box.
        if (!ELEMENT_EDGES.has(edge)) return anchorOn(edge, ref, false);
        return { x: ref.x, y: ref.y, pinX: 'start', pinY: 'start' };
    }
  }
  const cx = ref.x + ref.width / 2;
  const cy = ref.y + ref.height / 2;
  const r = ref.x + ref.width;
  const b = ref.y + ref.height;
  switch (edge) {
    case 'top': return { x: cx, y: ref.y, pinX: 'middle', pinY: 'start' };
    case 'top-right': return { x: r, y: ref.y, pinX: 'end', pinY: 'start' };
    case 'left': return { x: ref.x, y: cy, pinX: 'start', pinY: 'middle' };
    case 'center': return { x: cx, y: cy, pinX: 'middle', pinY: 'middle' };
    case 'right': return { x: r, y: cy, pinX: 'end', pinY: 'middle' };
    case 'bottom-left': return { x: ref.x, y: b, pinX: 'start', pinY: 'end' };
    case 'bottom': return { x: cx, y: b, pinX: 'middle', pinY: 'end' };
    case 'bottom-right': return { x: r, y: b, pinX: 'end', pinY: 'end' };
    default: return { x: ref.x, y: ref.y, pinX: 'start', pinY: 'start' };
  }
}

const px = (d: Dimension | undefined, ctx: FrameGeometryContext): number | undefined =>
  d ? dimensionToPx(d, ctx.dpi, ctx.emPx) : undefined;

/** Room from an anchor coordinate to the area's edge the box grows towards
 *  (`'fill'`). */
function fillRoom(pin: Pin, at: number, lo: number, hi: number): number {
  if (pin === 'start') return Math.max(0, hi - at);
  if (pin === 'end') return Math.max(0, at - lo);
  return Math.max(0, 2 * Math.min(at - lo, hi - at));
}

/** `v` held between `min` and `max` (min wins). */
export function clampSize(v: number, min: number | undefined, max: number | undefined): number {
  let out = v;
  if (max !== undefined) out = Math.min(out, max);
  if (min !== undefined) out = Math.max(out, min);
  return Math.max(0, out);
}

/** A fixed size in px, or undefined for `'auto'` / `'fill'`. */
function fixedSize(size: FrameSize, whole: number, ctx: FrameGeometryContext): number | undefined {
  if (size === 'auto' || size === 'fill') return undefined;
  if ('percent' in size) return (whole * size.percent) / 100;
  return px(size, ctx);
}

/** The rectangle of cell `cell` of the template grid in `area`. */
export function gridCellRect(template: Pick<ResolvedPageTemplate, 'grid'>, cell: Required<{ col: number; row: number; cols: number; rows: number }>, area: Rect, ctx: FrameGeometryContext): Rect {
  const grid = template.grid!;
  const cg = px(grid.columnGap, ctx) ?? 0;
  const rg = px(grid.rowGap, ctx) ?? 0;
  const cw = (area.width - (grid.columns - 1) * cg) / grid.columns;
  const rh = (area.height - (grid.rows - 1) * rg) / grid.rows;
  return {
    x: area.x + (cell.col - 1) * (cw + cg),
    y: area.y + (cell.row - 1) * (rh + rg),
    width: cell.cols * cw + (cell.cols - 1) * cg,
    height: cell.rows * rh + (cell.rows - 1) * rg,
  };
}

/** What the geometry needs to know of a box it places: a frame's
 *  placement and sizes, or a group's. */
interface Placeable {
  placement?: ElementPlacement;
  grid?: Required<{ col: number; row: number; cols: number; rows: number }>;
  width: FrameSize;
  height: FrameSize;
  /** The height was written (a grid cell keeps its own otherwise). */
  heightSet: boolean;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
}

/**
 * The box of a frame (or group): `resolveRef` gives the box of a `'#name'`
 * anchor (undefined when it has none yet: the anchor then reads as the
 * area's); `natural(width)` the content's height at a width, for an
 * `'auto'` height.
 */
export function placeBox(
  item: Placeable,
  template: Pick<ResolvedPageTemplate, 'grid'>,
  ctx: FrameGeometryContext,
  resolveRef: (name: string) => Rect | undefined,
  natural: (width: number) => number,
): Rect {
  const { area } = ctx.areas;
  const minW = px(item.minWidth, ctx);
  const maxW = px(item.maxWidth, ctx);
  const minH = px(item.minHeight, ctx);
  const maxH = px(item.maxHeight, ctx);
  if (item.grid && template.grid) {
    const cell = gridCellRect(template, item.grid, area, ctx);
    const width = clampSize(fixedSize(item.width, area.width, ctx) ?? cell.width, minW, maxW);
    let height = cell.height;
    if (item.heightSet) {
      const fixed = fixedSize(item.height, area.height, ctx);
      height = fixed ?? (item.height === 'auto' ? natural(width) : cell.height);
    }
    return { x: cell.x, y: cell.y, width, height: clampSize(height, minH, maxH) };
  }
  if (!item.placement) {
    // The area's top-left, as wide as the area; the height as the frame's
    // rule says (`'auto'`, the default, never past the area's foot).
    const width = clampSize(fixedSize(item.width, area.width, ctx) ?? area.width, minW, maxW);
    const fixed = fixedSize(item.height, area.height, ctx);
    const height = fixed ?? (item.height === 'fill' ? area.height : Math.min(natural(width), area.height));
    return { x: area.x, y: area.y, width, height: clampSize(height, minH, maxH) };
  }
  const placement = item.placement;
  const target = anchorTarget(placement);
  const to = placement.anchor.to;
  const refBox = target ? resolveRef(target) : undefined;
  const ref = refBox ?? (to === 'page' ? ctx.areas.page : to === 'bleed' ? ctx.areas.bleed : area);
  // `'fill'` runs to the edge of the page's frame the anchor names (the
  // area for a frame anchored to another).
  const bounds = to === 'page' ? ctx.areas.page : to === 'bleed' ? ctx.areas.bleed : area;
  const a = anchorOn(placement.anchor.edge, ref, refBox !== undefined);
  const ox = px(placement.offset?.x, ctx) ?? 0;
  const oy = px(placement.offset?.y, ctx) ?? 0;
  const ax = a.x + ox;
  const ay = a.y + oy;
  const width = clampSize(
    fixedSize(item.width, area.width, ctx) ?? fillRoom(a.pinX, ax, bounds.x, bounds.x + bounds.width),
    minW,
    maxW,
  );
  const fixedH = fixedSize(item.height, area.height, ctx);
  const room = fillRoom(a.pinY, ay, bounds.y, bounds.y + bounds.height);
  // An `'auto'` height never runs past the edge the frame grows towards:
  // what does not fit there overflows the frame.
  const height = clampSize(
    fixedH ?? (item.height === 'fill' ? room : Math.min(natural(width), room)),
    minH,
    maxH,
  );
  const x = a.pinX === 'start' ? ax : a.pinX === 'end' ? ax - width : ax - width / 2;
  const y = a.pinY === 'start' ? ay : a.pinY === 'end' ? ay - height : ay - height / 2;
  return { x, y, width, height };
}

/** A frame as {@link placeBox} reads it. */
export function framePlaceable(frame: ResolvedFrame): Placeable {
  return {
    ...(frame.placement ? { placement: frame.placement } : {}),
    ...(frame.grid ? { grid: frame.grid } : {}),
    width: frame.width,
    height: frame.height,
    heightSet: frame.fieldPaths.height !== undefined || frame.placement?.size?.height !== undefined,
    ...(frame.minWidth ? { minWidth: frame.minWidth } : {}),
    ...(frame.maxWidth ? { maxWidth: frame.maxWidth } : {}),
    ...(frame.minHeight ? { minHeight: frame.minHeight } : {}),
    ...(frame.maxHeight ? { maxHeight: frame.maxHeight } : {}),
  };
}

/** A group's own box as {@link placeBox} reads it, or undefined when it has
 *  none (its box is then the union of its frames'). */
export function groupPlaceable(group: ResolvedFrameGroup): Placeable | undefined {
  if (!group.placement && !group.grid) return undefined;
  const size = group.placement?.size;
  const norm = (v: unknown): FrameSize => (v === 'auto' || v === 'fill' || (typeof v === 'object' && v !== null) ? (v as FrameSize) : 'fill');
  return {
    ...(group.placement ? { placement: group.placement } : {}),
    ...(group.grid ? { grid: group.grid } : {}),
    width: norm(size?.width),
    height: size?.height === undefined || size.height === 'auto' ? 'fill' : norm(size.height),
    heightSet: size?.height !== undefined,
  };
}

/** The frame of the same page a frame's content goes on in: its `next`,
 *  else an `overflow.continueIn` of the form `'#frame'` (the same thing). */
export function nextFrameOf(frame: Pick<ResolvedFrame, 'next' | 'overflow'>): string | undefined {
  return frame.next ?? continueInFrame(frame.overflow?.continueIn);
}

/** The smallest rectangle holding `rects` (undefined for none). */
export function unionRect(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The order frames are placed and typeset in: a frame after what it
 * anchors to (a group's frames, or the group's own anchor), after the frame
 * of its chain before it (`next`); frames that push text first; otherwise
 * template order. Anchor cycles (rejected by validation, settled by the
 * resolver) are broken where they close.
 */
export function frameOrder(template: Pick<ResolvedPageTemplate, 'frames' | 'groups'>): ResolvedFrame[] {
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const groups = new Map(template.groups.map((g) => [g.name, g]));
  const prev = new Map<string, string>();
  for (const f of template.frames) {
    const n = nextFrameOf(f);
    if (n && byName.has(n) && !prev.has(n)) prev.set(n, f.name);
  }
  const deps = (name: string, seenGroups: Set<string> = new Set()): string[] => {
    const out: string[] = [];
    const addTarget = (target: string | undefined): void => {
      if (!target) return;
      if (byName.has(target)) out.push(target);
      else {
        const g = groups.get(target);
        if (!g || seenGroups.has(g.name)) return;
        seenGroups.add(g.name);
        if (g.placement || g.grid) addTarget(g.grid ? undefined : anchorTarget(g.placement));
        else out.push(...g.frames.filter((m) => m !== name && byName.has(m)));
      }
    };
    const f = byName.get(name)!;
    if (!f.grid) addTarget(anchorTarget(f.placement));
    const p = prev.get(name);
    if (p) out.push(p);
    return out;
  };
  const out: ResolvedFrame[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string): void => {
    if (state.has(name)) return;
    state.set(name, 'visiting');
    for (const d of deps(name)) visit(d);
    state.set(name, 'done');
    out.push(byName.get(name)!);
  };
  for (const f of template.frames) if (f.exclude === 'push') visit(f.name);
  for (const f of template.frames) visit(f.name);
  return out;
}

/**
 * Where every frame of `template` stands on a page before any content is
 * poured (#863: the Sandbox's template thumbnails and editor): the frames
 * placed in {@link frameOrder}, a group without a box of its own taking the
 * union of its frames. An `'auto'` height takes `natural(frame, width)`;
 * left out, a fifth of the area's height.
 */
export function templateFrameRects(
  template: Pick<ResolvedPageTemplate, 'frames' | 'groups' | 'grid'>,
  ctx: FrameGeometryContext,
  natural?: (frame: ResolvedFrame, width: number) => number,
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const groupRect = (name: string, seen: Set<string> = new Set()): Rect | undefined => {
    const g = template.groups.find((gr) => gr.name === name);
    if (!g || seen.has(name)) return undefined;
    seen.add(name);
    const own = groupPlaceable(g);
    if (own) return placeBox(own, template, ctx, (n) => rects.get(n) ?? groupRect(n, seen), () => 0);
    return unionRect(g.frames.flatMap((m) => (rects.has(m) ? [rects.get(m)!] : [])));
  };
  const fallback = ctx.areas.area.height / 5;
  for (const frame of frameOrder(template)) {
    const rect = placeBox(
      framePlaceable(frame),
      template,
      ctx,
      (n) => rects.get(n) ?? groupRect(n),
      (width) => (natural ? natural(frame, width) : fallback),
    );
    rects.set(frame.name, rect);
  }
  return rects;
}
