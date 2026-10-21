/**
 * The page selection the viewers share (#865): one selection for the
 * canvas, the Folio and the HTML pages, the breadcrumb that shows its path
 * and the panels it opens.
 *
 * A small external store, read by the viewers' DOM code without React and
 * by the breadcrumb through `useSyncExternalStore`. It keeps the selection
 * with the document it was resolved on: a viewer showing another layout
 * (a relayout, a locale switch, another view) calls {@link syncPageSelection}
 * with its document and the selection is found there again by its stable
 * ids.
 *
 * It also follows the page-template editor's canvas (#863) through its
 * events: a frame it picks is the selection, a frame it drags moves the
 * selection's mark and the panel's readout ({@link followFrameEditor}).
 */

import { useSyncExternalStore } from 'react';
import { findElement, sourceAt, type PageTemplate, type SourceMapOptions, type VDTDocument } from 'postext';
import type { Chapter } from '../book/types.js';
import type { FrameEditorEvent } from '../templates/frameEvents.js';
import { onFrameDragChange, setFrameDrag } from './frameDrag.js';

export { frameDragNow, type FrameDrag } from './frameDrag.js';
import { climb, climbable, atLevel, elementRectOnSheet, resolveSelection, type ChapterOfPage, type PageSelection } from './pageSelection.js';

/** What carries a selection out (opens the editor or a panel at it): the
 *  viewer that made it. */
export type SelectionApply = (sel: PageSelection, doc: VDTDocument) => void;

export interface PageSelectionState {
  selection: PageSelection;
  /** The document the selection is on (its page index and chain). */
  doc: VDTDocument;
  /** The source-map options it was read with (the file of each page). */
  options?: SourceMapOptions;
}

let state: PageSelectionState | null = null;
let apply: SelectionApply | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A frame dragged moves the selection's mark: the viewers redraw.
onFrameDragChange(emit);

export function pageSelectionNow(): PageSelectionState | null {
  return state;
}

/** Set (or let go, null) the selection; `by` carries it out on the
 *  editors when it is asked to again (a breadcrumb item, Esc). */
export function setPageSelection(next: PageSelection | null, doc?: VDTDocument | null, by?: SelectionApply | null, options?: SourceMapOptions): void {
  if (!next || !doc) {
    if (state === null) return;
    state = null;
    emit();
    return;
  }
  state = { selection: next, doc, ...(options ? { options } : {}) };
  if (by !== undefined) apply = by;
  emit();
}

export function clearPageSelection(): void {
  setPageSelection(null);
}

/** One level up (Esc): the element holding the one picked, carried out
 *  on the editors. Past the top the selection is let go. False when there
 *  was none to climb. */
export function climbPageSelection(): boolean {
  if (!state) return false;
  const up = climb(state.selection);
  if (!up) {
    clearPageSelection();
    return true;
  }
  state = { ...state, selection: up };
  emit();
  apply?.(up, state.doc);
  return true;
}

/** Pick another level of the selection's path (a breadcrumb item). */
export function selectPageLevel(level: number): void {
  if (!state) return;
  const next = atLevel(state.selection, level);
  state = { ...state, selection: next };
  emit();
  apply?.(next, state.doc);
}

/**
 * The selection on `doc`, the document a viewer shows: found again there
 * when it was made on another one. Returns it (null when it is gone or
 * there is none). Called by each viewer when it draws its marks.
 */
export function syncPageSelection(doc: VDTDocument, chapterOf?: ChapterOfPage, options?: SourceMapOptions): PageSelection | null {
  if (!state) return null;
  if (state.doc === doc) return state.selection;
  const found = resolveSelection(doc, state.selection, options ?? state.options, chapterOf);
  if (!found) {
    // Nothing of it on this layout (another chapter, another book): let go.
    state = null;
    queueMicrotask(emit);
    return null;
  }
  state = { selection: found, doc, ...(options ?? state.options ? { options: options ?? state.options } : {}) };
  // Listeners redraw; they call back with the same document: no loop.
  queueMicrotask(emit);
  return found;
}

export function onPageSelectionChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** The selection, null when none. */
export function usePageSelection(): PageSelectionState | null {
  return useSyncExternalStore(subscribe, pageSelectionNow, () => null);
}

/** The book's chapters, for what a selection looks up across chapters
 *  (the heading a contents entry lists): set by the Sandbox shell. */
let chaptersOf: (() => readonly Chapter[]) | null = null;

export function setSelectionChapters(get: (() => readonly Chapter[]) | null): void {
  chaptersOf = get;
}

export function selectionChapters(): readonly Chapter[] {
  return chaptersOf?.() ?? [];
}

/** The position in the book of the chapter `id`, or undefined (#943). */
export function carriedPosition(id: string): number | undefined {
  const at = selectionChapters().findIndex((c) => c.id === id);
  return at >= 0 ? at : undefined;
}

let templatesOf: (() => readonly PageTemplate[] | undefined) | null = null;

/** The book's page templates, for a design element of one picked on a
 *  page: the template editor opens on the template it belongs to (#899). */
export function setSelectionTemplates(get: (() => readonly PageTemplate[] | undefined) | null): void {
  templatesOf = get;
}

export function selectionTemplates(): readonly PageTemplate[] {
  return templatesOf?.() ?? [];
}

// ---------------------------------------------------------------------------
// The page-template editor's canvas (#863): its picks and drags
// ---------------------------------------------------------------------------

/** Follow the template editor's events (`templates/frameEvents.ts`): a
 *  frame it picks on the page is the page selection, at frame level (its
 *  path shows, Esc climbs to its group and template); while a frame is
 *  dragged, its mark and the panel's readout follow it. `doc` is the
 *  document the canvas shows; `by` carries a level picked in the path out. */
export function followFrameEditor(e: FrameEditorEvent, doc: VDTDocument | null, by: SelectionApply | null): void {
  switch (e.type) {
    case 'select': {
      if (!doc) return;
      const found = findElement(doc, e.frameId);
      const rect = found ? elementRectOnSheet(doc.pages[found.pageIndex], found.element) : undefined;
      if (!found || !rect) return;
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const chain = climbable(sourceAt(doc, found.pageIndex, point.x, point.y));
      const level = chain.findIndex((el) => el.id === e.frameId && el.level === 'frame');
      if (level < 0) return;
      setPageSelection({ pageIndex: found.pageIndex, chain, level, point, origin: 'page' }, doc, by);
      return;
    }
    case 'dragStart':
    case 'drag':
      if (e.frame) setFrameDrag({ pageIndex: e.pageIndex, frame: e.frame, rect: { ...e.rect } });
      return;
    case 'drop':
    case 'cancel':
      setFrameDrag(null);
      return;
  }
}

/** Forget everything (tests). */
export function resetPageSelection(): void {
  state = null;
  apply = null;
  setFrameDrag(null);
  emit();
}
