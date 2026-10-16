/**
 * The composed-page tools of the page viewers (#864): what a click and a
 * double click do on a frame, by mode.
 *
 * - Content mode: a click on a frame (off its words) puts the editor's
 *   caret in its slot, writing an empty slot fence first for an empty
 *   frame; a double click on its label tab or on a paragraph opens a field
 *   on the page that writes the Markdown back. A click on its words places
 *   the caret at the word, as anywhere else (the caller's).
 * - Design mode: a click picks the frame (`selectFrame`) for the template
 *   editor; the text is not edited.
 */

import type { Dispatch, MutableRefObject } from 'react';
import { resolvePageTemplate, type PageTemplateSource, type VDTDocument, type VDTFrame, type VDTPage } from 'postext';
import type { SandboxAction } from '../../context/SandboxContext';
import type { ComposedBook } from '../../book/types';
import type { PanelId } from '../../types';
import type { SandboxLabels } from '../../types/labels';
import { segmentAtOffset } from '../../book/compose';
import { applyViewerEdit } from '../../editor/viewerEdits';
import { editModeNow, selectFrame } from '../../editing/editMode';
import { frameHitAt, frameIsEmpty, framesTopFirst, pointInFrame } from './frameHit';
import { emptyMarkRect } from './frameOverlay';
import { frameClickTarget, frameTextChange, frameTextTargetAt } from './frameLink';
import { openFrameTextEditor, type FrameEditSurface } from './frameTextEditor';

export interface FrameToolsDeps {
  docRef: MutableRefObject<VDTDocument | null>;
  dispatchRef: MutableRefObject<Dispatch<SandboxAction>>;
  activePanelRef: MutableRefObject<PanelId | null>;
  sourceOfPage: (pageIndex: number) => ComposedBook | null;
  labelsRef?: MutableRefObject<SandboxLabels>;
  /** Where a field over a frame's text goes; none: no editing on the page. */
  surface?: FrameEditSurface;
}

export interface FrameTools {
  /** Handle a click at a sheet point; true when it was the frame's. */
  click(pageIndex: number, x: number, y: number): boolean;
  /** Handle a double click; true when it opened a field (or picked a
   *  frame in Design mode). */
  dblclick(pageIndex: number, x: number, y: number): boolean;
  /** Whether the point is on a frame of a composed page. */
  frameAt(pageIndex: number, x: number, y: number): VDTFrame | null;
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
  const frameAt = (pageIndex: number, x: number, y: number): VDTFrame | null => {
    const page = pageOf(pageIndex);
    return page?.composed ? frameOrMarkAt(page, x, y) : null;
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

  return {
    frameAt,
    click(pageIndex, x, y) {
      const page = pageOf(pageIndex);
      const frame = page?.composed ? frameOrMarkAt(page, x, y) : null;
      if (!page?.composed || !frame) return false;
      if (editModeNow() === 'design') {
        selectFrame({ pageIndex, frameId: frame.id, name: frame.name, template: page.composed.template, configPath: frame.configPath });
        return true;
      }
      if (onFrameContent(page, frame, x, y)) return false;
      const book = deps.sourceOfPage(pageIndex);
      const doc = deps.docRef.current;
      if (!book || !doc) return false;
      const template = resolvePageTemplate(doc.config as unknown as PageTemplateSource, page.composed.template);
      const target = frameClickTarget(book.markdown, page.composed, frame, template);
      if (!target) return false;
      if (target.kind === 'caret') {
        focusAt(book, target.offset, page.composed.sourceStart);
        return true;
      }
      if (!write(book, page.composed.sourceStart, [{ from: target.at, to: target.at, insert: target.insert }])) return false;
      focusAt(book, target.caret, page.composed.sourceStart);
      return true;
    },
    dblclick(pageIndex, x, y) {
      const page = pageOf(pageIndex);
      const frame = page?.composed ? frameHitAt(page, x, y) : null;
      if (!page?.composed || !frame) return false;
      if (editModeNow() === 'design') return true;
      const book = deps.sourceOfPage(pageIndex);
      const doc = deps.docRef.current;
      if (!book || !doc || !deps.surface) return false;
      const target = frameTextTargetAt(doc, page, book.markdown, frame, x, y);
      if (!target) return false;
      const labels = deps.labelsRef?.current;
      const pageStart = page.composed.sourceStart;
      return openFrameTextEditor(deps.surface, pageIndex, target, {
        label: (labels?.composedFrameEdit ?? 'Text of the frame __frame__').replace('__frame__', frame.name),
        hint: labels?.composedFrameEditHint ?? '',
        onCommit: (text) => {
          const change = frameTextChange(target, text);
          // The page may have been laid out again meanwhile: write only
          // where the source still reads what the field was opened on.
          const now = deps.sourceOfPage(pageIndex) ?? book;
          if (!change || now.markdown.slice(target.start, target.end) !== target.text) return;
          write(now, pageStart, [change]);
        },
      });
    },
  };
}
