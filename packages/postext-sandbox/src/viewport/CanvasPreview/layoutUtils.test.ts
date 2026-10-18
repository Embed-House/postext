import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_GAPS, PAGE_PADDING, fitRowPageWidth, groupPagesIntoRows, innerRowWidth, rowPadding } from './layoutUtils';

describe('groupPagesIntoRows', () => {
  it('lists every page on its own row in single mode', () => {
    expect(groupPagesIntoRows(3, 'single')).toEqual([[0], [1], [2]]);
  });

  it('starts a recto-opening document with its first page alone', () => {
    expect(groupPagesIntoRows(5, 'spread')).toEqual([[0], [1, 2], [3, 4]]);
    expect(groupPagesIntoRows(4, 'spread', true)).toEqual([[0], [1, 2], [3]]);
  });

  it('fills both slots of the first spread for a verso-opening document', () => {
    expect(groupPagesIntoRows(5, 'spread', false)).toEqual([[0, 1], [2, 3], [4]]);
    expect(groupPagesIntoRows(4, 'spread', false)).toEqual([[0, 1], [2, 3]]);
  });

  it('handles an empty document', () => {
    expect(groupPagesIntoRows(0, 'spread')).toEqual([]);
    expect(groupPagesIntoRows(0, 'spread', false)).toEqual([]);
  });
});

describe('the space around the pages (canvasViewer, #1002)', () => {
  it('defaults both gaps to 24 pixels, as the Canvas always had', () => {
    expect(DEFAULT_PAGE_GAPS).toEqual({ pageGap: 24, rowGap: 24 });
  });

  it('widens a row by the gap between its pages and the frame padding', () => {
    expect(innerRowWidth(300, 1, 24)).toBe(300 + PAGE_PADDING * 2);
    expect(innerRowWidth(300, 2, 24)).toBe(600 + 24 + PAGE_PADDING * 2);
    expect(innerRowWidth(300, 2, 0)).toBe(600 + PAGE_PADDING * 2);
  });

  it('splits the row gap between two rows and keeps the frame padding at the ends', () => {
    expect(rowPadding(0, 3, 24)).toEqual({ top: PAGE_PADDING, bottom: 12 });
    expect(rowPadding(1, 3, 24)).toEqual({ top: 12, bottom: 12 });
    expect(rowPadding(2, 3, 24)).toEqual({ top: 12, bottom: PAGE_PADDING });
    expect(rowPadding(0, 1, 40)).toEqual({ top: PAGE_PADDING, bottom: PAGE_PADDING });
  });

  it('leaves exactly the row gap between two rows, odd or not', () => {
    for (const gap of [0, 1, 5, 24, 25, 200]) {
      const upper = rowPadding(0, 3, gap).bottom;
      const lower = rowPadding(1, 3, gap).top;
      expect(upper + lower).toBe(gap);
    }
  });

  it('fits a page to the window less the padding and the gap between the pages', () => {
    expect(fitRowPageWidth(1000, 1, 24)).toBe(1000 - PAGE_PADDING * 2);
    expect(fitRowPageWidth(1000, 2, 24)).toBe((1000 - PAGE_PADDING * 2 - 24) / 2);
    expect(fitRowPageWidth(1000, 2, 0)).toBe((1000 - PAGE_PADDING * 2) / 2);
  });
});
