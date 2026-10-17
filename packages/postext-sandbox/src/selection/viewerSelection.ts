/**
 * The page selection in a viewer (#865): what the canvas, the HTML pages
 * and the Folio do with it when they draw their marks. The selection is
 * found again on the document the viewer shows, and the editor's caret,
 * when the reader moves it there, is followed on the page.
 */

import type { VDTDocument } from 'postext';
import type { ComposedBook } from '../book/types';
import { selectionAtSource, selectedElement, type ChapterOfPage, type PageSelection } from './pageSelection';
import { clearPageSelection, pageSelectionNow, setPageSelection, syncPageSelection } from './selectionStore';
import { createSelectionApply, type SelectionApplyDeps } from './applySelection';

/** The selection on `doc` (found again there if it was made on another
 *  layout), or null. */
export function selectionOn(doc: VDTDocument, chapterOf?: ChapterOfPage): PageSelection | null {
  return syncPageSelection(doc, chapterOf);
}

/** The chapter of each page, read from the books the pages map through:
 *  a book of one chapter names it. */
export function chapterOfPages(sourceOfPage: (pageIndex: number) => ComposedBook | null): ChapterOfPage {
  return (pageIndex) => {
    const book = sourceOfPage(pageIndex);
    return book?.segments.length === 1 ? book.segments[0]!.chapterId : undefined;
  };
}

/**
 * The editor's caret moved (the reader moved it, not a click on a page):
 * the page selection follows it, at the block it is in, so the path shows
 * where the caret is on the page. `head` is a document offset; `pages`
 * limits the search to the chapter's pages of a whole book; `carriedChapter`
 * is the position in the book of the chapter being edited, whose text a
 * story may have carried to a page of a later one.
 */
export function followEditorCaret(doc: VDTDocument, head: number, deps: SelectionApplyDeps, pages?: { from: number; to: number }, carriedChapter?: number): void {
  if (head < 0) return;
  const now = pageSelectionNow();
  // The caret may be in text a story of this chapter carried to a page of
  // a later one (#943): the chapter's own pages do not show it.
  const sel = selectionAtSource(doc, head, pages ? { pages } : undefined)
    ?? (carriedChapter !== undefined ? selectionAtSource(doc, head, { chapter: carriedChapter }) : null);
  if (!sel) {
    if (now?.selection.origin === 'editor') clearPageSelection();
    return;
  }
  if (now && now.doc === doc && now.selection.pageIndex === sel.pageIndex && selectedElement(now.selection).id === selectedElement(sel).id) {
    if (now.selection.origin === 'editor') return;
  }
  const chapter = chapterOfPages(deps.sourceOfPage)(sel.pageIndex);
  setPageSelection(chapter !== undefined ? { ...sel, chapter } : sel, doc, createSelectionApply(deps));
}

/** The caret position and the document the selection last followed. */
export interface CaretFollow {
  key: string | null;
  doc: VDTDocument | null;
}

/**
 * Whether the caret is to be followed again: it moved, or the page was laid
 * out again under a selection that follows it (while typing, the caret
 * moves before the layout catches up: the new layout is read again).
 */
export function followsCaret(last: CaretFollow, key: string | null, doc: VDTDocument): boolean {
  if (key === null) return false;
  if (key !== last.key) return true;
  return doc !== last.doc && pageSelectionNow()?.selection.origin === 'editor';
}
