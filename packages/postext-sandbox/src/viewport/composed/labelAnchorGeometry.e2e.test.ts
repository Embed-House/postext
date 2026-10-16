import { describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache, flowRectToPage, frameOfBlock } from 'postext';
import type { PostextConfig, Resource, VDTDocument } from 'postext';
import { applyAffine, cornersBounds, insideCorners, labelAt, labelsOnPage, pictureToSheet, sheetToPicture, type PageLabel } from './labelAnchorGeometry';
import { withAnchorMoved } from './labelAnchorEditor';

// #866: the drawn labels of a page located on the sheet, and a point of the
// sheet taken back to a point of the picture (where a dragged anchor goes).

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'm.png', format: 'png', width: 400, height: 300, resolution: 72 },
  anchors: [
    { id: 'madrid', x: 0.3, y: 0.6 },
    { id: 'rio', x: 0.55, y: 0.35, rotate: 60, align: 'start' },
  ],
};
const LABELS = ['::label[Madrid]{at="madrid"}', '::label[Tajo]{at="rio"}', '::label[Mar Negro]{at="70% 40%"}'];
const build = (markdown: string, config: PostextConfig = {}, resources: Resource[] = [MAP]): VDTDocument =>
  buildDocument({ markdown, resources }, { page: { width: mm(200), height: mm(260) } as never, ...config }, createMeasurementCache());
const composed = (frame: Record<string, unknown> = {}) => build(
  ['::::page{template="m"}', ':::frame{slot="pic"}', ':::figure{resource="mapa"}', ...LABELS, ':::', ':::', '::::'].join('\n'),
  { pageTemplates: [{ id: 'm', frames: [{ name: 'pic', x: mm(30), y: mm(40), width: mm(120), height: mm(120), ...frame }] }] as never },
);
const flow = (config: PostextConfig = {}) => build([':::figure{resource="mapa"}', ...LABELS, ':::', ''].join('\n'), config);
const pageOf = (doc: VDTDocument) => doc.pages.findIndex((p) => labelsOnPage(doc, p.index).length > 0);
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** Every invariant a page's labels keep: the anchor point maps back to the
 *  anchor, the point lies on the label's turned frame origin, and the
 *  sheet box is the stamped rect taken to the sheet. */
function checkLabels(doc: VDTDocument, rectToSheet: (pl: PageLabel) => { x: number; y: number; width: number; height: number }) {
  const page = pageOf(doc);
  expect(page).toBeGreaterThanOrEqual(0);
  const labels = labelsOnPage(doc, page);
  expect(labels.map((l) => l.anchorId ?? null)).toEqual(['madrid', 'rio', null]);
  const want = [[0.3, 0.6], [0.55, 0.35], [0.7, 0.4]] as const;
  labels.forEach((pl, i) => {
    const back = sheetToPicture(pl, pl.point.x, pl.point.y)!;
    close(back.x, want[i]![0], 1e-6);
    close(back.y, want[i]![1], 1e-6);
    const there = pictureToSheet(pl, want[i]![0], want[i]![1]);
    close(there.x, pl.point.x);
    close(there.y, pl.point.y);
    const box = cornersBounds(pl.corners);
    const r = rectToSheet(pl);
    close(box.x, r.x, 1e-4);
    close(box.y, r.y, 1e-4);
    close(box.width, r.width, 1e-4);
    close(box.height, r.height, 1e-4);
  });
  return labels;
}

describe('the labels of a page on the sheet (#866)', () => {
  it('on a composed page: the frame holds the picture, the rect is the frame’s', () => {
    const doc = composed();
    const labels = checkLabels(doc, (pl) => pl.label.rect!);
    // A centred, middle-aligned label stands over its point.
    expect(insideCorners(labels[0]!.corners, labels[0]!.point.x, labels[0]!.point.y)).toBe(true);
  });

  it('in a turned frame, through the frame’s turn', () => {
    const doc = composed({ rotate: 30 });
    const page = doc.pages[pageOf(doc)]!;
    checkLabels(doc, (pl) => {
      // The stamped rect is upright in the frame; on the sheet the frame
      // turns it: compare the turned corners' bounds.
      const frame = frameOfBlock(page.composed, pl.block.id)!;
      const r = pl.label.rect!;
      const t = (30 * Math.PI) / 180;
      const cx = frame.rect.x + frame.rect.width / 2;
      const cy = frame.rect.y + frame.rect.height / 2;
      const turn = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), cx - Math.cos(t) * cx + Math.sin(t) * cy, cy - Math.sin(t) * cx - Math.cos(t) * cy] as [number, number, number, number, number, number];
      // The label's own box turned by its rotation and the frame's: its
      // bounds hold the stamped rect's turned centre.
      const c = applyAffine(turn, r.x + r.width / 2, r.y + r.height / 2);
      const box = cornersBounds(pl.corners);
      expect(c.x).toBeGreaterThan(box.x - 1e-3);
      expect(c.x).toBeLessThan(box.x + box.width + 1e-3);
      return box;
    });
  });

  it('in the flow, and on a right-to-left page where the label’s layout is mirrored', () => {
    for (const config of [{}, { direction: 'rtl', locale: 'ar' } as PostextConfig]) {
      const doc = flow(config);
      const page = doc.pages[pageOf(doc)]!;
      const labels = checkLabels(doc, (pl) => flowRectToPage(page, pl.label.rect!));
      expect(labels[0]!.mirrored).toBe(!!config.direction);
    }
  });

  it('through a crop: points outside the part shown map outside the body', () => {
    const pl = { matrix: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number], body: { x: 5, y: 5, width: 200, height: 100 }, source: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, mirrored: false };
    expect(pictureToSheet(pl, 0.25, 0.5)).toEqual({ x: 15, y: 25 });
    expect(pictureToSheet(pl, 0.75, 1)).toEqual({ x: 215, y: 125 });
    expect(sheetToPicture(pl, 115, 75)).toEqual({ x: 0.5, y: 0.75 });
    // Left of the crop: a fraction under the shown part's start.
    expect(sheetToPicture(pl, 5, 25)!.x).toBeCloseTo(0.225, 6);
    const mirrored = { ...pl, mirrored: true };
    expect(sheetToPicture(mirrored, ...Object.values(pictureToSheet(mirrored, 0.4, 0.6)) as [number, number])).toEqual({ x: 0.4, y: 0.6 });
  });

  it('a press takes the nearest anchor point, else the box under it; a label placed in the text is not taken', () => {
    const doc = composed();
    const labels = labelsOnPage(doc, pageOf(doc));
    const [madrid, , mar] = labels;
    expect(labelAt(labels, madrid!.point.x + 3, madrid!.point.y, 5)?.anchorId).toBe('madrid');
    const c = cornersBounds(madrid!.corners);
    expect(labelAt(labels, c.x + 1, c.y + 1, 0.1)?.anchorId).toBe('madrid');
    const m = cornersBounds(mar!.corners);
    expect(labelAt(labels, m.x + m.width / 2, m.y + m.height / 2, 0.1)).toBeNull();
    expect(labelAt(labels, -100, -100, 5)).toBeNull();
  });

  it('writes a dragged anchor back onto the resource, four decimals, inside the picture', () => {
    const moved = withAnchorMoved(MAP, 'madrid', 0.123456, 1.4, 5)!;
    expect(moved.anchors![0]).toEqual({ id: 'madrid', x: 0.1235, y: 1 });
    expect(moved.anchors![1]).toBe(MAP.anchors![1]);
    expect(moved.updatedAt).toBe(5);
    expect(withAnchorMoved(MAP, 'nowhere', 0.5, 0.5)).toBeNull();
    expect(withAnchorMoved(MAP, 'madrid', 0.3, 0.6)).toBeNull();
  });

  it('a label moved by its anchor is laid out at the new place', () => {
    const doc = composed();
    const before = labelsOnPage(doc, pageOf(doc))[0]!;
    const target = { x: before.point.x + 40, y: before.point.y - 25 };
    const fraction = sheetToPicture(before, target.x, target.y)!;
    const next = withAnchorMoved(MAP, 'madrid', fraction.x, fraction.y)!;
    const doc2 = build(['::::page{template="m"}', ':::frame{slot="pic"}', ':::figure{resource="mapa"}', ...LABELS, ':::', ':::', '::::'].join('\n'),
      { pageTemplates: [{ id: 'm', frames: [{ name: 'pic', x: mm(30), y: mm(40), width: mm(120), height: mm(120) }] }] as never }, [next]);
    const after = labelsOnPage(doc2, pageOf(doc2))[0]!;
    close(after.point.x, target.x, 0.05);
    close(after.point.y, target.y, 0.05);
  });
});
