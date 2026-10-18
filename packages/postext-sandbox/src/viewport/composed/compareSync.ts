/**
 * How the two columns of the side-by-side view (#867) keep to the same
 * place. The editions of a book rarely have the same pages: a translation
 * runs longer, and in a long chapter it drifts a page or more by the end.
 * So the columns meet on the text, not on page counts (#1010):
 *
 * - a composed page is a fixed point: the same fence in both editions is
 *   the same page;
 * - any other page is read as a place in its chapter's Markdown: the
 *   content blocks it sets (each laid-out block's `contentIndex`, its
 *   position in the chapter's block list, which the editions of a
 *   translation share block for block), and how far into them the reader
 *   is; the other column turns to the page that sets that block, as far
 *   into it;
 * - a page with no text (a blank verso, a full-page picture) is counted
 *   from the nearest page that has some.
 *
 * In the whole book the pages carry their chapter (`chapters`, by page
 * index, as `stitchDocuments` gives them), and every match stays in the
 * same chapter: block indices and fences count from each chapter's start.
 * Pure.
 */

import type { VDTDocument } from 'postext';

/** A column's document: its pages, its blocks, and the chapter of every
 *  page when it holds several chapters. */
export interface SyncDoc {
  doc: Pick<VDTDocument, 'pages'> & Partial<Pick<VDTDocument, 'blocks'>>;
  chapters?: readonly number[];
}

/** The content blocks a page sets: the smallest and the largest index. */
interface Span {
  min: number;
  max: number;
}

const spansCache = new WeakMap<object, (Span | null)[]>();

/** The content span of every page of `doc`, null for a page that sets no
 *  text of its own (text a story brought from another chapter, #943, and
 *  footnotes do not count). */
export function contentSpans(doc: SyncDoc['doc']): (Span | null)[] {
  const cached = spansCache.get(doc);
  if (cached) return cached;
  const spans: (Span | null)[] = doc.pages.map(() => null);
  for (const b of doc.blocks ?? []) {
    if (b.contentIndex === undefined || b.sourceChapter !== undefined || b.footnoteNote !== undefined) continue;
    if (b.pageIndex < 0 || b.pageIndex >= spans.length) continue;
    const s = spans[b.pageIndex];
    if (!s) spans[b.pageIndex] = { min: b.contentIndex, max: b.contentIndex };
    else {
      if (b.contentIndex < s.min) s.min = b.contentIndex;
      if (b.contentIndex > s.max) s.max = b.contentIndex;
    }
  }
  spansCache.set(doc, spans);
  return spans;
}

/** The pages `[start, end)` of chapter `c`, or null when it has none. */
function chapterRange(chapters: readonly number[], c: number): [number, number] | null {
  const start = chapters.indexOf(c);
  if (start < 0) return null;
  let end = start;
  while (end < chapters.length && chapters[end] === c) end++;
  return [start, end];
}

function fenceIn(doc: SyncDoc['doc'], fenceIndex: number, start: number, end: number): number {
  for (let i = start; i < end; i++) if (doc.pages[i]?.composed?.fenceIndex === fenceIndex) return i;
  return -1;
}

/** The page of `[start, end)` that sets content block `k` (fractional:
 *  how far into the block), and how far into that page. */
function locate(spans: readonly (Span | null)[], start: number, end: number, k: number): { index: number; fraction: number } | null {
  const block = Math.floor(k);
  let last = -1;
  for (let j = start; j < end; j++) {
    const s = spans[j];
    if (!s) continue;
    last = j;
    if (s.max < block) continue;
    // The block falls in a gap before this page (one the edition left
    // out): the top of the page.
    if (s.min > block) return { index: j, fraction: 0 };
    return { index: j, fraction: Math.max(0, Math.min(1, (k - s.min) / (s.max - s.min + 1))) };
  }
  return last >= 0 ? { index: last, fraction: 1 } : null;
}

/** Where page `index` of `from`, `fraction` into it, is in `to`: the page
 *  and how far into it; null when `to` has no page. */
export function matchPosition(from: SyncDoc, index: number, fraction: number, to: SyncDoc): { index: number; fraction: number } | null {
  const n = to.doc.pages.length;
  if (n === 0 || from.doc.pages.length === 0) return null;
  let fromStart = 0;
  let fromEnd = from.doc.pages.length;
  let toStart = 0;
  let toEnd = n;
  const chapter = from.chapters?.[index];
  if (chapter !== undefined && to.chapters) {
    const range = chapterRange(to.chapters, chapter);
    // The other edition has no such chapter: the next one it has.
    if (!range) {
      const later = to.chapters.findIndex((c) => c > chapter);
      return { index: later >= 0 ? later : n - 1, fraction: 0 };
    }
    [toStart, toEnd] = range;
    [fromStart, fromEnd] = chapterRange(from.chapters!, chapter) ?? [fromStart, fromEnd];
  }
  const toSpans = contentSpans(to.doc);
  const fromSpans = contentSpans(from.doc);

  // A page with an anchor of its own: its fence, else its text (`at`
  // reads a block of it instead of a fraction: its first or its last).
  const anchored = (i: number, f: number, at?: 'first' | 'last'): { index: number; fraction: number } | null => {
    const composed = from.doc.pages[i]?.composed;
    if (composed) {
      const j = fenceIn(to.doc, composed.fenceIndex, toStart, toEnd);
      if (j >= 0) return { index: j, fraction: f };
    }
    const s = fromSpans[i];
    if (!s) return null;
    const k = at === 'first' ? s.min : at === 'last' ? s.max : s.min + f * (s.max - s.min + 1);
    return locate(toSpans, toStart, toEnd, k);
  };
  const clamp = (j: number) => Math.max(toStart, Math.min(toEnd - 1, j));

  const own = anchored(index, fraction);
  if (own) return own;
  // Counted from the nearest page with an anchor: the one before (the page
  // that sets its last block), else the one after (its first block).
  for (let p = index - 1; p >= fromStart; p--) {
    const a = anchored(p, 1, 'last');
    if (a) return { index: clamp(a.index + (index - p)), fraction };
  }
  for (let p = index + 1; p < fromEnd; p++) {
    const a = anchored(p, 0, 'first');
    if (a) return { index: clamp(a.index - (p - index)), fraction };
  }
  return { index: clamp(toStart + (index - fromStart)), fraction };
}

/** The page of `to` that shows what page `index` of `from` shows (see
 *  `matchPosition`); -1 when `to` has no page. */
export function matchingPage(from: SyncDoc['doc'], index: number, to: SyncDoc['doc']): number {
  return matchPosition({ doc: from }, index, 0, { doc: to })?.index ?? -1;
}

/** The page at a scroll position and how far into it (0…1), from the
 *  pages' tops and heights in the column. */
export function pageAtScroll(tops: readonly number[], heights: readonly number[], scrollTop: number): { index: number; fraction: number } {
  if (tops.length === 0) return { index: 0, fraction: 0 };
  let index = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= scrollTop + 1) index = i;
    else break;
  }
  const h = heights[index] ?? 1;
  const fraction = h > 0 ? Math.max(0, Math.min(1, (scrollTop - tops[index]!) / h)) : 0;
  return { index, fraction };
}

/** Where the other column scrolls to: the place that shows the text the
 *  reader is at. */
export function syncedScrollTop(
  from: SyncDoc & { tops: readonly number[]; heights: readonly number[]; scrollTop: number },
  to: SyncDoc & { tops: readonly number[]; heights: readonly number[] },
): number | null {
  const at = pageAtScroll(from.tops, from.heights, from.scrollTop);
  const m = matchPosition(from, at.index, at.fraction, to);
  if (!m || to.tops[m.index] === undefined) return null;
  return to.tops[m.index]! + m.fraction * (to.heights[m.index] ?? 0);
}
