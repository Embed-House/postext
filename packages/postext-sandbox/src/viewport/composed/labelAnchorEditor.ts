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
 * screen (#931): the percentages are the edition's own words. The HTML
 * and Folio previews show the same marks, read only (`labelMarks.ts`).
 * Outside Design mode nothing is drawn and the pointer is the text's (a
 * click selects the label's text, #865).
 * The listeners run in the capture phase before the page-template editor's
 * and take only the presses that land on a label.
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
import { labelKey, labelMarkShapes, paintShapesSvg } from './labelMarks';

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

interface Drag {
  pointerId: number;
  label: PageLabel;
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  started: boolean;
  dx: number;
  dy: number;
}

interface Instance {
  slot: HTMLElement;
  paint(): void;
}

const live = new Set<Instance>();
let subscribed = false;
/** The label last pressed (its stable id, else block id + text start). */
let activeKey: string | null = null;

const keyOf = labelKey;

/** Bring every page's label marks up to date (a relayout, a mode switch). */
export function syncLabelAnchorEditors(): void {
  for (const e of [...live]) {
    if (!e.slot.isConnected) live.delete(e);
    else e.paint();
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
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

export function attachLabelAnchorEditor(slot: HTMLElement, pageIndex: number, pageWidthPx: number, pageHeightPx: number, refs: LabelAnchorEditorRefs): void {
  const svg = svgEl('svg', { viewBox: `0 0 ${pageWidthPx} ${pageHeightPx}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  svg.dataset.role = 'labelAnchors';
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '7', overflow: 'visible' } satisfies Partial<CSSStyleDeclaration>);
  let drag: Drag | null = null;
  let hover: string | null = null;
  let handledPress = false;
  let cache: { doc: VDTDocument; labels: PageLabel[] } | null = null;

  const labels = (): PageLabel[] => {
    const doc = refs.docRef.current;
    if (!doc) return [];
    if (cache?.doc !== doc) cache = { doc, labels: labelsOnPage(doc, pageIndex) };
    return cache.labels;
  };
  const active = (): boolean => editModeNow() === 'design' && labels().length > 0;
  const sheetPerCss = (): number => {
    const w = slot.getBoundingClientRect().width;
    return w > 0 ? pageWidthPx / w : 1;
  };
  const locate = (ev: MouseEvent): { x: number; y: number } | null => {
    const r = slot.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: (ev.clientX - r.left) * (pageWidthPx / r.width), y: (ev.clientY - r.top) * (pageHeightPx / r.height) };
  };

  const paint = (): void => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!active()) {
      if (svg.parentNode) svg.remove();
      return;
    }
    if (svg.parentNode !== slot) slot.appendChild(svg);
    const words = refs.labelsRef?.current;
    paintShapesSvg(svg, labelMarkShapes(labels(), sheetPerCss(), {
      hover,
      active: activeKey,
      drag: drag?.started ? { key: keyOf(drag.label), dx: drag.dx, dy: drag.dy } : null,
    }, words ? { placedByPercent: words.labelAnchorsPlacedByPercent, overflow: words.labelAnchorsOverflow } : undefined));
  };

  /** Write the label dragged to where the pointer left it: its anchor on
   *  the resource, or the percentages in the text. */
  const commit = (d: Drag): void => {
    const p = sheetToPicture(d.label, d.label.point.x + d.dx, d.label.point.y + d.dy);
    if (!p) return;
    const id = d.label.anchorId;
    if (id) {
      const host = templateEditorHost();
      if (!host) return;
      const resource = host.getState().resources.find((r) => r.id === d.label.resourceId);
      const next = resource ? withAnchorMoved(resource, id, p.x, p.y) : null;
      // One step of the history (#899) per drop.
      if (next) refs.dispatchRef.current({ type: 'UPSERT_RESOURCE', payload: next, history: { merge: false } });
      return;
    }
    const edit = percentMoveEdit(d.label, p.x, p.y, refs.sourceOfPage?.(pageIndex) ?? null);
    if (edit) applyViewerEdit(refs.dispatchRef.current, edit.chapterId, edit.changes, edit.baseLength);
  };

  /** A click on a label: its picture in the Resources panel. */
  const openPicture = (pl: PageLabel): void => {
    const host = templateEditorHost();
    const s = host?.getState();
    if (s?.activePanel === 'resources' && s.activeResourceId === pl.resourceId) return;
    refs.dispatchRef.current({ type: 'SET_PANEL', payload: 'resources' });
    refs.dispatchRef.current({ type: 'SET_ACTIVE_RESOURCE', payload: pl.resourceId });
  };

  slot.addEventListener('pointerdown', (ev) => {
    handledPress = false;
    if (!active() || ev.button !== 0) return;
    if ((ev.target as Element | null)?.closest?.('[role="dialog"]')) return;
    const at = locate(ev);
    if (!at) return;
    const hit = labelAt(labels(), at.x, at.y, POINT_CSS_PX * sheetPerCss());
    if (!hit) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    handledPress = true;
    try { slot.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
    window.addEventListener('keydown', onEscape, true);
    activeKey = keyOf(hit);
    drag = { pointerId: ev.pointerId, label: hit, startX: at.x, startY: at.y, startClientX: ev.clientX, startClientY: ev.clientY, started: false, dx: 0, dy: 0 };
    syncLabelAnchorEditors();
  }, true);

  slot.addEventListener('pointermove', (ev) => {
    if (drag && ev.pointerId === drag.pointerId) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      const at = locate(ev);
      if (!at) return;
      if (!drag.started) {
        const dx = ev.clientX - drag.startClientX;
        const dy = ev.clientY - drag.startClientY;
        if (dx * dx + dy * dy < DRAG_START_CSS_PX * DRAG_START_CSS_PX) return;
        drag.started = true;
      }
      drag.dx = at.x - drag.startX;
      drag.dy = at.y - drag.startY;
      paint();
      return;
    }
    if (!active()) return;
    const at = locate(ev);
    if (!at) return;
    const hit = labelAt(labels(), at.x, at.y, POINT_CSS_PX * sheetPerCss());
    const key = hit ? keyOf(hit) : null;
    if (key !== hover) {
      hover = key;
      paint();
    }
    if (hit) {
      // Over a label: the template editor leaves the cursor alone.
      ev.stopImmediatePropagation();
      slot.style.cursor = 'grab';
    } else if (slot.style.cursor === 'grab') {
      slot.style.cursor = '';
    }
  }, true);

  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !drag) return;
    ev.stopPropagation();
    ev.preventDefault();
    const pointerId = drag.pointerId;
    drag = null;
    window.removeEventListener('keydown', onEscape, true);
    try { slot.releasePointerCapture(pointerId); } catch { /* not captured */ }
    paint();
  };

  const end = (ev: PointerEvent): void => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    ev.stopImmediatePropagation();
    const d = drag;
    drag = null;
    window.removeEventListener('keydown', onEscape, true);
    try { slot.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    if (ev.type === 'pointerup') {
      if (d.started) commit(d);
      else openPicture(d.label);
    }
    paint();
  };
  slot.addEventListener('pointerup', end, true);
  slot.addEventListener('pointercancel', end, true);
  slot.addEventListener('pointerleave', () => {
    if (hover !== null && !drag) {
      hover = null;
      paint();
    }
  });
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
    if (!active()) return;
    const at = locate(ev);
    if (!at) return;
    const hit = labelAt(labels(), at.x, at.y, POINT_CSS_PX * sheetPerCss());
    if (!hit?.anchorId) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    requestAnchorEditor(refs.dispatchRef.current, { resourceId: hit.resourceId, anchor: hit.anchorId });
  }, true);

  const instance: Instance = { slot, paint };
  live.add(instance);
  if (!subscribed) {
    subscribed = true;
    onEditModeChange(syncLabelAnchorEditors);
  }
  paint();
}
