import { describe, expect, it } from 'vitest';
import type { VDTDocument } from 'postext';
import { BUNDLE_COVER_LONG_SIDE, bundleCoverImage, coverWidthFor, showFirstChapterDoc, type FirstChapterDoc } from './renderCover.js';

describe('coverWidthFor', () => {
  it('puts the long side of the page at the bundle cover size (#1210)', () => {
    expect(BUNDLE_COVER_LONG_SIDE).toBe(1024);
    expect(coverWidthFor(210, 297)).toBe(724);
    expect(coverWidthFor(297, 210)).toBe(1024);
    expect(coverWidthFor(100, 100)).toBe(1024);
    expect(coverWidthFor(0, 100)).toBe(1024);
  });
});

describe('bundleCoverImage', () => {
  const doc = { pages: [], trimOffset: 0 } as unknown as VDTDocument;
  const first = { id: 'c1', markdown: '# One' };

  it('paints nothing without a canvas layout of the first chapter as it stands', async () => {
    expect(await bundleCoverImage(first)).toBeNull();
    const ref: { current: FirstChapterDoc | null } = { current: { chapterId: 'c1', markdown: '# Old', doc } };
    const hide = showFirstChapterDoc(ref);
    expect(await bundleCoverImage(first)).toBeNull();
    expect(await bundleCoverImage(undefined)).toBeNull();
    hide();
    ref.current = { chapterId: 'c1', markdown: '# One', doc };
    expect(await bundleCoverImage(first)).toBeNull();
  });
});
