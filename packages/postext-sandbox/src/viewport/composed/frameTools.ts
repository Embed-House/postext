/**
 * The composed-page tools of the page viewers (#864): what a click and a
 * double click do on a frame, by mode.
 *
 * - Content mode: a click on a frame (off its words) puts the editor's
 *   caret in its slot, writing an empty slot fence first for an empty
 *   frame. A click or a double click on its words (its label tab
 *   included) selects and edits them as anywhere else (the caller's).
 * - Design mode: a click picks the frame (`selectFrame`) for the template
 *   editor; the text is not edited.
 */

import type { Dispatch, MutableRefObject } from 'react';
import { resolvePageTemplate, type PageTemplateSource, type VDTComicPage, type VDTDocument, type VDTFrame, type VDTPage } from 'postext';
import type { SandboxAction } from '../../context/SandboxContext.js';
import type { ComposedBook } from '../../book/types.js';
import type { PanelId } from '../../types/index.js';
import { segmentAtOffset } from '../../book/compose.js';
import { applyViewerEdit } from '../../editor/viewerEdits.js';
import { editModeNow, selectFrame } from '../../editing/editMode.js';
import { comicTextHitAt, frameHitAt, frameIsEmpty, framesTopFirst, pointInFrame, sheetToFlow } from './frameHit.js';
import { emptyMarkRect } from './frameOverlay.js';
import { comicTextCaret, frameClickTarget } from './frameLink.js';

export interface FrameToolsDeps {
  docRef: MutableRefObject<VDTDocument | null>;
  dispatchRef: MutableRefObject<Dispatch<SandboxAction>>;
  activePanelRef: MutableRefObject<PanelId | null>;
  sourceOfPage: (pageIndex: number) => ComposedBook | null;
}

export interface FrameTools {
  /** Handle a click at a sheet point; true when it was the frame's. */
  click(pageIndex: number, x: number, y: number): boolean;
  /** Handle a double click; true when it was the frame's (Design mode:
   *  a frame is picked, its words are not selected). */
  dblclick(pageIndex: number, x: number, y: number): boolean;
  /** Whether the point is on a frame of a composed page. */
  frameAt(pageIndex: number, x: number, y: number): VDTFrame | null;
  /** Put the caret in the frame's slot (Content mode), writing an empty
   *  slot first when it has none (#865: a frame picked on the page). */
  openSlot(pageIndex: number, frame: VDTFrame): boolean;
}

const inRect = (r: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** Whether the point lies on one of the frame's content blocks (its words,
 *  its pictures): those keep the viewer's own click. */
export function onFrameContent(page: VDTPage, frame: VDTFrame, x: number, y: number): boolean {
  const ids = new Set(frame.blockIds.slice(1));
  for (const b of page.floats ?? []) {
    if (ids.has(b.id) && inRect(b.bbox, x, y)) return true;
  }
  return false;
}

/** The frame under the point, an empty frame's mark counted as its box
 *  (where «Write here» shows). */
export function frameOrMarkAt(page: VDTPage, x: number, y: number): VDTFrame | null {
  const hit = frameHitAt(page, x, y);
  if (hit) return hit;
  for (const f of framesTopFirst(page)) {
    if (frameIsEmpty(f) && pointInFrame({ rect: emptyMarkRect(page, f), rotate: f.rotate }, x, y)) return f;
  }
  return null;
}

export function createFrameTools(deps: FrameToolsDeps): FrameTools {
  const pageOf = (pageIndex: number): VDTPage | null => deps.docRef.current?.pages[pageIndex] ?? null;
  // The pointer gives sheet points; a composed page's frames are in its
  // flow frame (#929).
  const frameAt = (pageIndex: number, x: number, y: number): VDTFrame | null => {
    const page = pageOf(pageIndex);
    if (!page?.composed) return null;
    const f = sheetToFlow(page, x, y);
    return frameOrMarkAt(page, f.x, f.y);
  };

  /** Focus the editor at a book offset of `book` (its chapter's). */
  const focusAt = (book: ComposedBook, bookOffset: number, chapterAnchor: number): void => {
    const dispatch = deps.dispatchRef.current;
    if (deps.activePanelRef.current !== 'markdown') dispatch({ type: 'SET_PANEL', payload: 'markdown' });
    const seg = book.segments.length > 0 ? segmentAtOffset(book, chapterAnchor) : null;
    const local = seg ? bookOffset - seg.start : bookOffset;
    dispatch({
      type: 'SET_PENDING_EDITOR_FOCUS',
      payload: { ...(seg ? { chapterId: seg.chapterId } : {}), anchor: local, head: local, selectWord: false, fromViewer: true },
    });
  };

  /** Write `changes` (book offsets) into the chapter holding `at`. */
  const write = (book: ComposedBook, at: number, changes: { from: number; to: number; insert: string }[]): boolean => {
    if (book.segments.length === 0) return false;
    const seg = segmentAtOffset(book, at);
    if (changes.some((c) => c.from < seg.start || c.to > seg.end)) return false;
    applyViewerEdit(deps.dispatchRef.current, seg.chapterId, changes.map((c) => ({ from: c.from - seg.start, to: c.to - seg.start, insert: c.insert })), seg.end - seg.start);
    return true;
  };

  const openSlot = (pageIndex: number, frame: VDTFrame): boolean => {
    const page = pageOf(pageIndex);
    const book = deps.sourceOfPage(pageIndex);
    const doc = deps.docRef.current;
    if (!page?.composed || !book || !doc) return false;
    const template = resolvePageTemplate(doc.config as unknown as PageTemplateSource, page.composed.template, page.composed.modules ? { modules: page.composed.modules } : {});
    const target = frameClickTarget(book.markdown, page.composed, frame, template);
    if (!target) return false;
    if (target.kind === 'caret') {
      focusAt(book, target.offset, page.composed.sourceStart);
      return true;
    }
    if (!write(book, page.composed.sourceStart, [{ from: target.at, to: target.at, insert: target.insert }])) return false;
    focusAt(book, target.caret, page.composed.sourceStart);
    return true;
  };

  /** A comic's text frame (`::panel{text}`, #885) under the point, on a
   *  comic page or a strip (#959): in Content mode a click off its words
   *  puts the caret at its text. Its words keep the viewer's own click and
   *  double click; Design mode leaves
   *  the comic to its tools. */
  const comicText = (page: VDTPage | null, x: number, y: number): { comic: VDTComicPage; frame: VDTFrame } | null =>
    page && !page.composed && editModeNow() !== 'design' ? comicTextHitAt(page, x, y) : null;

  return {
    frameAt,
    click(pageIndex, x, y) {
      const page = pageOf(pageIndex);
      const hit = comicText(page, x, y);
      if (page && hit) {
        // The text frame stands on the sheet; its blocks are in the page's
        // flow frame (#909).
        const f = sheetToFlow(page, x, y);
        if (onFrameContent(page, hit.frame, f.x, f.y)) return false;
        const book = deps.sourceOfPage(pageIndex);
        const at = comicTextCaret(page, hit.frame);
        if (!book || at === null) return false;
        focusAt(book, at, hit.comic.sourceStart);
        return true;
      }
      const f = sheetToFlow(page, x, y);
      const frame = page?.composed ? frameOrMarkAt(page, f.x, f.y) : null;
      if (!page?.composed || !frame) return false;
      if (editModeNow() === 'design') {
        selectFrame({ pageIndex, frameId: frame.id, name: frame.name, template: page.composed.template, configPath: frame.configPath });
        return true;
      }
      if (onFrameContent(page, frame, f.x, f.y)) return false;
      return openSlot(pageIndex, frame);
    },
    openSlot,
    dblclick(pageIndex, x, y) {
      // Content mode: the words are selected as anywhere else.
      if (editModeNow() !== 'design') return false;
      const page = pageOf(pageIndex);
      const f = sheetToFlow(page, x, y);
      return !!page?.composed && frameHitAt(page, f.x, f.y) !== null;
    },
  };
}
