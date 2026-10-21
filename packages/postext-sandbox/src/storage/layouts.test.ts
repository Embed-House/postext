import { describe, expect, it, vi } from 'vitest';
import type { ChapterLayout } from '../book/types.js';

const store = vi.hoisted(() => ({ put: [] as unknown[] }));
vi.mock('./blobStore.js', () => ({
  LAYOUTS_STORE: 'layouts',
  hasIndexedDB: () => true,
  runInStore: async (_name: string, _mode: string, run: (s: { put(value: unknown): unknown }) => unknown) => {
    run({ put: (value) => { store.put.push(value); return {}; } });
  },
}));

import { putChapterLayouts } from './layouts.js';

const layout = (chapterId: string, over: Partial<ChapterLayout> = {}): ChapterLayout => ({
  chapterId, markdown: '# A', configKey: 'c', resourcesKey: 'r', engine: 'e', continuationKey: 'k', pageCount: 3, leadingBlankPages: 0,
  firstContentPageNumber: { delta: 0 }, firstContentPageFormat: 'decimal', lastPageNumber: { delta: 2 }, lastPageFormat: 'decimal', outlinePages: [], outlineKey: '', ...over,
});

describe('the stored chapter records (#757)', () => {
  it('never hold a layout made without a face it asked for', async () => {
    const whole = layout('a');
    await putChapterLayouts([whole, layout('b', { withoutFaces: true })]);
    expect(store.put).toEqual([whole]);
    // Nothing but such records: no transaction at all.
    store.put.length = 0;
    await putChapterLayouts([layout('b', { withoutFaces: true })]);
    expect(store.put).toEqual([]);
  });
});
