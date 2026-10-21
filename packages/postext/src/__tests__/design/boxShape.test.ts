import { describe, it, expect } from 'vitest';
import {
  borderPieces,
  boxOutline,
  boxStylePathBlocks,
  cornerRadiiPx,
  normalizeBoxStyle,
  outlineSubpath,
  shapePathBlocks,
} from '../../design/boxShape.js';
import { createBoundingBox, type VDTPathCommand } from '../../vdt.js';

// #1059: box shapes — a radius per corner, a border per side and a card
// joined to its tab — as outlines of the vector block.

const box = createBoundingBox(10, 20, 100, 60);
const points = (sp: VDTPathCommand[]) => sp.filter((c) => c.op !== 'Z').map((c) => [Math.round((c as { x: number }).x * 1000) / 1000, Math.round((c as { y: number }).y * 1000) / 1000]);

describe('box outlines', () => {
  it('rounds only the corners that have a radius', () => {
    const o = boxOutline(box, [8, 0, 8, 0]);
    expect(o.vertices.map((v) => v.r)).toEqual([8, 0, 8, 0]);
    const sp = outlineSubpath(o);
    // Two curves: top-left and bottom-right; the square corners are points.
    expect(sp.filter((c) => c.op === 'C')).toHaveLength(2);
    expect(points(sp)).toContainEqual([110, 20]);
    expect(points(sp)).toContainEqual([10, 80]);
    expect(sp[sp.length - 1]!.op).toBe('Z');
  });

  it('clamps two corners that would take more than their edge', () => {
    const o = boxOutline(createBoundingBox(0, 0, 100, 20), [30, 30, 0, 0]);
    // The left edge is 20 long with one corner on it: 20; the top edge
    // shares 100 between two corners of 30, which fit.
    expect(o.vertices[0]!.r).toBe(20);
    expect(o.vertices[1]!.r).toBe(20);
  });

  it('grows a tab out of the top with concave fillets at its feet', () => {
    const o = boxOutline(box, [6, 6, 6, 6], { edge: 'top', x0: 40, x1: 80, height: 12, radius: 6, fillet: 4 });
    const concave = o.vertices.filter((v) => v.concave);
    expect(concave.map((v) => [v.x, v.y, v.r])).toEqual([[40, 20, 4], [80, 20, 4]]);
    // The tab's outer corners stand 12 px above the box.
    expect(o.vertices.filter((v) => v.y === 8).map((v) => v.x)).toEqual([40, 80]);
    // Every tab edge belongs to the top side.
    expect(o.sides.filter((s) => s === 'top')).toHaveLength(5);
    const pts = points(outlineSubpath(o));
    // The fillet runs from the box's edge 4 px before the tab up its side.
    expect(pts).toContainEqual([36, 20]);
    expect(pts).toContainEqual([40, 16]);
  });

  it('runs the side straight up into a tab flush with it', () => {
    const o = boxOutline(box, [6, 6, 6, 6], { edge: 'top', x0: 10, x1: 50, height: 12, radius: 6, fillet: 4 });
    // No box corner at the top-left, no fillet on that side.
    expect(o.vertices.some((v) => v.x === 10 && v.y === 20)).toBe(false);
    expect(o.vertices.filter((v) => v.concave)).toHaveLength(1);
    // The left edge reaches the tab's top: it is the left side's.
    const tl = o.vertices.findIndex((v) => v.x === 10 && v.y === 8);
    expect(o.sides[(tl + o.vertices.length - 1) % o.vertices.length]).toBe('left');
  });

  it('hangs a tab from the foot, at the right corner', () => {
    const o = boxOutline(box, [0, 0, 6, 6], { edge: 'bottom', x0: 70, x1: 110, height: 10, radius: 6, fillet: 6 });
    expect(o.vertices.filter((v) => v.y === 90).map((v) => v.x).sort((a, b) => a - b)).toEqual([70, 110]);
    expect(o.vertices.filter((v) => v.concave).map((v) => [v.x, v.y])).toEqual([[70, 80]]);
  });

  it('keeps fillets and tab corners within the room the tab has', () => {
    // Inset 3 px: the fillet is held to half of it, the box corner to the rest.
    const o = boxOutline(box, [10, 10, 10, 10], { edge: 'top', x0: 13, x1: 33, height: 6, radius: 10, fillet: 10 });
    const fillet = o.vertices.find((v) => v.concave)!;
    expect(fillet.r).toBeCloseTo(1.5, 6);
    expect(o.vertices[0]!.r).toBeCloseTo(1.5, 6);
    const tabCorner = o.vertices.find((v) => v.y === 14)!;
    expect(tabCorner.r).toBeLessThanOrEqual(6 - 1.5 + 1e-9);
  });
});

describe('border pieces', () => {
  it('cuts one closed piece per side that has a width', () => {
    const o = boxOutline(box, [0, 0, 0, 0]);
    const pieces = borderPieces(o, { top: 2, right: 0, bottom: 4, left: 0 });
    expect([...pieces.keys()].sort()).toEqual(['bottom', 'top']);
    // The top piece: the box's top edge and its inner edge 2 px down.
    expect(points(pieces.get('top')![0]!)).toEqual([[10, 20], [110, 20], [110, 22], [10, 22]]);
  });

  it('gives a side the whole corner when its neighbour has no width', () => {
    const o = boxOutline(box, [8, 8, 8, 8]);
    const top = borderPieces(o, { top: 2, right: 0, bottom: 0, left: 0 }).get('top')![0]!;
    // From the foot of the top-left corner's curve (on the left edge)…
    expect(points(top)[0]).toEqual([10, 28]);
  });
});

describe('shape path blocks', () => {
  it('paints one colour of border on every side as one even-odd ring over the fill', () => {
    const side = { color: '#123456', widthPx: 2 };
    const blocks = shapePathBlocks(boxOutline(box, [4, 0, 4, 0]), '#ffffff', { top: side, right: { ...side, widthPx: 1 }, bottom: side, left: side });
    expect(blocks.map((b) => [b.boxPart, b.fill, b.fillRule ?? 'nonzero', b.subpaths.length])).toEqual([
      ['fill', '#ffffff', 'nonzero', 1],
      ['border', '#123456', 'evenodd', 2],
    ]);
    expect(blocks[1]!.borderWidthPx).toBe(2);
  });

  it('paints a border on some sides only as their pieces, no edge left on the outline', () => {
    const blocks = shapePathBlocks(boxOutline(box, [4, 4, 4, 4]), undefined, {
      top: { color: '#123456', widthPx: 2 }, right: null, bottom: { color: '#123456', widthPx: 2 }, left: null,
    });
    expect(blocks.map((b) => [b.boxPart, b.fillRule ?? 'nonzero', b.subpaths.length])).toEqual([['border', 'nonzero', 2]]);
  });

  it('paints the pieces of each colour of border apart', () => {
    const blocks = shapePathBlocks(boxOutline(box, [0, 0, 0, 0]), undefined, {
      top: { color: '#ff0000', widthPx: 3 }, right: { color: '#0000ff', widthPx: 1 }, bottom: null, left: { color: '#ff0000', widthPx: 1 },
    });
    expect(blocks.map((b) => [b.fill, b.subpaths.length, b.borderWidthPx])).toEqual([['#ff0000', 2, 3], ['#0000ff', 1, 1]]);
  });

  it('fills a box its border leaves no room in with the border colour', () => {
    const blocks = boxStylePathBlocks(0, 0, 10, 10, { backgroundColor: '#fff', borderWidthPx: 6, borderRadiusPx: 0, borderColor: '#000', borderRadiiPx: [2, 0, 0, 0] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.fill).toBe('#000');
  });
});

describe('box style folding', () => {
  it('folds equal corners and equal sides back to the plain fields', () => {
    const side = { color: '#111111', widthPx: 1 };
    const style = normalizeBoxStyle({ borderWidthPx: 0, borderRadiusPx: 0, borderRadiiPx: [3, 3, 3, 3], borderSides: { top: side, right: side, bottom: side, left: side } });
    expect(style).toEqual({ borderWidthPx: 1, borderRadiusPx: 3, borderColor: '#111111' });
  });

  it('keeps corners and sides that differ, with the plain fields for checks', () => {
    const style = normalizeBoxStyle({ borderWidthPx: 0, borderRadiusPx: 0, borderRadiiPx: [3, 0, 3, 0], borderSides: { top: { color: '#aa0000', widthPx: 2 }, right: null, bottom: null, left: null } });
    expect(style.borderRadiiPx).toEqual([3, 0, 3, 0]);
    expect(style.borderRadiusPx).toBe(3);
    expect(style.borderColor).toBe('#aa0000');
    expect(style.borderWidthPx).toBe(2);
    expect(style.borderSides?.top).toEqual({ color: '#aa0000', widthPx: 2 });
  });

  it('reads a radius per corner, a corner left out square', () => {
    const toPx = (d: { value: number }) => d.value * 2;
    expect(cornerRadiiPx({ topLeft: { value: 3, unit: 'pt' }, bottomRight: { value: 1, unit: 'pt' } }, toPx)).toEqual([6, 0, 2, 0]);
    expect(cornerRadiiPx({ value: 2, unit: 'pt' }, toPx)).toEqual([4, 4, 4, 4]);
  });
});
