import { describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { Resource, VDTDocument } from 'postext';
import type { ComposedBook } from '../../book/types';
import { labelAt, labelsOnPage, sheetToPicture } from './labelAnchorGeometry';
import { percentMoveEdit, percentPlace } from './labelAnchorEditor';
import { labelKey, labelMarkShapes, paintShapesCanvas, paintShapesSvg } from './labelMarks';

// #931: a label placed by percentages moves like an anchored one, and every
// drawn label has its marks as shapes the canvas, the HTML overlay and the
// Folio texture paint alike.

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
  anchors: [{ id: 'madrid', x: 0.3, y: 0.6 }],
};
const MARKDOWN = [':::figure{resource="mapa"}', '::label[Madrid]{at="madrid"}', '::label[Mar Negro]{at="70% 40%"}', ':::', ''].join('\n');
const build = (markdown = MARKDOWN): VDTDocument =>
  buildDocument({ markdown, resources: [MAP] }, { page: { width: mm(200), height: mm(260) } as never }, createMeasurementCache());
const page = (doc: VDTDocument) => doc.pages.findIndex((p) => labelsOnPage(doc, p.index).length > 0);

describe('moving a label placed by percentages (#931)', () => {
  it('takes a press on the point of a label placed by percentages, which it could not before', () => {
    const doc = build();
    const labels = labelsOnPage(doc, page(doc));
    expect(labels.map((l) => l.anchorId ?? null)).toEqual(['madrid', null]);
    const pct = labels[1]!;
    expect(labelAt(labels, pct.point.x + 1, pct.point.y + 1, 8)).toBe(pct);
  });

  it('writes the new place over the at value, in the chapter the book’s offset falls in', () => {
    const doc = build();
    const labels = labelsOnPage(doc, page(doc));
    const pct = labels[1]!;
    const book: ComposedBook = {
      markdown: MARKDOWN,
      metadata: {} as never,
      scope: 'book',
      segments: [{ chapterId: 'c1', start: 0, end: MARKDOWN.length }] as never,
    };
    const dropped = sheetToPicture(pct, pct.point.x + 20, pct.point.y - 10)!;
    const edit = percentMoveEdit(pct, dropped.x, dropped.y, book)!;
    expect(edit.chapterId).toBe('c1');
    expect(edit.baseLength).toBe(MARKDOWN.length);
    const [c] = edit.changes;
    expect(MARKDOWN.slice(c!.from, c!.to)).toBe('70% 40%');
    expect(c!.insert).toBe(percentPlace(dropped.x, dropped.y));
    // Written back, the label is where it was dropped.
    const next = MARKDOWN.slice(0, c!.from) + c!.insert + MARKDOWN.slice(c!.to);
    const moved = labelsOnPage(build(next), 0).find((l) => !l.anchorId)!;
    expect(Math.abs(moved.point.x - (pct.point.x + 20))).toBeLessThan(0.5);
    expect(Math.abs(moved.point.y - (pct.point.y - 10))).toBeLessThan(0.5);
  });

  it('shifts the change to the chapter’s own offsets, and gives none for an anchored label or no change', () => {
    const doc = build();
    const labels = labelsOnPage(doc, page(doc));
    const pad = 'Intro line.\n\n';
    const book: ComposedBook = { markdown: pad + MARKDOWN, metadata: {} as never, scope: 'book', segments: [{ chapterId: 'c1', start: 0, end: pad.length + MARKDOWN.length }] as never };
    const shifted = labelsOnPage(build(pad + MARKDOWN), 0).find((l) => !l.anchorId)!;
    expect(percentMoveEdit(shifted, 0.5, 0.5, book)!.changes[0]).toMatchObject({ insert: '50% 50%' });
    expect(percentMoveEdit(labels[0]!, 0.5, 0.5, book)).toBeNull();
    expect(percentMoveEdit(labels[1]!, 0.7, 0.4, { ...book, markdown: MARKDOWN, segments: [{ chapterId: 'c1', start: 0, end: MARKDOWN.length }] as never })).toBeNull();
    expect(percentMoveEdit(labels[1]!, 0.5, 0.5, null)).toBeNull();
  });

  it('keeps a written place inside the picture and to a tenth of a percent', () => {
    expect(percentPlace(0.62345, 0.4849)).toBe('62.3% 48.5%');
    expect(percentPlace(-0.2, 1.4)).toBe('0% 100%');
  });
});

describe('the marks of the labels as shapes (#931)', () => {
  it('draws each label’s box and a point for each movable one, a tag on the one in hand', () => {
    const doc = build();
    const labels = labelsOnPage(doc, page(doc));
    const quiet = labelMarkShapes(labels, 1);
    expect(quiet.filter((s) => s.kind === 'polygon')).toHaveLength(2);
    expect(quiet.filter((s) => s.kind === 'circle')).toHaveLength(2);
    expect(quiet.some((s) => s.kind === 'tag')).toBe(false);
    const hovered = labelMarkShapes(labels, 1, { hover: labelKey(labels[1]!) }, { placedByPercent: '%', overflow: '!' });
    const tag = hovered.find((s) => s.kind === 'tag');
    expect(tag).toMatchObject({ kind: 'tag', text: '%' });
  });

  it('paints the shapes on an SVG and on a canvas context', () => {
    const doc = build();
    const shapes = labelMarkShapes(labelsOnPage(doc, page(doc)), 1, { active: labelKey(labelsOnPage(doc, page(doc))[0]!) });
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? (...a: unknown[]) => { calls.push(`${key}`); return a; } : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    paintShapesCanvas(ctx, shapes);
    expect(calls).toContain('stroke');
    expect(calls).toContain('arc');
    expect(calls).toContain('fillText');
    const created: string[] = [];
    const fake = { appendChild: (el: { tag: string }) => { created.push(el.tag); return el; } } as unknown as SVGElement;
    (globalThis as { document?: unknown }).document = {
      createElementNS: (_ns: string, tag: string) => ({ tag, setAttribute() {}, textContent: '' }),
    };
    try {
      paintShapesSvg(fake, shapes);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
    expect(created).toEqual(expect.arrayContaining(['polygon', 'line', 'circle', 'rect', 'text']));
  });
});
