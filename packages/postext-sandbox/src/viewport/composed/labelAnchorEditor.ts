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
 * A label set away from its point (`ResourceAnchor.labelAt`, #1064) shows a
 * line to its point; dragging it moves where it stands (`labelAt`), not the
 * anchor. Alt held while dragging a label at its point sets it away the
 * same way.
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
import type { SandboxAction } from '../../context/SandboxContext.js';
import type { ComposedBook } from '../../book/types.js';
import type { SandboxLabels } from '../../types/labels.js';
import { segmentAtOffset } from '../../book/compose.js';
import { applyViewerEdit } from '../../editor/viewerEdits.js';
import { editModeNow, onEditModeChange } from '../../editing/editMode.js';
import { templateEditorHost } from '../../templates/editorStore.js';
import { requestAnchorEditor } from '../../panels/resources/anchorEditorRequest.js';
import { labelAt, labelsOnPage, sheetToPicture, type PageLabel } from './labelAnchorGeometry.js';
import { labelKey, labelMarkShapes, paintShapesSvg, type MarkShape } from './labelMarks.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** CSS px a pointer may travel before a press becomes a drag. */
const DRAG_START_CSS_PX = 3;
/** CSS px round an anchor point that grab it. */
const POINT_CSS_PX = 9;
/** The same for a finger or a pen (#992): a fingertip lands on a spot about
 *  as wide as the 44 px target the interface sets everywhere else, and
 *  wanders a few px between the press and the lift. */
const POINT_TOUCH_CSS_PX = 22;
const DRAG_START_TOUCH_CSS_PX = 8;

/** Whether a pointer is a finger or a pen rather than a mouse. */
const isFinger = (pointerType: string | undefined): boolean => pointerType === 'touch' || pointerType === 'pen';
/** CSS px round a point that a pointer of this kind grabs. */
export const pointGrabCssPx = (pointerType?: string): number => (isFinger(pointerType) ? POINT_TOUCH_CSS_PX : POINT_CSS_PX);
/** CSS px a pointer of this kind travels before a press is a drag. */
export const dragStartCssPx = (pointerType?: string): number => (isFinger(pointerType) ? DRAG_START_TOUCH_CSS_PX : DRAG_START_CSS_PX);

/** A box laid over a mark for a touch screen (#992), as fractions of the
 *  page: the browser decides at the first touch whether a finger scrolls the
 *  page or is the page's own, from the `touch-action` of what is under it,
 *  and the marks are drawn in an SVG that takes no pointer. A pad is that
 *  something: `touch-action: none` under every label's box and point, so a
 *  finger that lands on a label drags it and one that lands on bare paper
 *  scrolls the canvas. `minCssPx` is the least a side measures on screen. */
export interface TouchPad {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  minCssPx: number;
}

/** The pads of a page's `shapes` (sheet px, a page `pageWidthPx` by
 *  `pageHeightPx`): a box for each label's outline and a finger's width
 *  round each point. The ghost of a drag has none, the finger is down. */
export function touchPads(shapes: readonly MarkShape[], pageWidthPx: number, pageHeightPx: number): TouchPad[] {
  const pads: TouchPad[] = [];
  for (const s of shapes) {
    if (s.kind === 'circle') {
      pads.push({ centerX: s.cx / pageWidthPx, centerY: s.cy / pageHeightPx, width: 0, height: 0, minCssPx: 2 * POINT_TOUCH_CSS_PX });
    } else if (s.kind === 'polygon' && !s.fill && s.points.length > 0) {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      pads.push({ centerX: (x0 + Math.max(...xs)) / 2 / pageWidthPx, centerY: (y0 + Math.max(...ys)) / 2 / pageHeightPx, width: (Math.max(...xs) - x0) / pageWidthPx, height: (Math.max(...ys) - y0) / pageHeightPx, minCssPx: 0 });
    }
  }
  return pads;
}

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
  /** `mouse`, `touch` or `pen`; a mouse when left out. */
  pointerType?: string;
  clientX: number;
  clientY: number;
  /** Alt held: the drag sets the label away from its point (#1064). */
  altKey?: boolean;
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
  pointerType: string | undefined;
  label: PageLabel;
  pageIndex: number;
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  started: boolean;
  dx: number;
  dy: number;
  /** The drop writes `labelAt` (#1064). */
  away: boolean;
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

/** `resource` with the label of anchor `id` set at `(x, y)` away from its
 *  point (`labelAt`, #1064; fractions of the whole picture, four decimals,
 *  not kept inside it: a label may stand off the picture). */
export function withLabelAtMoved(resource: Resource, id: string, x: number, y: number, now = Date.now()): Resource | null {
  const anchors = resource.anchors ?? [];
  const i = anchors.findIndex((a) => a.id === id);
  if (i < 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const at = { x: round(x), y: round(y) };
  const before = anchors[i]!.labelAt;
  if (before && before.x === at.x && before.y === at.y) return null;
  return { ...resource, anchors: anchors.map((a, k) => (k === i ? { ...a, labelAt: at } : a)), updatedAt: now };
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
export function dropLabel(pl: PageLabel, dx: number, dy: number, refs: Pick<LabelAnchorEditorRefs, 'dispatchRef' | 'sourceOfPage'>, pageIndex: number, away = false): void {
  const p = sheetToPicture(pl, pl.point.x + dx, pl.point.y + dy);
  if (!p) return;
  const id = pl.anchorId;
  if (id) {
    const host = templateEditorHost();
    if (!host) return;
    const resource = host.getState().resources.find((r) => r.id === pl.resourceId);
    // A label away from its point moves where it stands (#1064).
    const next = !resource ? null : away || pl.anchorPoint ? withLabelAtMoved(resource, id, p.x, p.y) : withAnchorMoved(resource, id, p.x, p.y);
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
  const tolerance = (pageIndex: number, pointerType?: string): number => pointGrabCssPx(pointerType) * surface.sheetPxPerCssPx(pageIndex);

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
      drag: drag?.started && drag.pageIndex === pageIndex ? { key: keyOf(drag.label), dx: drag.dx, dy: drag.dy, away: drag.away } : null,
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
      const hit = labelAt(labelsOn(at.pageIndex), at.x, at.y, tolerance(at.pageIndex, ev.pointerType));
      if (!hit) return false;
      activeKey = keyOf(hit);
      drag = { pointerId: ev.pointerId, pointerType: ev.pointerType, label: hit, pageIndex: at.pageIndex, startX: at.x, startY: at.y, startClientX: ev.clientX, startClientY: ev.clientY, started: false, dx: 0, dy: 0, away: !!hit.anchorPoint || (!!ev.altKey && !!hit.anchorId) };
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
        const start = dragStartCssPx(d.pointerType);
        if (dx * dx + dy * dy < start * start) return;
        d.started = true;
      }
      d.dx = at.x - d.startX;
      d.dy = at.y - d.startY;
      d.away = !!d.label.anchorPoint || (!!ev.altKey && !!d.label.anchorId);
      paintPage(d.pageIndex);
    },
    pointerUp(ev, cancelled) {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      finish(ev.pointerId);
      if (!cancelled) {
        if (d.started) dropLabel(d.label, d.dx, d.dy, opts, d.pageIndex, d.away);
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

  // The pads of a touch screen (#992): see `TouchPad`. A mouse needs none,
  // and on a screen that also has one they would only get in its way.
  const pads = document.createElement('div');
  pads.dataset.role = 'labelPads';
  pads.setAttribute('aria-hidden', 'true');
  Object.assign(pads.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '8' } satisfies Partial<CSSStyleDeclaration>);
  const touchOnly = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  const syncPads = (shapes: MarkShape[] | null): void => {
    const list = shapes && touchOnly() ? touchPads(shapes, pageWidthPx, pageHeightPx) : [];
    if (list.length === 0) {
      if (pads.parentNode) pads.remove();
      return;
    }
    if (pads.parentNode !== slot) slot.appendChild(pads);
    while (pads.children.length > list.length) pads.lastChild?.remove();
    list.forEach((pad, i) => {
      let el = pads.children[i] as HTMLElement | undefined;
      if (!el) {
        el = document.createElement('div');
        Object.assign(el.style, { position: 'absolute', transform: 'translate(-50%, -50%)', touchAction: 'none', pointerEvents: 'auto' } satisfies Partial<CSSStyleDeclaration>);
        pads.appendChild(el);
      }
      el.style.left = `${pad.centerX * 100}%`;
      el.style.top = `${pad.centerY * 100}%`;
      el.style.width = `max(${pad.width * 100}%, ${pad.minCssPx}px)`;
      el.style.height = `max(${pad.height * 100}%, ${pad.minCssPx}px)`;
    });
  };

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
        syncPads(shapes);
        if (!shapes) {
          if (svg.parentNode) svg.remove();
          return;
        }
        if (svg.parentNode !== slot) slot.appendChild(svg);
        // A page of a spread draws its own half of a label across the
        // spine; the facing page draws the other half from its copy (#1040).
        svg.style.overflow = refs.docRef.current?.pages[pageIndex]?.composed?.spread ? 'hidden' : 'visible';
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
