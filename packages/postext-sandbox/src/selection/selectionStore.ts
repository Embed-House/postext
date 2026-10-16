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
 * It also carries the small event API the page-template editor's canvas
 * drag (#863) reports to, so the panel and the selection follow a frame
 * while it is dragged ({@link emitFrameDrag}, {@link onFrameDrag}).
 */

import { useSyncExternalStore } from 'react';
import type { SourceMapOptions, VDTDocument } from 'postext';
import type { Chapter } from '../book/types';
import { climb, atLevel, resolveSelection, type ChapterOfPage, type PageSelection } from './pageSelection';

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

// ---------------------------------------------------------------------------
// A frame dragged on the page (#863's canvas editor reports here)
// ---------------------------------------------------------------------------

/** A frame being moved or resized on a page: where it is now, sheet px. */
export interface FrameDragEvent {
  phase: 'start' | 'move' | 'end' | 'cancel';
  pageIndex: number;
  /** `cp<fence>:<name>`. */
  frameId: string;
  /** JSON pointer of the template entry. */
  configPath: string;
  rect: { x: number; y: number; width: number; height: number };
}

const dragListeners = new Set<(ev: FrameDragEvent) => void>();
let dragging: FrameDragEvent | null = null;

/** Report a frame drag: the panel showing the frame and the selection's
 *  mark follow it while the pointer moves, before anything is written. */
export function emitFrameDrag(ev: FrameDragEvent): void {
  dragging = ev.phase === 'end' || ev.phase === 'cancel' ? null : ev;
  for (const l of [...dragListeners]) l(ev);
  emit();
}

export function onFrameDrag(listener: (ev: FrameDragEvent) => void): () => void {
  dragListeners.add(listener);
  return () => { dragListeners.delete(listener); };
}

/** The frame being dragged now, null when none. */
export function frameDragNow(): FrameDragEvent | null {
  return dragging;
}

/** Forget everything (tests). */
export function resetPageSelection(): void {
  state = null;
  apply = null;
  dragging = null;
  emit();
}
