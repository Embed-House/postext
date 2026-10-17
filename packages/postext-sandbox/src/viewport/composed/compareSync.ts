/**
 * How the two columns of the side-by-side view (#867) keep to the same
 * page. The editions of a book rarely have the same pages: a translation
 * runs longer and the flowing chapters gain a page. Composed pages are the
 * fixed points: the same fence in both editions is the same page. A page
 * between them is counted from the composed page before it. Pure.
 */

import type { VDTDocument } from 'postext';
import { composedPageIndex } from '../../warnings/composedChecks';

/** The page of `to` that shows what page `index` of `from` shows: the same
 *  composed fence, else as many pages after the last composed page both
 *  share, else the same index (clamped). */
export function matchingPage(from: Pick<VDTDocument, 'pages'>, index: number, to: Pick<VDTDocument, 'pages'>): number {
  const n = to.pages.length;
  if (n === 0) return -1;
  for (let i = Math.min(index, from.pages.length - 1); i >= 0; i--) {
    const c = from.pages[i]?.composed;
    if (!c) continue;
    const j = composedPageIndex(to, c.fenceIndex);
    if (j < 0) continue;
    return Math.max(0, Math.min(n - 1, j + (index - i)));
  }
  return Math.max(0, Math.min(n - 1, index));
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

/** Where the other column scrolls to: its matching page, as far into it. */
export function syncedScrollTop(
  from: { doc: Pick<VDTDocument, 'pages'>; tops: readonly number[]; heights: readonly number[]; scrollTop: number },
  to: { doc: Pick<VDTDocument, 'pages'>; tops: readonly number[]; heights: readonly number[] },
): number | null {
  const at = pageAtScroll(from.tops, from.heights, from.scrollTop);
  const j = matchingPage(from.doc, at.index, to.doc);
  if (j < 0 || to.tops[j] === undefined) return null;
  return to.tops[j]! + at.fraction * (to.heights[j] ?? 0);
}
