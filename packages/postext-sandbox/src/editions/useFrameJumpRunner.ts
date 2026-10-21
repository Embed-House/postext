'use client';

/**
 * The canvas side of a frame jump (#867, see `frameJump.ts`): once the
 * edition and chapter a jump names are on screen and laid out, land on the
 * page that sets its fence, pick the frame as the page selection (#865:
 * its mark and its path in the breadcrumb) and for the template editor
 * (`selectFrame`), and put the editor's caret in the frame's slot.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { sourceAt, type VDTDocument } from 'postext';
import {
  useSandboxChapterDocsRef, useSandboxDispatch, useSandboxDocRef, useSandboxDocSourceRef, useSandboxSelector,
} from '../context/SandboxContext.js';
import { fromBookOffset } from '../book/compose.js';
import type { ComposedBook } from '../book/types.js';
import { selectFrame } from '../editing/editMode.js';
import { climbable, elementRectOnSheet } from '../selection/pageSelection.js';
import { setPageSelection } from '../selection/selectionStore.js';
import { sameLocaleTag } from '../presets/locale.js';
import { hashBundleOrigin, readViewHash, viewHashFragment } from '../storage/viewHash.js';
import { resolveJump } from '../warnings/composedChecks.js';
import { setOverlapFocus } from './overlapFocus.js';
import { clearFrameJump, onFrameJumpChange, pendingFrameJump, setJumpFlash, type PendingFrameJump } from './frameJump.js';

/** Pick frame `frameId` of page `pageIndex` as the page selection, at
 *  frame level (what a click on it and Esc from its text would pick).
 *  False when the source map does not find it there. */
export function selectFrameOnPage(doc: VDTDocument, pageIndex: number, frameId: string, chapter?: string): boolean {
  const page = doc.pages[pageIndex];
  const frame = page?.composed?.frames.find((f) => f.id === frameId);
  if (!page || !frame) return false;
  // Its centre: on the sheet whatever its turn or scale, out of the flow
  // frame of a right-to-left or vertical page (#929).
  const r = elementRectOnSheet(page, { rect: frame.rect, flow: true })!;
  const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const chain = climbable(sourceAt(doc, pageIndex, point.x, point.y));
  const level = chain.findIndex((el) => el.level === 'frame' && el.id === frameId);
  if (level < 0) return false;
  setPageSelection({ pageIndex, chain, level, point, origin: 'page', ...(chapter ? { chapter } : {}) }, doc);
  return true;
}

/** How long the frame reached stays outlined (when the page selection
 *  cannot take it). */
const FLASH_MS = 2400;

function pendingVersion(): PendingFrameJump | null {
  return pendingFrameJump();
}

/** The page of the document on screen (the whole book's, stitched, or the
 *  chapter's) that is `page` of the chapter's own document. */
function screenPageIndex(screen: VDTDocument | null, chapterDoc: VDTDocument, pageIndex: number): number {
  if (!screen) return pageIndex;
  if (screen === chapterDoc) return pageIndex;
  const page = chapterDoc.pages[pageIndex];
  if (!page) return -1;
  return screen.pages.findIndex((p) => p.pageNumberValue === page.pageNumberValue
    && (p.composed?.fenceIndex ?? -1) === (page.composed?.fenceIndex ?? -1));
}

export function useFrameJumpRunner(jumpToPage: (pageIndex: number) => void): void {
  const dispatch = useSandboxDispatch();
  const docRef = useSandboxDocRef();
  const docSourceRef = useSandboxDocSourceRef();
  const chapterDocsRef = useSandboxChapterDocsRef();
  const activeProjectId = useSandboxSelector((s) => s.activeProjectId);
  const projectLocale = useSandboxSelector((s) => (s.activeProjectId === null ? null : s.projects.find((p) => p.id === s.activeProjectId)?.locale ?? null));
  const projectOrigin = useSandboxSelector((s) => (s.activeProjectId === null ? null : s.projects.find((p) => p.id === s.activeProjectId)?.origin ?? null));
  const activePresetId = useSandboxSelector((s) => s.activePresetId);
  const appliedLocale = useSandboxSelector((s) => (s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale ?? null : null));
  const presetStatus = useSandboxSelector((s) => s.presetStatus);
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const docVersion = useSandboxSelector((s) => s.docVersion);
  const pending = useSyncExternalStore(onFrameJumpChange, pendingVersion, () => null);
  const jumpRef = useRef(jumpToPage);
  jumpRef.current = jumpToPage;

  useEffect(() => {
    const jump = pending;
    if (!jump) return;
    // The edition first: the fragment is opening it.
    if (jump.linked) {
      // Another language of a linked book: the project its link opens.
      if (projectOrigin !== hashBundleOrigin({ ...jump.linked, lang: jump.locale })) return;
    } else if (jump.presetId !== null) {
      if (activeProjectId !== null || activePresetId !== jump.presetId || presetStatus === 'loading') return;
      if (jump.locale !== '' && (appliedLocale === null || !sameLocaleTag(appliedLocale, jump.locale))) return;
    } else if (jump.projectId) {
      // A project in several languages (#903): its edition on screen.
      if (activeProjectId !== jump.projectId) return;
      if (jump.locale !== '' && (projectLocale === null || !sameLocaleTag(projectLocale, jump.locale))) return;
    }
    const chapter = jump.chapterIndex !== null ? chapters[jump.chapterIndex] : chapters.find((c) => c.id === activeChapterId);
    if (!chapter) {
      clearFrameJump();
      return;
    }
    if (chapter.id !== activeChapterId) {
      // The fragment's chapter sync switches it; a book opened at another
      // chapter is moved by the editor focus, which switches too.
      dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: chapter.id, anchor: jump.chapterStart ?? 0, head: jump.chapterEnd ?? jump.chapterStart ?? 0, selectWord: false } });
      return;
    }
    // The chapter's own document and the book it was built from.
    let doc: VDTDocument | null = null;
    let source: ComposedBook | null = null;
    const held = chapterDocsRef.current.get(chapter.id);
    if (held) {
      doc = held.doc;
      source = held.source;
    } else {
      const src = docSourceRef.current;
      if (src && src.scope !== 'book' && src.scope.only === chapter.id && docRef.current) {
        doc = docRef.current;
        source = src;
      }
    }
    if (jump.panel === 'config' && jump.fenceIndex === null) {
      dispatch({ type: 'SET_PANEL', payload: 'config' });
      clearFrameJump();
      return;
    }
    if (!doc || !source) return;
    const resolved = resolveJump(doc, jump);
    if (!resolved) {
      // Laid out without the page yet (fonts still landing): wait for the
      // next layout; a construct with no page has its text at least.
      if (jump.fenceIndex === null && jump.page === null) {
        if (jump.chapterStart !== undefined) {
          dispatch({ type: 'SET_PANEL', payload: 'markdown' });
          dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: chapter.id, anchor: jump.chapterStart, head: jump.chapterEnd ?? jump.chapterStart, selectWord: false } });
        }
        clearFrameJump();
      }
      return;
    }
    clearFrameJump();
    const page = doc.pages[resolved.pageIndex]!;
    const screenIndex = screenPageIndex(docRef.current, doc, resolved.pageIndex);
    // The page: its number in the fragment (the page sync jumps there),
    // and straight away when the document on screen has it.
    const fragment = viewHashFragment({ ...readViewHash(), chapter: chapters.indexOf(chapter), page: page.pageNumberValue });
    if (window.location.hash !== fragment) window.location.hash = fragment;
    if (screenIndex >= 0) jumpRef.current(screenIndex);
    const frame = resolved.frame;
    // An overlap check: both frames and where they meet, or the frame and
    // what it runs past, drawn on the page until another check (#1066).
    if (jump.overlap && screenIndex >= 0) setOverlapFocus({ ...jump.overlap, pageIndex: screenIndex });
    if (frame && page.composed) {
      selectFrame({ pageIndex: Math.max(0, screenIndex), frameId: frame.id, name: frame.name, template: page.composed.template, configPath: frame.configPath });
      // The page selection (#865): the frame is picked on the page, its
      // path in the breadcrumb, Esc climbs to its group and template. Where
      // the page cannot take it, the frame is outlined for a moment.
      const screen = docRef.current;
      if (!(screen && screenIndex >= 0 && selectFrameOnPage(screen, screenIndex, frame.id, chapter.id))) {
        setJumpFlash({ frameId: frame.id, pageIndex: Math.max(0, screenIndex), until: Date.now() + FLASH_MS });
        window.setTimeout(() => setJumpFlash(null), FLASH_MS + 50);
      }
    }
    if (jump.keepEditor) return;
    // The caret at the start of the slot: the frame's content, else what
    // the check names (a collapsed caret, so the frame is not covered by a
    // selection).
    const anchor = resolved.sourceStart !== undefined ? fromBookOffset(source, resolved.sourceStart).offset : jump.chapterStart;
    if (anchor === undefined) return;
    dispatch({ type: 'SET_PANEL', payload: 'markdown' });
    dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: chapter.id, anchor, head: anchor, selectWord: false, fromViewer: true } });
  }, [pending, activeProjectId, projectLocale, projectOrigin, activePresetId, appliedLocale, presetStatus, chapters, activeChapterId, docVersion, dispatch, docRef, docSourceRef, chapterDocsRef]);
}
