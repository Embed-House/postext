import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { Resource, VDTDocument } from 'postext';
import type { Dispatch, MutableRefObject } from 'react';
import type { SandboxAction, SandboxState } from '../../context/SandboxContext.js';
import type { ComposedBook } from '../../book/types.js';
import { resetEditMode, setEditMode } from '../../editing/editMode.js';
import { setTemplateEditorHost } from '../../templates/editorStore.js';
import { resetViewerEdits } from '../../editor/viewerEdits.js';
import { insideCorners, labelsOnPage, sheetToPicture } from './labelAnchorGeometry.js';
import { createLabelEditor, touchPads, type LabelEditor, type LabelSurface } from './labelAnchorEditor.js';
import { labelMarkShapes } from './labelMarks.js';
import type { MarkShape } from './labelMarks.js';

// #970: the label editor knows nothing of the page it sits on, so the Folio
// can drag the marks of the labels as the Canvas does. The Folio's surface is
// a fake here: it keeps what the editor painted.

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
const doc: VDTDocument = buildDocument({ markdown: MARKDOWN, resources: [MAP] }, { page: { width: mm(200), height: mm(260) } as never }, createMeasurementCache());
const PAGE = doc.pages.findIndex((p) => labelsOnPage(doc, p.index).length > 0);
const labels = labelsOnPage(doc, PAGE);
const anchored = labels.find((l) => l.anchorId)!;
const percent = labels.find((l) => !l.anchorId)!;

let painted: Map<number, MarkShape[] | null>;
let paints: number;
let dispatched: SandboxAction[];
let released: number[];
let on: boolean;

const surface = (): LabelSurface => ({
  paint: (page, shapes) => {
    painted.set(page, shapes);
    paints++;
  },
  sheetPxPerCssPx: () => 2,
});
const ref = <T,>(current: T): MutableRefObject<T> => ({ current });

function editor(extra: Partial<Parameters<typeof createLabelEditor>[0]> = {}): LabelEditor {
  const dispatchRef = ref<Dispatch<SandboxAction>>((a) => { dispatched.push(a); });
  return createLabelEditor({
    surface: surface(),
    docRef: ref<VDTDocument | null>(doc),
    dispatchRef,
    enabled: () => on,
    onDragEnd: (id) => released.push(id),
    ...extra,
  });
}
const at = (x: number, y: number, pageIndex = PAGE) => ({ pageIndex, x, y });
const ptr = (id: number, x: number, y: number, pointerType?: string) => ({ pointerId: id, clientX: x, clientY: y, ...(pointerType ? { pointerType } : {}) });

beforeEach(() => {
  painted = new Map();
  paints = 0;
  dispatched = [];
  released = [];
  on = true;
  setEditMode('design');
  setTemplateEditorHost({ getState: () => ({ resources: [MAP], activePanel: 'markdown', activeResourceId: null }) as unknown as SandboxState, dispatch: () => {} });
  resetViewerEdits();
});
afterEach(() => {
  resetEditMode();
  setTemplateEditorHost(null);
});

describe('the label editor of a surface (#970)', () => {
  it('takes no press outside Design mode, while disabled or off a label', () => {
    const e = editor();
    setEditMode('content');
    expect(e.pointerDown(ptr(1, 0, 0), at(anchored.point.x, anchored.point.y))).toBe(false);
    setEditMode('design');
    on = false;
    expect(e.pointerDown(ptr(1, 0, 0), at(anchored.point.x, anchored.point.y))).toBe(false);
    on = true;
    expect(e.pointerDown(ptr(1, 0, 0), at(5, 5))).toBe(false);
    expect(e.dragging()).toBe(false);
    expect(e.hover(at(5, 5))).toBe(false);
  });

  it('paints a page only while a label of it is hovered or dragged, and gives it back after', () => {
    const e = editor();
    expect(e.hover(at(anchored.point.x + 1, anchored.point.y + 1))).toBe(true);
    const shapes = painted.get(PAGE)!;
    expect(shapes.some((s) => s.kind === 'tag')).toBe(true);
    // Leaving the label hands the page back to the host's own marks.
    expect(e.hover(at(5, 5))).toBe(false);
    expect(painted.get(PAGE)).toBeNull();
    // Nothing to repaint when the pointer moves over bare paper.
    const before = paints;
    e.hover(at(6, 6));
    expect(paints).toBe(before);
  });

  it('drags the anchor of a label and writes it on the resource as one step', () => {
    const e = editor();
    expect(e.pointerDown(ptr(7, 100, 100), at(anchored.point.x, anchored.point.y))).toBe(true);
    expect(e.dragging()).toBe(true);
    // Below the threshold the press is still a click.
    e.dragMove(ptr(7, 101, 101), at(anchored.point.x + 1, anchored.point.y + 1));
    expect(painted.get(PAGE)!.some((s) => s.kind === 'polygon' && s.fill)).toBe(false);
    e.dragMove(ptr(7, 130, 90), at(anchored.point.x + 30, anchored.point.y - 12));
    const ghost = painted.get(PAGE)!.filter((s) => s.kind === 'polygon' && s.fill);
    expect(ghost).toHaveLength(1);
    e.pointerUp(ptr(7, 130, 90), false);
    expect(released).toEqual([7]);
    expect(e.dragging()).toBe(false);
    const drop = dispatched.find((a) => a.type === 'UPSERT_RESOURCE') as Extract<SandboxAction, { type: 'UPSERT_RESOURCE' }>;
    const expected = sheetToPicture(anchored, anchored.point.x + 30, anchored.point.y - 12)!;
    expect(drop.payload.anchors![0]!.x).toBeCloseTo(expected.x, 3);
    expect(drop.payload.anchors![0]!.y).toBeCloseTo(expected.y, 3);
    expect((drop as { history?: unknown }).history).toEqual({ merge: false });
    expect(painted.get(PAGE)).toBeNull();
  });

  it('opens the picture when the press does not move, and writes nothing when cancelled', () => {
    const e = editor();
    e.pointerDown(ptr(1, 0, 0), at(anchored.point.x, anchored.point.y));
    e.pointerUp(ptr(1, 0, 0), false);
    expect(dispatched).toEqual([{ type: 'SET_PANEL', payload: 'resources' }, { type: 'SET_ACTIVE_RESOURCE', payload: 'mapa' }]);
    dispatched = [];
    e.pointerDown(ptr(2, 0, 0), at(anchored.point.x, anchored.point.y));
    e.dragMove(ptr(2, 40, 40), at(anchored.point.x + 40, anchored.point.y + 40));
    e.cancel();
    expect(dispatched).toEqual([]);
    expect(released).toEqual([1, 2]);
    expect(e.dragging()).toBe(false);
  });

  it('rewrites the percentages of a label placed by them, in the book on screen', () => {
    const book: ComposedBook = { markdown: MARKDOWN, metadata: {} as never, scope: 'book', segments: [{ chapterId: 'c1', start: 0, end: MARKDOWN.length }] as never };
    const e = editor({ sourceOfPage: () => book });
    expect(e.pointerDown(ptr(3, 0, 0), at(percent.point.x, percent.point.y))).toBe(true);
    e.dragMove(ptr(3, 50, 0), at(percent.point.x + 50, percent.point.y));
    e.pointerUp(ptr(3, 50, 0), false);
    const edit = dispatched.find((a) => a.type === 'EDIT_CHAPTER_MARKDOWN') as Extract<SandboxAction, { type: 'EDIT_CHAPTER_MARKDOWN' }>;
    expect(edit.payload.chapterId).toBe('c1');
    expect(MARKDOWN.slice(edit.payload.changes[0]!.from, edit.payload.changes[0]!.to)).toBe('70% 40%');
  });

  it('ignores a pointer that is another one, or on another page, while a label is held', () => {
    const e = editor();
    e.pointerDown(ptr(4, 0, 0), at(anchored.point.x, anchored.point.y));
    e.dragMove(ptr(9, 90, 90), at(anchored.point.x + 90, anchored.point.y));
    e.dragMove(ptr(4, 90, 90), at(anchored.point.x + 90, anchored.point.y, PAGE + 1));
    e.pointerUp(ptr(9, 90, 90), false);
    expect(e.dragging()).toBe(true);
    e.pointerUp(ptr(4, 0, 0), false);
    // Never moved on its own page: a click.
    expect(dispatched[0]).toEqual({ type: 'SET_PANEL', payload: 'resources' });
  });

  it('opens the anchor editor on a double click, for an anchored label only', () => {
    const e = editor();
    expect(e.dblclick(at(percent.point.x, percent.point.y))).toBe(false);
    expect(e.dblclick(at(anchored.point.x, anchored.point.y))).toBe(true);
    expect(dispatched).toContainEqual({ type: 'SET_ACTIVE_RESOURCE', payload: 'mapa' });
  });

  it('keeps painting the pages it was told to paint at rest, with the label last pressed marked', () => {
    const e = editor({ restPages: [PAGE], keepActive: true });
    e.sync();
    expect(painted.get(PAGE)!.length).toBeGreaterThan(0);
    e.pointerDown(ptr(5, 0, 0), at(anchored.point.x, anchored.point.y));
    e.pointerUp(ptr(5, 0, 0), false);
    expect(painted.get(PAGE)).not.toBeNull();
    setEditMode('content');
    e.sync();
    expect(painted.get(PAGE)).toBeNull();
    e.dispose();
  });

  // #992: a finger is not a mouse. It lands about 22 CSS px from where it
  // aims, and it wanders a few px between the press and the lift.
  it('takes a touch press a finger-width from a point, and a mouse press only a few px', () => {
    const e = editor();
    const free = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => ({ x: anchored.point.x + 30 * Math.cos((i * Math.PI) / 4), y: anchored.point.y + 30 * Math.sin((i * Math.PI) / 4) }))
      .find((q) => labels.every((l) => !insideCorners(l.corners, q.x, q.y)))!;
    expect(free).toBeDefined();
    // 30 sheet px is 15 CSS px here.
    expect(e.pointerDown(ptr(1, 0, 0, 'mouse'), at(free.x, free.y))).toBe(false);
    expect(e.pointerDown(ptr(2, 0, 0, 'touch'), at(free.x, free.y))).toBe(true);
    e.cancel();
    expect(e.pointerDown(ptr(3, 0, 0, 'pen'), at(free.x, free.y))).toBe(true);
    e.cancel();
    // A touch farther than a fingertip takes nothing.
    const far = { x: anchored.point.x + 80, y: anchored.point.y + 80 };
    if (labels.every((l) => !insideCorners(l.corners, far.x, far.y))) expect(e.pointerDown(ptr(4, 0, 0, 'touch'), at(far.x, far.y))).toBe(false);
  });

  it('lets a touch wander a few px before the press becomes a drag', () => {
    const e = editor();
    e.pointerDown(ptr(1, 100, 100, 'touch'), at(anchored.point.x, anchored.point.y));
    // 6 CSS px: a drag for a mouse, a tremor for a finger.
    e.dragMove(ptr(1, 106, 100, 'touch'), at(anchored.point.x + 12, anchored.point.y));
    expect(painted.get(PAGE)!.some((s) => s.kind === 'polygon' && s.fill)).toBe(false);
    e.dragMove(ptr(1, 112, 100, 'touch'), at(anchored.point.x + 24, anchored.point.y));
    expect(painted.get(PAGE)!.some((s) => s.kind === 'polygon' && s.fill)).toBe(true);
    e.cancel();
    e.pointerDown(ptr(2, 100, 100, 'mouse'), at(anchored.point.x, anchored.point.y));
    e.dragMove(ptr(2, 106, 100, 'mouse'), at(anchored.point.x + 12, anchored.point.y));
    expect(painted.get(PAGE)!.some((s) => s.kind === 'polygon' && s.fill)).toBe(true);
    e.cancel();
  });

  it('gives a touch screen a pad under every label, which the browser leaves to the page', () => {
    const shapes = labelMarkShapes(labels, 2);
    const pads = touchPads(shapes, 400, 500);
    // One for each label's box and one for each point to grab.
    const boxes = shapes.filter((s) => s.kind === 'polygon').length;
    const points = shapes.filter((s) => s.kind === 'circle').length;
    expect(pads).toHaveLength(boxes + points);
    const point = pads.find((p) => p.minCssPx === 44)!;
    expect(point).toBeDefined();
    const c = shapes.find((s) => s.kind === 'circle') as Extract<MarkShape, { kind: 'circle' }>;
    expect(point.centerX).toBeCloseTo(c.cx / 400, 6);
    expect(point.centerY).toBeCloseTo(c.cy / 500, 6);
    for (const p of pads) {
      expect(p.width).toBeGreaterThanOrEqual(0);
      expect(p.centerX).toBeGreaterThanOrEqual(0);
    }
    // The ghost of a drag is not a pad: the finger is already down.
    const dragged = labelMarkShapes(labels, 2, { drag: { key: (anchored.label.id ?? `${anchored.block.id}:${anchored.label.sourceStart}`), dx: 10, dy: 10 } });
    expect(touchPads(dragged, 400, 500)).toHaveLength(pads.length);
  });
});
