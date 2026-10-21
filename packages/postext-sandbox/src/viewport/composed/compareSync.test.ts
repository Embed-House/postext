import { describe, expect, it } from 'vitest';
import type { VDTDocument } from 'postext';
import { matchPosition, syncedScrollTop, type SyncDoc } from './compareSync.js';

/** A document whose pages set the content blocks listed (inclusive
 *  ranges), or none (`null`), or a composed page (`{ fence }`). */
function docOf(pages: readonly ([number, number] | null | { fence: number })[]): SyncDoc['doc'] {
  const blocks: { pageIndex: number; contentIndex: number }[] = [];
  pages.forEach((p, pageIndex) => {
    if (!Array.isArray(p)) return;
    for (let k = p[0]; k <= p[1]; k++) blocks.push({ pageIndex, contentIndex: k });
  });
  return {
    pages: pages.map((p) => (p && !Array.isArray(p) ? { composed: { fenceIndex: p.fence } } : {})) as unknown as VDTDocument['pages'],
    blocks: blocks as unknown as VDTDocument['blocks'],
  };
}

describe('the side-by-side columns meet on the text (#1010)', () => {
  it('turns to the page that sets the same block, not the same page number', () => {
    // The translation runs longer: block 5 is on the second page on the
    // left and on the third on the right.
    const left = { doc: docOf([[0, 3], [3, 6], [7, 9]]) };
    const right = { doc: docOf([[0, 2], [2, 4], [5, 7], [8, 9]]) };
    expect(matchPosition(left, 1, 0.5, right)).toEqual({ index: 2, fraction: 0 });
    expect(matchPosition(left, 2, 0, right)).toMatchObject({ index: 2 });
    expect(matchPosition(left, 2, 0.9, right)).toMatchObject({ index: 3 });
  });

  it('keeps to the chapter in the whole book', () => {
    const left = { doc: docOf([[0, 4], [5, 9], [0, 2], [3, 5]]), chapters: [0, 0, 1, 1] };
    const right = { doc: docOf([[0, 3], [4, 7], [8, 9], [0, 3], [4, 5]]), chapters: [0, 0, 0, 1, 1] };
    // Block 0 of chapter 2 is not block 0 of chapter 1.
    expect(matchPosition(left, 2, 0, right)).toEqual({ index: 3, fraction: 0 });
    expect(matchPosition(left, 3, 0.5, right)).toMatchObject({ index: 4 });
    // A chapter the other edition lacks: the next one it has.
    expect(matchPosition({ doc: left.doc, chapters: [0, 0, 2, 2] }, 2, 0, right)).toEqual({ index: 4, fraction: 0 });
  });

  it('matches composed pages by fence, and counts a page with no text from the one before', () => {
    const left = { doc: docOf([[0, 2], null, { fence: 0 }, [3, 4]]) };
    const right = { doc: docOf([[0, 1], [2, 2], null, { fence: 0 }, [3, 4]]) };
    expect(matchPosition(left, 2, 0.3, right)).toEqual({ index: 3, fraction: 0.3 });
    // The blank page after the text that ends on the right's page 1.
    expect(matchPosition(left, 1, 0, right)).toEqual({ index: 2, fraction: 0 });
  });

  it('scrolls the other column to the same place', () => {
    const left = { doc: docOf([[0, 3], [3, 6], [7, 9]]), tops: [0, 1000, 2000], heights: [990, 990, 990] };
    const right = { doc: docOf([[0, 2], [2, 4], [5, 7], [8, 9]]), tops: [0, 1000, 2000, 3000], heights: [990, 990, 990, 990] };
    expect(syncedScrollTop({ ...left, scrollTop: 1495 }, right)).toBe(2000);
  });
});
