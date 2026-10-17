/**
 * The labels of a figure on the canvas, in Design mode (#866). Every
 * label drawn on a page shows its box (`VDTFigureLabel.rect`, red when it
 * still overflows its width) and, for a label set at an anchor of its
 * picture, the anchor's point. Dragging the point (or the label) moves the
 * anchor: on release the point goes back through the picture's crop and
 * size to fractions of the whole picture and is written onto
 * `resource.anchors`, one step of the undo history. A click without a drag
 * opens the picture in the Resources panel; a double click opens its anchor
 * editor on that anchor.
 *
 * A label placed by percentages (`at="x% y%"`) moves the same way, and
 * its drop rewrites the `at` value in the Markdown of the edition on
 * screen (#931): the percentages are the edition's own words. Outside
 * Design mode nothing is drawn and the pointer is the text's (a click
 * selects the label's text, #865).
 *
 * The editor itself (`createLabelEditor`) knows nothing of the page it sits
 * on: a surface paints its marks and says how big a CSS pixel is there, and
 * the host feeds it the pointer. The Canvas and the HTML previews give each
 * page element one (`attachLabelAnchorEditor`: listeners in the capture
 * phase before the page-template editor's, which take only the presses that
 * land on a label); the Folio gives its pages one through
 * `attachPageInteraction` (#970), painting the marks into the page's
 * texture.
 */

import type { Dispatch, MutableRefObject } from 'react';
import type { Resource, VDTDocument } from 'postext';
import type { SandboxAction } from '../../context/SandboxContext';
import type { ComposedBook } from '../../book/types';
import type { SandboxLabels } from '../../types/labels';
import { segmentAtOffset } from '../../book/compose';
import { applyViewerEdit } from '../../editor/viewerEdits';
import { editModeNow, onEditModeChange } from '../../editing/editMode';
import { templateEditorHost } from '../../templates/editorStore';
import { requestAnchorEditor } from '../../panels/resources/anchorEditorRequest';
import { labelAt, labelsOnPage, sheetToPicture, type PageLabel } from './labelAnchorGeometry';
import { labelKey, labelMarkShapes, paintShapesSvg, type MarkShape } from './labelMarks';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** CSS px a pointer may travel before a press becomes a drag. */
const DRAG_START_CSS_PX = 3;
/** CSS px round an anchor point that grab it. */
const POINT_CSS_PX = 9;

export interface LabelAnchorEditorRefs {
  docRef: MutableRefObject<VDTDocument | null>;
  dispatchRef: MutableRefObject<Dispatch<SandboxAction>>;
  labelsRef?: MutableRefObject<SandboxLabels>;
  /** The book a page was laid out from, for the Markdown a label placed by
   *  percentages is rewritten in (#931). */
  sourceOfPage?: (pageIndex: number) => ComposedBook | null;
}

/** A point on a page of the document, in sheet pixels. */
export interface LabelPoint {
  pageIndex: number;
  x: number;
  y: number;
}

/** Where an editor paints and how big a pixel is there. */
export interface LabelSurface {
  /** Paint the marks of page `pageIndex` as the editor has them, in sheet
   *  px; null: the editor has nothing of its own to show on the page (a
   *  host that paints the label marks itself shows its own). */
  paint(pageIndex: number, shapes: MarkShape[] | null): void;
  /** Sheet px for one CSS px on screen at the page: how near a press must
   *  be to a point to take it, how far it must travel to be a drag. */
  sheetPxPerCssPx(pageIndex: number): number;
  /** The sheet px of one CSS px the marks are drawn at; `sheetPxPerCssPx`
   *  when left out. */
  markScale?(pageIndex: number): number;
}

export interface LabelEditorOptions {
  surface: LabelSurface;
  docRef: MutableRefObject<VDTDocument | null>;
  dispatchRef: MutableRefObject<Dispatch<SandboxAction>>;
  labelsRef?: MutableRefObject<SandboxLabels>;
  sourceOfPage?: (pageIndex: number) => ComposedBook | null;
  /** Whether labels can be edited now, besides Design mode (which the
   *  editor asks of itself): always, when left out. */
  enabled?: () => boolean;
  /** Pages whose label marks the editor paints at rest (the preview draws
   *  them itself). On any other page it paints only while a label of it is
   *  under the pointer or dragged, and hands the page back to the host's own
   *  marks (null) after. */
  restPages?: readonly number[];
  /** Keep the label last pressed marked (the preview does; the Folio's
   *  pages are repainted for the pointer alone). */
  keepActive?: boolean;
  /** A press the editor took ended (dropped or cancelled): the host frees
   *  its pointer capture. */
  onDragEnd?: (pointerId: number) => void;
}

/** What the editor needs of a pointer event. */
export interface LabelPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface LabelEditor {
  /** A press: true when a label took it (drag begun). */
  pointerDown(ev: LabelPointer, at: LabelPoint): boolean;
  /** The pointer moves without a button: whether a label is under it. */
  hover(at: LabelPoint | null): boolean;
  dragging(): boolean;
  /** The pointer moves while a label is held. */
  dragMove(ev: LabelPointer, at: LabelPoint | null): void;
  /** The press ends: the label is dropped where it was dragged, or its
   *  picture opened when it did not move. */
  pointerUp(ev: LabelPointer, cancelled: boolean): void;
  /** A double click on an anchored label opens its anchor editor. */
  dblclick(at: LabelPoint): boolean;
  /** Leave a drag (Escape). */
  cancel(): void;
  /** The pointer left the pages. */
  leave(): void;
  /** Read the labels again and paint (a relayout, a mode switch). */
  sync(): void;
  /** Paint again with the labels as they are (the label marked changed). */
  repaint(): void;
  dispose(): void;
}

interface Drag {
  pointerId: number;
  label: PageLabel;
  pageIndex: number;
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  started: boolean;
  dx: number;
  dy: number;
}

const live = new Set<LabelEditor>();
let subscribed = false;
/** The label last pressed (its stable id, else block id + text start). */
let activeKey: string | null = null;

const keyOf = labelKey;

/** Bring every page's label marks up to date (a relayout, a mode switch). */
export function syncLabelAnchorEditors(): void {
  for (const e of [...live]) e.sync();
}

/** Paint again every page's marks, with the labels as they are. */
function repaintLabelEditors(): void {
  for (const e of [...live]) e.repaint();
}

/** `resource` with anchor `id` moved to `(x, y)` (fractions, kept inside
 *  the picture, four decimals as the anchor editor stores them). */
export function withAnchorMoved(resource: Resource, id: string, x: number, y: number, now = Date.now()): Resource | null {
  const anchors = resource.anchors ?? [];
  const i = anchors.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const round = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
  const nx = round(x);
  const ny = round(y);
  if (anchors[i]!.x === nx && anchors[i]!.y === ny) return null;
  return { ...resource, anchors: anchors.map((a, k) => (k === i ? { ...a, x: nx, y: ny } : a)), updatedAt: now };
}

/** `x% y%` as `at="…"` writes a place: fractions of the whole picture,
 *  kept inside it, to a tenth of a percent. */
export function percentPlace(x: number, y: number): string {
  const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
  return `${pct(x)}% ${pct(y)}%`;
}

/** The edit that moves a label placed by percentages to the picture point
 *  `(x, y)`: its `at` value rewritten in the chapter the book's offsets
 *  fall in; null when the label has no `at` to rewrite, the book is not
 *  known, or the value is already that place. */
export function percentMoveEdit(pl: Pick<PageLabel, 'label'>, x: number, y: number, book: ComposedBook | null): { chapterId: string; changes: { from: number; to: number; insert: string }[]; baseLength: number } | null {
  const at = pl.label.atSource;
  if (!at || 'anchor' in pl.label.at || !book || book.segments.length === 0) return null;
  const seg = segmentAtOffset(book, at.start);
  if (at.start < seg.start || at.end > seg.end) return null;
  const insert = percentPlace(x, y);
  if (book.markdown.slice(at.start, at.end) === insert) return null;
  return { chapterId: seg.chapterId, changes: [{ from: at.start - seg.start, to: at.end - seg.start, insert }], baseLength: seg.end - seg.start };
}

/** Write the label dragged by `(dx, dy)` sheet px where it was dropped: its
 *  anchor on the resource (one step of the history), or the percentages in
 *  the text of the edition on screen. The drop of every surface (#970). */
export function dropLabel(pl: PageLabel, dx: number, dy: number, refs: Pick<LabelAnchorEditorRefs, 'dispatchRef' | 'sourceOfPage'>, pageIndex: number): void {
  const p = sheetToPicture(pl, pl.point.x + dx, pl.point.y + dy);
  if (!p) return;
  const id = pl.anchorId;
  if (id) {
    const host = templateEditorHost();
    if (!host) return;
    const resource = host.getState().resources.find((r) => r.id === pl.resourceId);
    const next = resource ? withAnchorMoved(resource, id, p.x, p.y) : null;
    // One step of the history (#899) per drop.
    if (next) refs.dispatchRef.current({ type: 'UPSERT_RESOURCE', payload: next, history: { merge: false } });
    return;
  }
  const edit = percentMoveEdit(pl, p.x, p.y, refs.sourceOfPage?.(pageIndex) ?? null);
  if (edit) applyViewerEdit(refs.dispatchRef.current, edit.chapterId, edit.changes, edit.baseLength);
}

/** A click on a label: its picture in the Resources panel. */
export function openLabelPicture(pl: PageLabel, dispatchRef: MutableRefObject<Dispatch<SandboxAction>>): void {
  const host = templateEditorHost();
  const s = host?.getState();
  if (s?.activePanel === 'resources' && s.activeResourceId === pl.resourceId) return;
  dispatchRef.current({ type: 'SET_PANEL', payload: 'resources' });
  dispatchRef.current({ type: 'SET_ACTIVE_RESOURCE', payload: pl.resourceId });
}

/**
 * The label editor of a surface (#970): the hit test, the hover, the drag
 * with its ghost, the drop and the click, for any page the host feeds it.
 * Labels are those drawn on the page in Design mode; outside it, and while
 * `enabled` says no, nothing is drawn and no press is taken.
 */
export function createLabelEditor(opts: LabelEditorOptions): LabelEditor {
  const { surface, docRef } = opts;
  const rest = new Set(opts.restPages ?? []);
  let drag: Drag | null = null;
  let hover: string | null = null;
  const cache = new Map<number, { doc: VDTDocument; labels: PageLabel[] }>();
  /** The pages the editor last painted, to hand them back. */
  const painted = new Set<number>();

  const labelsOn = (pageIndex: number): PageLabel[] => {
    const doc = docRef.current;
    if (!doc) return [];
    const hit = cache.get(pageIndex);
    if (hit?.doc === doc) return hit.labels;
    const labels = labelsOnPage(doc, pageIndex);
    cache.set(pageIndex, { doc, labels });
    return labels;
  };
  const active = (pageIndex: number): boolean => editModeNow() === 'design' && (opts.enabled?.() ?? true) && labelsOn(pageIndex).length > 0;
  const tolerance = (pageIndex: number): number => POINT_CSS_PX * surface.sheetPxPerCssPx(pageIndex);

  /** The pages with a label of the editor's in hand. */
  const engagedPages = (): Set<number> => {
    const pages = new Set<number>();
    if (drag) pages.add(drag.pageIndex);
    for (const [pageIndex, { labels }] of cache) {
      if (hover !== null && labels.some((l) => keyOf(l) === hover)) pages.add(pageIndex);
      if (opts.keepActive && activeKey !== null && labels.some((l) => keyOf(l) === activeKey)) pages.add(pageIndex);
    }
    return pages;
  };

  const paintPage = (pageIndex: number): void => {
    const doc = docRef.current;
    if (!doc || !active(pageIndex)) {
      if (painted.delete(pageIndex) || rest.has(pageIndex)) surface.paint(pageIndex, null);
      return;
    }
    const engaged = engagedPages().has(pageIndex);
    if (!rest.has(pageIndex) && !engaged) {
      if (painted.delete(pageIndex)) surface.paint(pageIndex, null);
      return;
    }
    const words = opts.labelsRef?.current;
    painted.add(pageIndex);
    surface.paint(pageIndex, labelMarkShapes(labelsOn(pageIndex), surface.markScale?.(pageIndex) ?? surface.sheetPxPerCssPx(pageIndex), {
      hover,
      active: opts.keepActive ? activeKey : null,
      drag: drag?.started && drag.pageIndex === pageIndex ? { key: keyOf(drag.label), dx: drag.dx, dy: drag.dy } : null,
    }, words ? { placedByPercent: words.labelAnchorsPlacedByPercent, overflow: words.labelAnchorsOverflow } : undefined));
  };
  const paintAll = (): void => {
    const pages = new Set<number>([...painted, ...engagedPages()]);
    for (const page of rest) pages.add(page);
    for (const page of pages) paintPage(page);
  };

  const finish = (pointerId: number): void => {
    drag = null;
    opts.onDragEnd?.(pointerId);
  };

  const editor: LabelEditor = {
    pointerDown(ev, at) {
      if (!active(at.pageIndex)) return false;
      const hit = labelAt(labelsOn(at.pageIndex), at.x, at.y, tolerance(at.pageIndex));
      if (!hit) return false;
      activeKey = keyOf(hit);
      drag = { pointerId: ev.pointerId, label: hit, pageIndex: at.pageIndex, startX: at.x, startY: at.y, startClientX: ev.clientX, startClientY: ev.clientY, started: false, dx: 0, dy: 0 };
      repaintLabelEditors();
      return true;
    },
    hover(at) {
      if (drag) return true;
      const hit = at && active(at.pageIndex) ? labelAt(labelsOn(at.pageIndex), at.x, at.y, tolerance(at.pageIndex)) : null;
      const key = hit ? keyOf(hit) : null;
      if (key !== hover) {
        const before = hover;
        hover = key;
        // The page the hover left and the one it came to.
        for (const [pageIndex, { labels }] of cache) {
          if (labels.some((l) => keyOf(l) === before || keyOf(l) === key)) paintPage(pageIndex);
        }
        if (at) paintPage(at.pageIndex);
      }
      return hit !== null;
    },
    dragging() {
      return drag !== null;
    },
    dragMove(ev, at) {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId || !at || at.pageIndex !== d.pageIndex) return;
      if (!d.started) {
        const dx = ev.clientX - d.startClientX;
        const dy = ev.clientY - d.startClientY;
        if (dx * dx + dy * dy < DRAG_START_CSS_PX * DRAG_START_CSS_PX) return;
        d.started = true;
      }
      d.dx = at.x - d.startX;
      d.dy = at.y - d.startY;
      paintPage(d.pageIndex);
    },
    pointerUp(ev, cancelled) {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      finish(ev.pointerId);
      if (!cancelled) {
        if (d.started) dropLabel(d.label, d.dx, d.dy, opts, d.pageIndex);
        else openLabelPicture(d.label, opts.dispatchRef);
      }
      paintPage(d.pageIndex);
    },
    dblclick(at) {
      if (!active(at.pageIndex)) return false;
      const hit = labelAt(labelsOn(at.pageIndex), at.x, at.y, tolerance(at.pageIndex));
      if (!hit?.anchorId) return false;
      requestAnchorEditor(opts.dispatchRef.current, { resourceId: hit.resourceId, anchor: hit.anchorId });
      return true;
    },
    cancel() {
      const d = drag;
      if (!d) return;
      finish(d.pointerId);
      paintPage(d.pageIndex);
    },
    leave() {
      if (hover !== null && !drag) {
        hover = null;
        paintAll();
      }
    },
    sync() {
      cache.clear();
      // The pages the editor paints are repainted from the new document;
      // the others come back through the host's next pointer.
      const doc = docRef.current;
      if (doc) for (const page of new Set([...painted, ...rest])) cache.set(page, { doc, labels: labelsOnPage(doc, page) });
      paintAll();
    },
    repaint() {
      paintAll();
    },
    dispose() {
      live.delete(editor);
      drag = null;
      for (const page of [...painted]) surface.paint(page, null);
      painted.clear();
    },
  };
  live.add(editor);
  if (!subscribed) {
    subscribed = true;
    onEditModeChange(syncLabelAnchorEditors);
  }
  return editor;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The editor of one page element of the Canvas or the HTML preview: its
 *  marks are an SVG over the page, and its listeners take the presses that
 *  land on a label before the page-template editor's. */
export function attachLabelAnchorEditor(slot: HTMLElement, pageIndex: number, pageWidthPx: number, pageHeightPx: number, refs: LabelAnchorEditorRefs): void {
  const svg = svgEl('svg', { viewBox: `0 0 ${pageWidthPx} ${pageHeightPx}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  svg.dataset.role = 'labelAnchors';
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '7', overflow: 'visible' } satisfies Partial<CSSStyleDeclaration>);
  let handledPress = false;

  const sheetPerCss = (): number => {
    const w = slot.getBoundingClientRect().width;
    return w > 0 ? pageWidthPx / w : 1;
  };
  const locate = (ev: MouseEvent): LabelPoint | null => {
    const r = slot.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { pageIndex, x: (ev.clientX - r.left) * (pageWidthPx / r.width), y: (ev.clientY - r.top) * (pageHeightPx / r.height) };
  };

  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !editor.dragging()) return;
    ev.stopPropagation();
    ev.preventDefault();
    editor.cancel();
  };
  const editor = createLabelEditor({
    surface: {
      paint: (_page, shapes) => {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        if (!shapes) {
          if (svg.parentNode) svg.remove();
          return;
        }
        if (svg.parentNode !== slot) slot.appendChild(svg);
        paintShapesSvg(svg, shapes);
      },
      sheetPxPerCssPx: sheetPerCss,
    },
    docRef: refs.docRef,
    dispatchRef: refs.dispatchRef,
    ...(refs.labelsRef ? { labelsRef: refs.labelsRef } : {}),
    ...(refs.sourceOfPage ? { sourceOfPage: refs.sourceOfPage } : {}),
    restPages: [pageIndex],
    keepActive: true,
    onDragEnd: (pointerId) => {
      window.removeEventListener('keydown', onEscape, true);
      try { slot.releasePointerCapture(pointerId); } catch { /* not captured */ }
    },
  });

  slot.addEventListener('pointerdown', (ev) => {
    handledPress = false;
    if (ev.button !== 0) return;
    if ((ev.target as Element | null)?.closest?.('[role="dialog"]')) return;
    const at = locate(ev);
    if (!at || !editor.pointerDown(ev, at)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    handledPress = true;
    try { slot.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
    window.addEventListener('keydown', onEscape, true);
  }, true);

  slot.addEventListener('pointermove', (ev) => {
    if (editor.dragging()) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      editor.dragMove(ev, locate(ev));
      return;
    }
    const over = editor.hover(locate(ev));
    if (over) {
      // Over a label: the template editor leaves the cursor alone.
      ev.stopImmediatePropagation();
      slot.style.cursor = 'grab';
    } else if (slot.style.cursor === 'grab') {
      slot.style.cursor = '';
    }
  }, true);

  const end = (ev: PointerEvent): void => {
    if (!editor.dragging()) return;
    ev.stopImmediatePropagation();
    editor.pointerUp(ev, ev.type !== 'pointerup');
  };
  slot.addEventListener('pointerup', end, true);
  slot.addEventListener('pointercancel', end, true);
  slot.addEventListener('pointerleave', () => editor.leave());
  // A press the editor took is not a click on the page; a double click
  // opens the picture's anchor editor on the anchor.
  for (const type of ['click', 'mousedown', 'mouseup'] as const) {
    slot.addEventListener(type, (ev) => {
      if (!handledPress) return;
      if (type === 'click') handledPress = false;
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }, true);
  }
  slot.addEventListener('dblclick', (ev) => {
    const at = locate(ev);
    if (!at || !editor.dblclick(at)) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }, true);

  editor.sync();
}
