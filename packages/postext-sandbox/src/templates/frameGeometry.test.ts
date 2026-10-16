import { describe, expect, it } from 'vitest';
import {
  anchorPins,
  dragRect,
  frameBoxPatch,
  frameFromRect,
  gridCellFor,
  gridGeometry,
  handleAt,
  mmToPx,
  pageAreas,
  pxToMm,
  spreadPageAreas,
  snapLines,
  snapRect,
  unrotatePoint,
} from './frameGeometry';

const DPI = 96;
const px = (mm: number) => mmToPx(mm, DPI);
const mm = (value: number) => ({ value, unit: 'mm' as const });
const page = { width: px(230), height: px(288), contentArea: { x: px(22), y: px(24), width: px(186), height: px(242) } };
const areas = pageAreas(page, 0);
const area = areas.content;

describe('units', () => {
  it('turns page px into millimetres and back', () => {
    expect(pxToMm(mmToPx(12.5, DPI), DPI)).toBeCloseTo(12.5);
  });
});

describe('anchorPins', () => {
  it('pins the side of the box the engine pins', () => {
    expect(anchorPins('top-right', false)).toEqual({ pinX: 'end', pinY: 'start' });
    expect(anchorPins('below', true)).toEqual({ pinX: 'start', pinY: 'start' });
    expect(anchorPins('above', true)).toEqual({ pinX: 'start', pinY: 'end' });
    // A nine-point edge on another frame reads as on a container.
    expect(anchorPins('right', true)).toEqual({ pinX: 'end', pinY: 'middle' });
  });
});

describe('handles and drags', () => {
  const r = { x: 100, y: 100, width: 200, height: 100 };
  it('finds the handle under the pointer, corners first', () => {
    expect(handleAt(r, 101, 99, 6)).toBe('nw');
    expect(handleAt(r, 200, 200, 6)).toBe('s');
    expect(handleAt(r, 150, 150, 6)).toBe('move');
    expect(handleAt(r, 50, 50, 6)).toBeNull();
  });
  it('drags a side without crossing the opposite one', () => {
    expect(dragRect(r, 'e', 50, 0)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(dragRect(r, 'nw', 10, 20)).toEqual({ x: 110, y: 120, width: 190, height: 80 });
    expect(dragRect(r, 'w', 500, 0, 4).width).toBe(4);
    expect(dragRect(r, 'move', -10, 5)).toEqual({ x: 90, y: 105, width: 200, height: 100 });
  });
  it('turns a point into a rotated frame’s own box', () => {
    const p = unrotatePoint({ x: 0, y: 0, width: 100, height: 100 }, 90, 100, 50);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
  });
});

describe('snapping', () => {
  const lines = snapLines(areas, area, undefined, [{ x: px(40), y: px(60), width: px(50), height: px(30) }]);
  it('snaps a moved box to a margin by its side', () => {
    const out = snapRect({ x: area.x + 3, y: px(150), width: px(60), height: px(20) }, 'move', lines, 5);
    expect(out.rect.x).toBeCloseTo(area.x);
    expect(out.guideX).toBeCloseTo(area.x);
  });
  it('snaps a resized side to another frame’s edge', () => {
    const out = snapRect({ x: px(100), y: px(150), width: px(60), height: px(30) - 2 }, 's', lines, 5);
    expect(out.rect.y + out.rect.height).toBeCloseTo(px(150) + px(30) - 2);
    const right = snapRect({ x: px(10), y: px(150), width: px(80) - 3, height: px(20) }, 'e', lines, 5);
    expect(right.rect.x + right.rect.width).toBeCloseTo(px(90));
  });
  it('leaves a box far from every line alone', () => {
    const r = { x: px(120), y: px(170), width: px(13), height: px(7) };
    expect(snapRect(r, 'move', lines, 2).rect).toEqual(r);
  });
  it('snaps to the template grid', () => {
    const grid = gridGeometry({ columns: 2, rows: 2, columnGap: mm(6) }, area, DPI);
    const withGrid = snapLines(areas, area, grid, []);
    const out = snapRect({ x: grid.cols[1]!.start + 2, y: px(150), width: px(20), height: px(20) }, 'move', withGrid, 4);
    expect(out.rect.x).toBeCloseTo(grid.cols[1]!.start);
    expect(gridCellFor(grid, { x: grid.cols[0]!.start + 1, y: grid.rows[0]!.start, width: grid.cols[1]!.end - grid.cols[0]!.start, height: 10 })).toEqual({ col: 1, row: 1, cols: 2, rows: 1 });
  });
});

describe('frameBoxPatch: the write-back', () => {
  it('moves the offset by what the anchor point moved, in mm', () => {
    const from = { x: area.x + px(10), y: area.y + px(20), width: px(50), height: px(30) };
    const to = { ...from, x: from.x + px(5), y: from.y - px(2.5) };
    const patch = frameBoxPatch({
      resolved: { placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(10), y: mm(20) } }, width: mm(50), height: mm(30) },
      from, to, area, dpi: DPI,
    });
    expect(patch).toEqual({ placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(15), y: mm(17.5) } } });
  });

  it('keeps a right-pinned frame’s anchor at its right side when the left side is dragged', () => {
    const from = { x: px(100), y: px(40), width: px(58), height: px(40) };
    const to = { ...from, x: px(90), width: px(68) };
    const patch = frameBoxPatch({
      resolved: { placement: { anchor: { to: '#dinero', edge: 'top-right' }, offset: { x: mm(-2), y: mm(2) } }, width: mm(58), height: 'auto' },
      from, to, area, dpi: DPI,
    });
    // The right side stayed: no new offset, only the width.
    expect(patch).toEqual({ width: mm(68) });
  });

  it('gives a frame with no placement one at the area’s top-left, and spells a fill width', () => {
    const from = { ...area, height: px(40) };
    const to = { x: area.x + px(10), y: area.y + px(30), width: area.width, height: px(40) };
    const patch = frameBoxPatch({ resolved: { width: 'fill', height: 'auto' }, from, to, area, dpi: DPI });
    expect(patch.placement).toEqual({ anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(10), y: mm(30) } });
    expect(patch.width).toEqual(mm(186));
    expect(patch.height).toBeUndefined();
  });

  it('reads an offset in another unit and writes it in mm', () => {
    const from = { x: area.x, y: area.y, width: px(20), height: px(20) };
    const patch = frameBoxPatch({
      resolved: { placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: { value: 1, unit: 'cm' } } }, width: mm(20), height: mm(20) },
      from, to: { ...from, x: from.x + px(1) }, area, dpi: DPI,
    });
    expect(patch.placement?.offset?.x).toEqual(mm(11));
  });

  it('writes a grid cell for a frame set in the grid', () => {
    const grid = gridGeometry({ columns: 3, rows: 2 }, area, DPI);
    const from = { x: grid.cols[0]!.start, y: grid.rows[0]!.start, width: grid.cols[0]!.end - grid.cols[0]!.start, height: 50 };
    const to = { ...from, x: grid.cols[1]!.start + 3 };
    const patch = frameBoxPatch({ resolved: { grid: { col: 1, row: 1, cols: 1, rows: 1 }, width: 'fill', height: 'auto' }, from, to, area, dpi: DPI, grid });
    expect(patch).toEqual({ grid: { col: 2, row: 1, cols: 1, rows: 1 } });
  });

  it('is empty when the box did not change', () => {
    const r = { x: 10, y: 10, width: 10, height: 10 };
    expect(frameBoxPatch({ resolved: { width: 'fill', height: 'auto' }, from: r, to: r, area, dpi: DPI })).toEqual({});
  });

  it('draws a new frame anchored to the area', () => {
    const f = frameFromRect('caja', { x: area.x + px(5), y: area.y + px(6), width: px(70), height: px(40) }, area, DPI);
    expect(f).toEqual({ name: 'caja', placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(5), y: mm(6) } }, width: mm(70), height: mm(40) });
  });
});

describe('spreadPageAreas (#861)', () => {
  const pg = { width: 200, height: 300, contentArea: { x: 20, y: 20, width: 160, height: 260 } };
  const facing = { contentArea: { x: 30, y: 20, width: 150, height: 260 } };
  it('lays the facing page one trim width to the right of the first page', () => {
    const a = spreadPageAreas(pg, facing, 10, 0);
    expect(a.shift).toBe(180);
    expect(a.content).toEqual({ x: 20, y: 20, width: 180 + 30 + 150 - 20, height: 260 });
    expect(a.trim).toEqual({ x: 10, y: 10, width: 360, height: 280 });
  });
  it('and to the left of the second', () => {
    const a = spreadPageAreas(pg, facing, 10, 1);
    expect(a.content.x).toBe(30 - 180);
    expect(a.content.x + a.content.width).toBe(180);
    expect(a.bleed).toEqual({ x: -180, y: 0, width: 380, height: 300 });
  });
});
