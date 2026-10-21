import { describe, it, expect } from 'vitest';
import { arcToCubics, mapPath, parseSvgPath, pathViewBox } from '../../design/svgPath.js';
import type { VDTPathCommand } from '../../vdt.js';

// SVG path data read into the vector block's commands (#1060).

const ok = (d: string): VDTPathCommand[][] => {
  const r = parseSvgPath(d);
  if (!r.ok) throw new Error(`${d}: ${r.error} at ${r.at}`);
  return r.subpaths;
};
const round = (sp: VDTPathCommand[][]) => JSON.parse(JSON.stringify(sp, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))) as VDTPathCommand[][];

describe('parseSvgPath: lines and moves (#1060)', () => {
  it('reads absolute moves, lines, horizontal and vertical lines and a close', () => {
    expect(ok('M0 0 L1 0 H1 V1 H0 Z')).toEqual([[
      { op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 1 }, { op: 'L', x: 0, y: 1 }, { op: 'Z' },
    ]]);
  });

  it('reads relative commands from the current point', () => {
    expect(ok('m1 1 l2 0 h-1 v3 z')).toEqual([[
      { op: 'M', x: 1, y: 1 }, { op: 'L', x: 3, y: 1 }, { op: 'L', x: 2, y: 1 }, { op: 'L', x: 2, y: 4 }, { op: 'Z' },
    ]]);
  });

  it('repeats a command over every set of numbers; a repeated move draws lines', () => {
    expect(ok('M0 0 1 0 1 1')).toEqual([[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 1 }]]);
    expect(ok('m0 0 1 0 0 1')).toEqual([[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 1 }]]);
    expect(ok('M0,0L1,0,1,1')).toEqual([[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 1 }]]);
  });

  it('reads compact numbers: signs and points as separators, exponents', () => {
    expect(ok('M.5.5L-1-1l1e1 2E-1')).toEqual([[{ op: 'M', x: 0.5, y: 0.5 }, { op: 'L', x: -1, y: -1 }, { op: 'L', x: 9, y: -0.8 }]]);
  });

  it('starts a new subpath on each move, and a command after a close from the subpath’s start', () => {
    const sp = ok('M0 0 L1 0 Z L1 1 M5 5 l1 1');
    expect(sp).toHaveLength(3);
    expect(sp[1]).toEqual([{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 1 }]);
    expect(sp[2]).toEqual([{ op: 'M', x: 5, y: 5 }, { op: 'L', x: 6, y: 6 }]);
    // A relative move after a close starts from the closed subpath's start.
    expect(ok('M2 2 L3 2 z m1 0')[1]).toEqual([{ op: 'M', x: 3, y: 2 }]);
  });
});

describe('parseSvgPath: curves (#1060)', () => {
  it('reads cubic and smooth cubic curves, reflecting the last control point', () => {
    expect(ok('M0 0 C0 1 1 1 1 0 S2 -1 2 0')).toEqual([[
      { op: 'M', x: 0, y: 0 },
      { op: 'C', x1: 0, y1: 1, x2: 1, y2: 1, x: 1, y: 0 },
      { op: 'C', x1: 1, y1: -1, x2: 2, y2: -1, x: 2, y: 0 },
    ]]);
    // A smooth curve after no curve takes the current point as control.
    expect(ok('M0 0 s1 1 2 0')[0]![1]).toEqual({ op: 'C', x1: 0, y1: 0, x2: 1, y2: 1, x: 2, y: 0 });
  });

  it('reads quadratic and smooth quadratic curves', () => {
    expect(ok('M0 0 Q1 1 2 0 T4 0')).toEqual([[
      { op: 'M', x: 0, y: 0 },
      { op: 'Q', x1: 1, y1: 1, x: 2, y: 0 },
      { op: 'Q', x1: 3, y1: -1, x: 4, y: 0 },
    ]]);
    expect(ok('m0 0 q1 1 2 0 t2 0')[0]![2]).toEqual({ op: 'Q', x1: 3, y1: -1, x: 4, y: 0 });
  });

  it('turns an arc into cubic curves ending on its end point, a quarter turn at most each', () => {
    // A half circle of radius 1 from (0, 0) to (2, 0).
    const sp = ok('M0 0 A1 1 0 0 1 2 0');
    const curves = sp[0]!.slice(1);
    expect(curves).toHaveLength(2);
    expect(curves.every((c) => c.op === 'C')).toBe(true);
    const last = curves[1] as Extract<VDTPathCommand, { op: 'C' }>;
    expect(last.x).toBe(2);
    expect(last.y).toBe(0);
    // Its middle is the top of the circle (y down, sweep 1: through y = -1).
    const mid = curves[0] as Extract<VDTPathCommand, { op: 'C' }>;
    expect(mid.x).toBeCloseTo(1, 9);
    expect(mid.y).toBeCloseTo(-1, 9);
  });

  it('reads arc flags without separators and relative arcs', () => {
    expect(round(ok('M0 0 a1 1 0 01 2 0'))).toEqual(round(ok('M0 0 A1 1 0 0 1 2 0')));
    expect(round(ok('M0 0a1,1,0,1,0,2,0'))).toEqual(round(ok('M0 0 A1 1 0 1 0 2 0')));
  });

  it('scales radii too small to reach, draws a line for a zero radius and nothing for the same point', () => {
    const small = ok('M0 0 A0.1 0.1 0 0 1 2 0')[0]!;
    expect(small.at(-1)).toMatchObject({ op: 'C', x: 2, y: 0 });
    expect(ok('M0 0 A0 1 0 0 1 2 0')[0]![1]).toEqual({ op: 'L', x: 2, y: 0 });
    expect(ok('M1 1 A1 1 0 0 1 1 1')[0]).toEqual([{ op: 'M', x: 1, y: 1 }]);
  });

  it('turns a full ellipse written as two arcs into four quarter curves', () => {
    expect(arcToCubics(0, 0, 2, 1, 0, false, true, 4, 0)).toHaveLength(2);
    // A rotated ellipse keeps its end points.
    const r = arcToCubics(0, 0, 2, 1, 30, true, false, 1, 1);
    expect(r.at(-1)).toMatchObject({ x: 1, y: 1 });
  });
});

describe('parseSvgPath: malformed data (#1060)', () => {
  const bad = (d: string) => {
    const r = parseSvgPath(d);
    expect(r.ok, d).toBe(false);
    return r.ok ? undefined : r;
  };

  it('rejects data that does not start with a move', () => {
    expect(bad('L0 0')!.error).toMatch(/move/);
    expect(bad('10 10')!.error).toMatch(/unexpected/);
  });

  it('rejects an unknown letter, a command short of numbers and numbers after a close', () => {
    expect(bad('M0 0 X1 1')!.at).toBe(5);
    expect(bad('M0 0 L1')!.error).toMatch(/needs 2/);
    expect(bad('M0 0 C1 1 2 2')!.error).toMatch(/needs 6/);
    expect(bad('M0 0 Z 1 1')!.error).toMatch(/close/);
    expect(bad('M0 0 L1 1 #')).toBeDefined();
    expect(bad('M0 0 L1 1e')).toBeDefined();
  });

  it('rejects an arc flag other than 0 or 1', () => {
    expect(bad('M0 0 A1 1 0 2 1 2 0')!.error).toMatch(/flag/);
  });

  it('rejects empty data, data that is no string and data far too long', () => {
    expect(bad('')).toBeDefined();
    expect(bad('   ')).toBeDefined();
    expect(bad(42 as never)).toBeDefined();
    expect(bad(`M0 0${' L1 1'.repeat(20000)}`)!.error).toMatch(/longer/);
  });

  it('reads long data in linear time', () => {
    const d = `M0 0${' l1 1'.repeat(10000)}`;
    const t0 = performance.now();
    const sp = ok(d);
    expect(sp[0]).toHaveLength(10001);
    expect(performance.now() - t0).toBeLessThan(500);
    // A run of characters that would make a backtracking reader slow.
    expect(bad(`M${'0'.repeat(30000)}x`)).toBeDefined();
  });
});

describe('mapPath and pathViewBox (#1060)', () => {
  it('maps every point and control point affinely', () => {
    const sp = ok('M0 0 C0 1 1 1 1 0 Q0.5 0.5 0 0 Z');
    expect(mapPath(sp, 10, 20, 100, 50)).toEqual([[
      { op: 'M', x: 10, y: 20 },
      { op: 'C', x1: 10, y1: 70, x2: 110, y2: 70, x: 110, y: 20 },
      { op: 'Q', x1: 60, y1: 45, x: 10, y: 20 },
      { op: 'Z' },
    ]]);
  });

  it('defaults the viewBox to the unit square and refuses one with no area', () => {
    expect(pathViewBox(undefined)).toEqual([1, 1]);
    expect(pathViewBox([24, 12])).toEqual([24, 12]);
    expect(pathViewBox([0, 1])).toBeUndefined();
    expect(pathViewBox([1])).toBeUndefined();
    expect(pathViewBox(['1', 1])).toBeUndefined();
    expect(pathViewBox([Infinity, 1])).toBeUndefined();
  });
});
