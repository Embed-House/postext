/**
 * SVG path data (`d`) read into the commands of a vector design block
 * (`VDTPathCommand`, DESIGN §12.8, #1060): `M L H V C S Q T A Z`, absolute
 * and relative, with implicit repeats (`M0 0 1 1` is a move and a line).
 * Horizontal and vertical lines become lines, the smooth curves (`S`, `T`)
 * their full cubic and quadratic with the reflected control point, an arc
 * cubic curves of at most a quarter turn each. The outcome is in the units
 * the data is written in (a design element's `viewBox`); `mapPath` places
 * it on the page.
 *
 * One pass over the characters, no regular expressions: the time is linear
 * in the length of the data, whatever it holds. Data that breaks the
 * grammar (a letter that is no command, a command short of its numbers, a
 * path that does not open with a move, an arc flag other than 0 or 1)
 * yields an error and no outline: a design draws nothing rather than half
 * a shape.
 */
import type { VDTPathCommand } from '../vdt';

/** The longest path data read (characters): a design's shape is a few
 *  hundred; anything far longer is no decoration. */
export const MAX_PATH_DATA_LENGTH = 65536;

export type SvgPathParse =
  | { ok: true; subpaths: VDTPathCommand[][] }
  | { ok: false; error: string; at: number };

/** How many numbers each command takes. */
const ARITY: Readonly<Record<string, number>> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isSpace(c: number): boolean {
  // Space, tab, line feed, form feed, carriage return (the SVG `wsp`).
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

/** Reads the data one token at a time. */
class Scanner {
  i = 0;
  constructor(readonly s: string) {}

  /** Skips white space and at most one comma between them. */
  skipSeparators(): void {
    const s = this.s;
    while (this.i < s.length && isSpace(s.charCodeAt(this.i))) this.i++;
    if (this.i < s.length && s.charCodeAt(this.i) === 44) {
      this.i++;
      while (this.i < s.length && isSpace(s.charCodeAt(this.i))) this.i++;
    }
  }

  atEnd(): boolean {
    return this.i >= this.s.length;
  }

  /** Whether a number starts here (a sign, a digit or a point). */
  atNumber(): boolean {
    const c = this.s.charCodeAt(this.i);
    return isDigit(c) || c === 43 || c === 45 || c === 46;
  }

  /** A number in the SVG grammar: sign, digits, a fraction, an exponent.
   *  `undefined` when none starts here. */
  number(): number | undefined {
    const s = this.s;
    const start = this.i;
    let j = start;
    if (j < s.length && (s.charCodeAt(j) === 43 || s.charCodeAt(j) === 45)) j++;
    let digits = 0;
    while (j < s.length && isDigit(s.charCodeAt(j))) { j++; digits++; }
    if (j < s.length && s.charCodeAt(j) === 46) {
      j++;
      while (j < s.length && isDigit(s.charCodeAt(j))) { j++; digits++; }
    }
    if (digits === 0) return undefined;
    // An exponent only when digits follow it (`1e` is the number 1 and a
    // stray letter, which the caller rejects).
    if (j < s.length && (s.charCodeAt(j) === 101 || s.charCodeAt(j) === 69)) {
      let k = j + 1;
      if (k < s.length && (s.charCodeAt(k) === 43 || s.charCodeAt(k) === 45)) k++;
      const e0 = k;
      while (k < s.length && isDigit(s.charCodeAt(k))) k++;
      if (k > e0) j = k;
    }
    const v = Number(s.slice(start, j));
    if (!Number.isFinite(v)) return undefined;
    this.i = j;
    return v;
  }

  /** An arc flag: a single `0` or `1`, which needs no separator after it
   *  (`a1 1 0 01 1 1`). */
  flag(): 0 | 1 | undefined {
    const c = this.s.charCodeAt(this.i);
    if (c === 48 || c === 49) {
      this.i++;
      return c === 48 ? 0 : 1;
    }
    return undefined;
  }
}

/** The outline `d` describes, in its own units; or why it cannot be read. */
export function parseSvgPath(d: string): SvgPathParse {
  if (typeof d !== 'string') return { ok: false, error: 'path data is not a string', at: 0 };
  if (d.length > MAX_PATH_DATA_LENGTH) return { ok: false, error: `path data longer than ${MAX_PATH_DATA_LENGTH} characters`, at: MAX_PATH_DATA_LENGTH };
  const sc = new Scanner(d);
  const subpaths: VDTPathCommand[][] = [];
  let current: VDTPathCommand[] | undefined;
  // The current point, the subpath's start, and the last control point of
  // a cubic or quadratic (for `S` and `T`).
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCubic: { x: number; y: number } | undefined;
  let lastQuad: { x: number; y: number } | undefined;
  let cmd = '';
  let first = true;

  const startSubpath = (px: number, py: number) => {
    current = [{ op: 'M', x: px, y: py }];
    subpaths.push(current);
  };
  /** A drawing command after `Z` starts again from the subpath's start. */
  const ensureSubpath = () => {
    if (!current) startSubpath(x, y);
    return current!;
  };

  sc.skipSeparators();
  while (!sc.atEnd()) {
    const at = sc.i;
    const ch = d.charAt(sc.i);
    const upper = ch.toUpperCase();
    if (ARITY[upper] !== undefined && ch !== 'e' && ch !== 'E') {
      cmd = ch;
      sc.i++;
      sc.skipSeparators();
    } else if (!cmd || !sc.atNumber()) {
      return { ok: false, error: `unexpected '${ch}'`, at };
    } else if (cmd === 'Z' || cmd === 'z') {
      return { ok: false, error: 'numbers after a close', at };
    }
    // An implicit repeat of a move is a line (SVG 1.1 §8.3.2).
    const op = cmd.toUpperCase();
    const rel = cmd !== op;
    if (first && op !== 'M') return { ok: false, error: 'path data must start with a move (M or m)', at };
    first = false;

    if (op === 'Z') {
      if (current) current.push({ op: 'Z' });
      x = sx;
      y = sy;
      current = undefined;
      lastCubic = undefined;
      lastQuad = undefined;
      continue;
    }

    // Every set of numbers the command takes, until the next letter.
    let sets = 0;
    do {
      const args: number[] = [];
      const n = ARITY[op]!;
      for (let k = 0; k < n; k++) {
        const isFlag = op === 'A' && (k === 3 || k === 4);
        const v = isFlag ? sc.flag() : sc.number();
        if (v === undefined) {
          return { ok: false, error: isFlag ? `arc flag must be 0 or 1` : `'${cmd}' needs ${n} numbers`, at: sc.i };
        }
        args.push(v);
        sc.skipSeparators();
      }
      sets++;
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      switch (op) {
        case 'M': {
          const px = ox + args[0]!;
          const py = oy + args[1]!;
          if (sets === 1) {
            startSubpath(px, py);
            sx = px;
            sy = py;
          } else {
            ensureSubpath().push({ op: 'L', x: px, y: py });
          }
          x = px; y = py;
          lastCubic = undefined; lastQuad = undefined;
          break;
        }
        case 'L':
        case 'H':
        case 'V': {
          const px = op === 'V' ? x : ox + args[0]!;
          const py = op === 'H' ? y : op === 'V' ? (rel ? y : 0) + args[0]! : oy + args[1]!;
          ensureSubpath().push({ op: 'L', x: px, y: py });
          x = px; y = py;
          lastCubic = undefined; lastQuad = undefined;
          break;
        }
        case 'C':
        case 'S': {
          let x1: number;
          let y1: number;
          let rest: number[];
          if (op === 'C') {
            x1 = ox + args[0]!; y1 = oy + args[1]!;
            rest = args.slice(2);
          } else {
            x1 = lastCubic ? 2 * x - lastCubic.x : x;
            y1 = lastCubic ? 2 * y - lastCubic.y : y;
            rest = args;
          }
          const x2 = ox + rest[0]!;
          const y2 = oy + rest[1]!;
          const px = ox + rest[2]!;
          const py = oy + rest[3]!;
          ensureSubpath().push({ op: 'C', x1, y1, x2, y2, x: px, y: py });
          lastCubic = { x: x2, y: y2 };
          lastQuad = undefined;
          x = px; y = py;
          break;
        }
        case 'Q':
        case 'T': {
          let x1: number;
          let y1: number;
          let px: number;
          let py: number;
          if (op === 'Q') {
            x1 = ox + args[0]!; y1 = oy + args[1]!;
            px = ox + args[2]!; py = oy + args[3]!;
          } else {
            x1 = lastQuad ? 2 * x - lastQuad.x : x;
            y1 = lastQuad ? 2 * y - lastQuad.y : y;
            px = ox + args[0]!; py = oy + args[1]!;
          }
          ensureSubpath().push({ op: 'Q', x1, y1, x: px, y: py });
          lastQuad = { x: x1, y: y1 };
          lastCubic = undefined;
          x = px; y = py;
          break;
        }
        case 'A': {
          const px = ox + args[5]!;
          const py = oy + args[6]!;
          const sub = ensureSubpath();
          for (const c of arcToCubics(x, y, args[0]!, args[1]!, args[2]!, args[3] === 1, args[4] === 1, px, py)) sub.push(c);
          x = px; y = py;
          lastCubic = undefined; lastQuad = undefined;
          break;
        }
      }
    } while (!sc.atEnd() && sc.atNumber());
  }
  if (first) return { ok: false, error: 'empty path data', at: 0 };
  return { ok: true, subpaths };
}

/**
 * An elliptical arc from `(x0, y0)` to `(x, y)` as cubic Bézier curves
 * (SVG 1.1 implementation notes F.6): radii scaled up when too small to
 * reach, a zero radius a straight line, the same point nothing. Each curve
 * spans at most a quarter turn.
 */
export function arcToCubics(
  x0: number, y0: number, rxIn: number, ryIn: number, angleDeg: number,
  largeArc: boolean, sweep: boolean, x: number, y: number,
): VDTPathCommand[] {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ op: 'L', x, y }];
  const phi = ((angleDeg % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // The end points in the ellipse's own frame, centred between them.
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  // The control arm of a curve over `step`: 4/3 tan(step/4).
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return { x: cx + cos * ex - sin * ey, y: cy + sin * ex + cos * ey };
  };
  const tangent = (t: number) => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return { x: cos * ex - sin * ey, y: sin * ex + cos * ey };
  };
  const out: VDTPathCommand[] = [];
  let t = theta1;
  let p = { x: x0, y: y0 };
  for (let s = 0; s < segments; s++) {
    const t2 = t + step;
    const d1 = tangent(t);
    const d2 = tangent(t2);
    // The last curve ends exactly on the given point.
    const q = s === segments - 1 ? { x, y } : point(t2);
    out.push({ op: 'C', x1: p.x + k * d1.x, y1: p.y + k * d1.y, x2: q.x - k * d2.x, y2: q.y - k * d2.y, x: q.x, y: q.y });
    p = q;
    t = t2;
  }
  return out;
}

/** `subpaths` mapped by `x' = ox + x·sx`, `y' = oy + y·sy` (a viewBox laid
 *  on a box: an affine map, under which a Bézier curve stays one). */
export function mapPath(subpaths: readonly (readonly VDTPathCommand[])[], ox: number, oy: number, sx: number, sy: number): VDTPathCommand[][] {
  const X = (v: number) => ox + v * sx;
  const Y = (v: number) => oy + v * sy;
  return subpaths.map((sp) => sp.map((c): VDTPathCommand => {
    switch (c.op) {
      case 'M':
      case 'L':
        return { op: c.op, x: X(c.x), y: Y(c.y) };
      case 'C':
        return { op: 'C', x1: X(c.x1), y1: Y(c.y1), x2: X(c.x2), y2: Y(c.y2), x: X(c.x), y: Y(c.y) };
      case 'Q':
        return { op: 'Q', x1: X(c.x1), y1: Y(c.y1), x: X(c.x), y: Y(c.y) };
      case 'Z':
        return { op: 'Z' };
    }
  }));
}

/** Parses kept per data string: the same running-head chevrons are laid on
 *  every page. Cleared whole when it grows past this many. */
const CACHE_LIMIT = 256;
const cache = new Map<string, SvgPathParse>();

/** `parseSvgPath`, remembered per data string. The outline returned is
 *  shared: map it (`mapPath`), never change it. */
export function parseSvgPathCached(d: string): SvgPathParse {
  const hit = cache.get(d);
  if (hit) return hit;
  const r = parseSvgPath(d);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(d, r);
  return r;
}

/** The `viewBox` a path element is written in: `[1, 1]` when unset, none
 *  when either side is not a positive finite number. */
export function pathViewBox(vb: unknown): [number, number] | undefined {
  if (vb === undefined) return [1, 1];
  if (!Array.isArray(vb) || vb.length !== 2) return undefined;
  const [w, h] = vb as unknown[];
  if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return [w, h];
}
