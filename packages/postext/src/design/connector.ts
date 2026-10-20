/**
 * Connectors of a composed page's decoration (#1056, DESIGN §12.3): the
 * lines of a tree diagram, an org chart, a timeline, a flow chart, laid
 * between the final boxes of the frames they join and painted as a
 * `VDTDesignPathBlock`.
 *
 * Pure geometry: the boxes come in (sheet px), the outline and the end
 * marks go out. Routing:
 * - `straight`: one segment from end to end;
 * - `elbow`: across, along, across again between two sides that face the
 *   same way or each other (the middle run `trunk` of the way), an L
 *   between a side and one across it;
 * - `tree`: a trunk from the parent (`from`) to a bar `trunk` of the way to
 *   the nearest child, the bar over the children's points (and the
 *   parent's when it stands outside them), one drop to each child; a child
 *   whose point is on the bar's line has none.
 * A bend is rounded by `radius` (a quarter circle as a cubic), held to what
 * the segments beside it leave.
 */
import type { ConnectorEnd, Dimension, LineCap, ResolvedDesignConnectorElement } from '../types';
import type { VDTPathCommand, VDTPathMarker } from '../vdt';
import { dimensionToPx } from '../units';
import { sideFraction } from './logicalEdges';
import { pathInkBox } from './pathBlock';
import type { ResolvedPathPrimitive } from './layout';

export interface ConnectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/** Line width of a connector that sets none: 0.75 pt. */
export const DEFAULT_CONNECTOR_WIDTH: Dimension = { value: 0.75, unit: 'pt' };
/** A cap's size against the line width when `capSize` is not set. */
export const DEFAULT_CAP_SIZE_PER_WIDTH = 3;
const CAP_SIZE_PER_WIDTH = DEFAULT_CAP_SIZE_PER_WIDTH;
/** How far an arrowhead's line stops short of the tip, of the head's
 *  length: the line ends inside the head, so its square end never shows
 *  beside the point. */
const ARROW_INSET = 0.6;

export const CONNECTOR_ROUTINGS = ['straight', 'elbow', 'tree'] as const;
export const CONNECTOR_CAPS = ['none', 'dot', 'arrow'] as const;
export const CONNECTOR_SIDES = ['top', 'bottom', 'left', 'right', 'start', 'end'] as const;
/** How a label's leader runs (#1057). */
export const LEADER_ROUTINGS = ['straight', 'elbow'] as const;

const EPS = 0.01;

function px(d: unknown, dpi: number): number | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const { value, unit } = d as { value?: unknown; unit?: unknown };
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string') return undefined;
  const v = dimensionToPx(d as Dimension, dpi);
  return Number.isFinite(v) ? v : undefined;
}

function capOf(v: unknown): LineCap {
  return v === 'dot' || v === 'arrow' ? v : 'none';
}

/** The physical side of a written one: `start` / `end` follow the page's
 *  lines (`startRight`: the start is the right). Anything else: none. */
function physicalSide(side: unknown, startRight: boolean): Side | undefined {
  if (side === 'top' || side === 'bottom' || side === 'left' || side === 'right') return side;
  if (side === 'start') return startRight ? 'right' : 'left';
  if (side === 'end') return startRight ? 'left' : 'right';
  return undefined;
}

/** The side of `a` that faces `b`: the axis with the wider clear gap
 *  between the two (a tie goes to the vertical one), else, for boxes that
 *  overlap on both axes, the axis their centres are further apart on. */
export function facingSide(a: ConnectorRect, b: ConnectorRect): Side {
  const down = b.y - (a.y + a.height);
  const up = a.y - (b.y + b.height);
  const right = b.x - (a.x + a.width);
  const left = a.x - (b.x + b.width);
  const v = Math.max(down, up);
  const h = Math.max(right, left);
  if (v > 0 || h > 0) {
    if (v >= h) return down >= up ? 'bottom' : 'top';
    return right >= left ? 'right' : 'left';
  }
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'bottom' : 'top';
  return dx >= 0 ? 'right' : 'left';
}

/** The point of `side` of `box` at `at` (default its middle; a horizontal
 *  side starts on the right when `startRight`), `gap` out from the edge. */
function sidePoint(box: ConnectorRect, side: Side, at: unknown, gap: number, startRight: boolean): Pt {
  const f = sideFraction(at) ?? 0.5;
  switch (side) {
    case 'top':
      return { x: box.x + (startRight ? 1 - f : f) * box.width, y: box.y - gap };
    case 'bottom':
      return { x: box.x + (startRight ? 1 - f : f) * box.width, y: box.y + box.height + gap };
    case 'left':
      return { x: box.x - gap, y: box.y + f * box.height };
    default:
      return { x: box.x + box.width + gap, y: box.y + f * box.height };
  }
}

export interface Pt {
  x: number;
  y: number;
}

const vertical = (s: Side): boolean => s === 'top' || s === 'bottom';

/** `points` with repeated points and the middle of straight runs left
 *  out. */
function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < EPS && dot > 0) out.splice(i, 1);
  }
  return out;
}

/** Circle-quadrant constant of a cubic Bézier. */
const KAPPA = 0.5522847498;

/** The commands of a polyline, each bend rounded by `radius` (held to half
 *  a segment between two bends, the whole of an end segment). */
export function polylineCommands(points: readonly Pt[], radius: number): VDTPathCommand[] {
  const pts = simplify(points);
  if (pts.length < 2) return [];
  const cmds: VDTPathCommand[] = [{ op: 'M', x: pts[0]!.x, y: pts[0]!.y }];
  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const inLen = len(a, b);
    const outLen = len(b, c);
    const r = Math.max(0, Math.min(radius, i - 1 > 0 ? inLen / 2 : inLen, i + 1 < pts.length - 1 ? outLen / 2 : outLen));
    if (r < EPS) {
      cmds.push({ op: 'L', x: b.x, y: b.y });
      continue;
    }
    const din = { x: (b.x - a.x) / inLen, y: (b.y - a.y) / inLen };
    const dout = { x: (c.x - b.x) / outLen, y: (c.y - b.y) / outLen };
    const p0 = { x: b.x - din.x * r, y: b.y - din.y * r };
    const p1 = { x: b.x + dout.x * r, y: b.y + dout.y * r };
    cmds.push({ op: 'L', x: p0.x, y: p0.y });
    cmds.push({ op: 'C', x1: p0.x + din.x * r * KAPPA, y1: p0.y + din.y * r * KAPPA, x2: p1.x - dout.x * r * KAPPA, y2: p1.y - dout.y * r * KAPPA, x: p1.x, y: p1.y });
  }
  const last = pts[pts.length - 1]!;
  cmds.push({ op: 'L', x: last.x, y: last.y });
  return cmds;
}

/** An end of a polyline marked with a cap: the mark, and the line pulled
 *  back inside an arrowhead. `ends`: 0 the first point, 1 the last. */
export function capEnd(points: Pt[], which: 0 | 1, cap: LineCap, size: number, color: string, marks: VDTPathMarker[]): void {
  const pts = simplify(points);
  if (cap === 'none' || pts.length < 2) return;
  const tip = which === 0 ? pts[0]! : pts[pts.length - 1]!;
  const from = which === 0 ? pts[1]! : pts[pts.length - 2]!;
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  marks.push({ kind: cap, x: tip.x, y: tip.y, angle, sizePx: size, color });
  if (cap !== 'arrow') return;
  const segment = Math.hypot(tip.x - from.x, tip.y - from.y);
  const back = Math.min(size * ARROW_INSET, segment);
  const moved = { x: tip.x - Math.cos(angle) * back, y: tip.y - Math.sin(angle) * back };
  // The original arrays hold the same point objects `simplify` kept.
  const at = which === 0 ? points.indexOf(tip) : points.lastIndexOf(tip);
  if (at >= 0) points[at] = moved;
}

/** One end ready to be laid: its box and what it asks of the side. */
export interface ConnectorEndBox {
  name: string;
  box: ConnectorRect;
  end: ConnectorEnd;
}

export interface ConnectorLayoutOptions {
  dpi: number;
  /** The page's lines start on the right (`start` / `end` sides, `at` along
   *  a horizontal side). */
  startRight: boolean;
}

/** Whether a connector is painted over the frames (#1076): its `over`
 *  when it is a boolean, else whether an end as written (`from`, any `to`)
 *  names a picture's `anchor`, a point inside a frame that would cover a
 *  line painted under it. Read from the element, not from the ends the
 *  page keeps, so a dropped end does not change the layer. */
export function connectorPaintsOver(el: Pick<ResolvedDesignConnectorElement, 'over' | 'from' | 'to'>): boolean {
  if (typeof el.over === 'boolean') return el.over;
  const anchored = (end: unknown): boolean => {
    const anchor = (end as { anchor?: unknown } | null | undefined)?.anchor;
    return typeof anchor === 'string' && anchor.trim() !== '';
  };
  return anchored(el.from) || (Array.isArray(el.to) ? el.to.some(anchored) : anchored(el.to));
}

/** The outline and marks of `el` between `from` and `to` (every end that
 *  the page has, in order), or undefined when nothing is left to draw. */
export function layoutConnector(el: ResolvedDesignConnectorElement, from: ConnectorEndBox, to: readonly ConnectorEndBox[], opts: ConnectorLayoutOptions): ResolvedPathPrimitive | undefined {
  if (to.length === 0) return undefined;
  const { dpi, startRight } = opts;
  const widthPx = Math.max(0, px(el.width, dpi) ?? dimensionToPx(DEFAULT_CONNECTOR_WIDTH, dpi));
  const capSize = Math.max(0, px(el.capSize, dpi) ?? widthPx * CAP_SIZE_PER_WIDTH);
  const radius = Math.max(0, px(el.radius, dpi) ?? 0);
  const trunk = typeof el.trunk === 'number' && Number.isFinite(el.trunk) ? Math.max(0, Math.min(1, el.trunk)) : 0.5;
  const routing = el.routing === 'straight' || el.routing === 'tree' ? el.routing : 'elbow';
  const color = el.color?.hex ?? '#000000';
  const startCap = capOf(el.startCap);
  const endCap = capOf(el.endCap);
  const gapOf = (e: ConnectorEnd): number => Math.max(0, px(e.gap, dpi) ?? 0);
  const sideOf = (e: ConnectorEndBox, other: ConnectorRect): Side => physicalSide(e.end.side, startRight) ?? facingSide(e.box, other);
  // An end at a point of a picture (#1057): a box of no size. With no
  // side written, the line arrives on the axis it leaves the other end by
  // (a note's side points along a horizontal line to the point), from the
  // side the other end stands on.
  const isPoint = (e: ConnectorEndBox): boolean => e.box.width === 0 && e.box.height === 0 && physicalSide(e.end.side, startRight) === undefined;
  const arriving = (p: Pt, otherSide: Side, other: Pt): Side =>
    (vertical(otherSide) ? (other.y <= p.y ? 'top' : 'bottom') : (other.x <= p.x ? 'left' : 'right'));
  const point = (e: ConnectorEndBox, side: Side): Pt => sidePoint(e.box, side, e.end.at, gapOf(e.end), startRight);

  const lines: Pt[][] = [];
  const marks: VDTPathMarker[] = [];
  if (routing === 'tree') {
    const union = to.reduce<ConnectorRect>((u, e) => {
      const x = Math.min(u.x, e.box.x);
      const y = Math.min(u.y, e.box.y);
      return { x, y, width: Math.max(u.x + u.width, e.box.x + e.box.width) - x, height: Math.max(u.y + u.height, e.box.y + e.box.height) - y };
    }, { ...to[0]!.box });
    const ps = sideOf(from, union);
    const p = point(from, ps);
    // The axis the trunk runs along (`n`, away from the parent) and the
    // one the bar runs along (`t`).
    const n = ps === 'bottom' ? { x: 0, y: 1 } : ps === 'top' ? { x: 0, y: -1 } : ps === 'right' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    const along = (q: Pt) => q.x * n.x + q.y * n.y;
    const across = (q: Pt) => (vertical(ps) ? q.x : q.y);
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const kids = to.map((e) => point(e, isPoint(e) ? opposite[ps] : physicalSide(e.end.side, startRight) ?? facingSide(e.box, from.box)));
    const reach = Math.min(...kids.map((k) => along(k) - along(p)));
    const bar = along(p) + trunk * reach;
    const onBar = (c: number): Pt => (vertical(ps) ? { x: c, y: bar * n.y } : { x: bar * n.x, y: c });
    // Items on the bar: the parent and each child, by where they stand
    // across. The outermost two hang from the bar's ends (one polyline,
    // its bends rounded); the others drop straight.
    const items = [{ pt: p, parent: true }, ...kids.map((pt) => ({ pt, parent: false }))];
    let lo = 0;
    let hi = 0;
    items.forEach((it, i) => {
      if (across(it.pt) < across(items[lo]!.pt) - EPS) lo = i;
      if (across(it.pt) > across(items[hi]!.pt) + EPS) hi = i;
    });
    const capFor = (i: number): LineCap => (items[i]!.parent ? startCap : endCap);
    if (Math.abs(bar - along(p)) < EPS) {
      // `trunk: 0`: the bar would run along the parent's own side (under
      // the frame): no bar, a drop from that side to each child (a
      // timeline's ticks), the start mark at the head of each drop.
      for (const k of kids) {
        const drop = [onBar(across(k)), k];
        capEnd(drop, 0, startCap, capSize, color, marks);
        capEnd(drop, 1, endCap, capSize, color, marks);
        lines.push(drop);
      }
    } else if (lo === hi) {
      // Every point at one place across: one line from the parent through
      // the bar to each child.
      for (const k of kids) {
        const line = [p, onBar(across(p)), k];
        capEnd(line, 0, startCap, capSize, color, marks);
        capEnd(line, 1, endCap, capSize, color, marks);
        lines.push(line);
      }
    } else {
      const main = [items[lo]!.pt, onBar(across(items[lo]!.pt)), onBar(across(items[hi]!.pt)), items[hi]!.pt];
      capEnd(main, 0, capFor(lo), capSize, color, marks);
      capEnd(main, 1, capFor(hi), capSize, color, marks);
      lines.push(main);
      items.forEach((it, i) => {
        if (i === lo || i === hi) return;
        const foot = onBar(across(it.pt));
        if (Math.abs(along(it.pt) - bar) < EPS) return;
        const drop = [foot, it.pt];
        capEnd(drop, 1, capFor(i), capSize, color, marks);
        lines.push(drop);
      });
    }
  } else {
    to.forEach((e) => {
      let s0 = sideOf(from, e.box);
      let s1 = sideOf(e, from.box);
      if (isPoint(e) && !isPoint(from)) s1 = arriving({ x: e.box.x, y: e.box.y }, s0, point(from, s0));
      else if (isPoint(from) && !isPoint(e)) s0 = arriving({ x: from.box.x, y: from.box.y }, s1, point(e, s1));
      const a = point(from, s0);
      const b = point(e, s1);
      let line: Pt[];
      if (routing === 'straight') line = [a, b];
      else if (vertical(s0) && vertical(s1)) {
        const y = a.y + trunk * (b.y - a.y);
        line = [a, { x: a.x, y }, { x: b.x, y }, b];
      } else if (!vertical(s0) && !vertical(s1)) {
        const x = a.x + trunk * (b.x - a.x);
        line = [a, { x, y: a.y }, { x, y: b.y }, b];
      } else line = vertical(s0) ? [a, { x: a.x, y: b.y }, b] : [a, { x: b.x, y: a.y }, b];
      // A fan of lines from one end marks each line's start (one mark
      // where they leave the same way).
      capEnd(line, 0, startCap, capSize, color, marks);
      capEnd(line, 1, endCap, capSize, color, marks);
      lines.push(line);
    });
  }
  const seen = new Set<string>();
  const uniqueMarks = marks.filter((m) => {
    const key = `${m.kind}|${Math.round(m.x * 100)}|${Math.round(m.y * 100)}|${Math.round(m.angle * 1000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  marks.length = 0;
  marks.push(...uniqueMarks);
  const subpaths = lines.map((l) => polylineCommands(l, routing === 'straight' ? 0 : radius)).filter((sp) => sp.length > 0);
  if (subpaths.length === 0 && marks.length === 0) return undefined;
  const dash = Array.isArray(el.dash) ? el.dash.map((d) => px(d, dpi)).filter((v): v is number => v !== undefined && v >= 0) : [];
  const stroke = {
    color,
    widthPx,
    ...(dash.length > 0 && dash.some((v) => v > 0) ? { dash } : {}),
    // Rounded bends join round; square ones keep their corner.
    ...(radius > 0 && routing !== 'straight' ? { join: 'round' as const } : {}),
  };
  const box = pathInkBox({ subpaths, stroke, markers: marks });
  return {
    id: el.id,
    kind: 'path',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    subpaths,
    stroke,
    ...(marks.length > 0 ? { markers: marks } : {}),
    ...(connectorPaintsOver(el) ? { over: true as const } : {}),
  };
}
