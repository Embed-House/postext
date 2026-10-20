/**
 * Helpers of the vector design block (`VDTDesignPathBlock`, DESIGN §12.1,
 * #1055) the backends and the passes that move, recolour or read design
 * blocks share: the outline of a marker, the SVG `d` of the outline, the
 * box of the ink, a quadratic curve as a cubic (PDF has no quadratic), and
 * moving every point of a block.
 */
import { createBoundingBox, type BoundingBox, type VDTDesignPathBlock, type VDTPathCommand, type VDTPathMarker } from '../vdt';

/** How long an arrowhead's base is against its length: 0.7, a head a
 *  little narrower than it is long. */
const ARROW_WIDTH_RATIO = 0.7;

/** The shape a marker fills: a dot is a circle `sizePx` across centred on
 *  the point; an arrow a triangle whose tip is the point, `sizePx` long
 *  along `angle`, its base `0.7 × sizePx` wide. */
export type PathMarkerOutline =
  | { kind: 'dot'; cx: number; cy: number; r: number }
  | { kind: 'arrow'; points: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] };

export function pathMarkerOutline(m: VDTPathMarker): PathMarkerOutline {
  const size = Math.max(0, m.sizePx);
  if (m.kind === 'dot') return { kind: 'dot', cx: m.x, cy: m.y, r: size / 2 };
  const dx = Math.cos(m.angle);
  const dy = Math.sin(m.angle);
  const bx = m.x - dx * size;
  const by = m.y - dy * size;
  const half = (size * ARROW_WIDTH_RATIO) / 2;
  return {
    kind: 'arrow',
    points: [
      { x: m.x, y: m.y },
      { x: bx - dy * half, y: by + dx * half },
      { x: bx + dy * half, y: by - dx * half },
    ],
  };
}

/** A number for an SVG path or attribute: at most three decimals. */
function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** The SVG path data of `subpaths`, shifted by `(-ox, -oy)` (an `<svg>`
 *  placed at `(ox, oy)` on the page). */
export function pathSvgData(subpaths: readonly (readonly VDTPathCommand[])[], ox = 0, oy = 0): string {
  const out: string[] = [];
  for (const sp of subpaths) {
    for (const c of sp) {
      switch (c.op) {
        case 'M':
        case 'L':
          out.push(`${c.op}${n(c.x - ox)} ${n(c.y - oy)}`);
          break;
        case 'C':
          out.push(`C${n(c.x1 - ox)} ${n(c.y1 - oy)} ${n(c.x2 - ox)} ${n(c.y2 - oy)} ${n(c.x - ox)} ${n(c.y - oy)}`);
          break;
        case 'Q':
          out.push(`Q${n(c.x1 - ox)} ${n(c.y1 - oy)} ${n(c.x - ox)} ${n(c.y - oy)}`);
          break;
        case 'Z':
          out.push('Z');
          break;
      }
    }
  }
  return out.join('');
}

/** The SVG path data of a marker's outline, shifted by `(-ox, -oy)`. */
export function markerSvgData(m: VDTPathMarker, ox = 0, oy = 0): string {
  const o = pathMarkerOutline(m);
  if (o.kind === 'dot') {
    const { cx, cy, r } = o;
    return `M${n(cx - r - ox)} ${n(cy - oy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r - ox)} ${n(cy - oy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r - ox)} ${n(cy - oy)}Z`;
  }
  const [a, b, c] = o.points;
  return `M${n(a.x - ox)} ${n(a.y - oy)}L${n(b.x - ox)} ${n(b.y - oy)}L${n(c.x - ox)} ${n(c.y - oy)}Z`;
}

/** The cubic Bézier of a quadratic one from `(x0, y0)` (control points at
 *  two thirds of the way to the quadratic's control point). */
export function quadToCubic(x0: number, y0: number, q: Extract<VDTPathCommand, { op: 'Q' }>): Extract<VDTPathCommand, { op: 'C' }> {
  return {
    op: 'C',
    x1: x0 + (2 / 3) * (q.x1 - x0),
    y1: y0 + (2 / 3) * (q.y1 - y0),
    x2: q.x + (2 / 3) * (q.x1 - q.x),
    y2: q.y + (2 / 3) * (q.y1 - q.y),
    x: q.x,
    y: q.y,
  };
}

/** The box of everything a path block inks: its points and control points
 *  (a curve stays inside them), grown by half the stroke's width (a square
 *  cap or a mitre may reach a little further: the box is for hit tests and
 *  clips, not a tight bound), and its markers. An empty block: a zero box
 *  at the origin. */
export function pathInkBox(block: Pick<VDTDesignPathBlock, 'subpaths' | 'stroke' | 'markers'>): BoundingBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, pad: number) => {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  };
  const half = block.stroke ? Math.max(0, block.stroke.widthPx) / 2 : 0;
  for (const sp of block.subpaths) {
    for (const c of sp) {
      if (c.op === 'Z') continue;
      add(c.x, c.y, half);
      if (c.op === 'C') {
        add(c.x1, c.y1, half);
        add(c.x2, c.y2, half);
      } else if (c.op === 'Q') {
        add(c.x1, c.y1, half);
      }
    }
  }
  for (const m of block.markers ?? []) {
    const o = pathMarkerOutline(m);
    if (o.kind === 'dot') add(o.cx, o.cy, o.r);
    else for (const p of o.points) add(p.x, p.y, 0);
  }
  if (x0 > x1) return createBoundingBox(0, 0, 0, 0);
  return createBoundingBox(x0, y0, x1 - x0, y1 - y0);
}

/** Every point of `block` (outline, control points, markers, `bbox`)
 *  moved by `(dx, dy)`, in place. */
export function offsetPathBlock(block: VDTDesignPathBlock, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  block.bbox.x += dx;
  block.bbox.y += dy;
  block.subpaths = block.subpaths.map((sp) => sp.map((c) => movedCommand(c, dx, dy)));
  if (block.markers) block.markers = block.markers.map((m) => ({ ...m, x: m.x + dx, y: m.y + dy }));
}

/** A copy of `block` with every point moved by `(dx, dy)`. */
export function translatedPathBlock(block: VDTDesignPathBlock, dx: number, dy: number): VDTDesignPathBlock {
  const out: VDTDesignPathBlock = { ...block, bbox: { ...block.bbox } };
  offsetPathBlock(out, dx, dy);
  return out;
}

function movedCommand(c: VDTPathCommand, dx: number, dy: number): VDTPathCommand {
  switch (c.op) {
    case 'M':
    case 'L':
      return { op: c.op, x: c.x + dx, y: c.y + dy };
    case 'C':
      return { op: 'C', x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
    case 'Q':
      return { op: 'Q', x1: c.x1 + dx, y1: c.y1 + dy, x: c.x + dx, y: c.y + dy };
    case 'Z':
      return c;
  }
}

/** The colours `block` inks: its fill, its stroke and its markers'. */
export function pathBlockColors(block: VDTDesignPathBlock): string[] {
  const out: string[] = [];
  if (block.fill) out.push(block.fill);
  if (block.stroke && block.stroke.widthPx > 0) out.push(block.stroke.color);
  for (const m of block.markers ?? []) out.push(m.color);
  return out;
}

/** Each colour of `block` (fill, stroke, markers) through `map`, in place. */
export function recolorPathBlock(block: VDTDesignPathBlock, map: (color: string) => string): void {
  if (block.fill) block.fill = map(block.fill);
  if (block.stroke) block.stroke = { ...block.stroke, color: map(block.stroke.color) };
  if (block.markers) block.markers = block.markers.map((m) => ({ ...m, color: map(m.color) }));
}

/** How many straight pieces a curve is read as in {@link pathHit}. */
const CURVE_STEPS = 16;

interface Polyline {
  points: { x: number; y: number }[];
  closed: boolean;
}

/** The outline of `subpaths` as polylines (curves sampled), one per
 *  subpath, with whether each is closed. */
function flatten(subpaths: readonly (readonly VDTPathCommand[])[]): Polyline[] {
  const out: Polyline[] = [];
  for (const sp of subpaths) {
    let cur: Polyline | undefined;
    let x = 0;
    let y = 0;
    for (const c of sp) {
      if (c.op === 'Z') {
        if (cur) cur.closed = true;
        continue;
      }
      if (c.op === 'M') {
        cur = { points: [{ x: c.x, y: c.y }], closed: false };
        out.push(cur);
      } else {
        if (!cur) {
          cur = { points: [{ x, y }], closed: false };
          out.push(cur);
        }
        if (c.op === 'L') {
          cur.points.push({ x: c.x, y: c.y });
        } else {
          const k = c.op === 'Q' ? quadToCubic(x, y, c) : (c as Extract<VDTPathCommand, { op: 'C' }>);
          for (let i = 1; i <= CURVE_STEPS; i++) {
            const t = i / CURVE_STEPS;
            const u = 1 - t;
            cur.points.push({
              x: u * u * u * x + 3 * u * u * t * k.x1 + 3 * u * t * t * k.x2 + t * t * t * k.x,
              y: u * u * u * y + 3 * u * u * t * k.y1 + 3 * u * t * t * k.y2 + t * t * t * k.y,
            });
          }
        }
      }
      x = c.x;
      y = c.y;
    }
  }
  return out;
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Whether `p` falls on the ink of `block`: inside its fill (by its fill
 * rule), within half its stroke's width of its outline (at least
 * `tolerancePx`, so a hairline can be hit), or on a marker. A point in the
 * block's box but off its ink (between the arms of a connector) misses,
 * so a path never takes a click meant for what lies under it.
 */
export function pathHit(block: VDTDesignPathBlock, p: { x: number; y: number }, tolerancePx = 2): boolean {
  const lines = flatten(block.subpaths);
  if (block.fill) {
    let winding = 0;
    let crossings = 0;
    for (const l of lines) {
      const pts = l.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if ((a.y <= p.y) !== (b.y <= p.y)) {
          const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
          if (x > p.x) {
            crossings++;
            winding += b.y > a.y ? 1 : -1;
          }
        }
      }
    }
    if (block.fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0) return true;
  }
  if (block.stroke && block.stroke.widthPx > 0) {
    const reach = Math.max(block.stroke.widthPx / 2, tolerancePx);
    for (const l of lines) {
      const pts = l.points;
      const n = l.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        if (segmentDistance(p, pts[i]!, pts[(i + 1) % pts.length]!) <= reach) return true;
      }
    }
  }
  for (const m of block.markers ?? []) {
    const o = pathMarkerOutline(m);
    if (o.kind === 'dot') {
      if (Math.hypot(p.x - o.cx, p.y - o.cy) <= Math.max(o.r, tolerancePx)) return true;
      continue;
    }
    const [a, b, c] = o.points;
    const side = (u: { x: number; y: number }, v: { x: number; y: number }) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
    const s1 = side(a, b);
    const s2 = side(b, c);
    const s3 = side(c, a);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  }
  return false;
}
