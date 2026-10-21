import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { chapter, harness } from './testHarness.js';

// The frame-style library (#873) through the agent tools: the same usage
// and suggestions as Design › Boxes › Frame styles, and the merge.

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pad = (v: number) => ({ top: mm(v), right: mm(v), bottom: mm(v), left: mm(v) });

const CONFIG: PostextConfig = {
  calloutStyles: [
    { id: 'note', name: 'Note', border: { enabled: true }, stripe: { enabled: true } },
    { id: 'caja-a', background: { hex: '#fde9d9', model: 'hex' }, padding: pad(4) },
    { id: 'caja-b', background: { hex: '#fde9d9', model: 'hex' }, padding: pad(6) },
  ],
  pageTemplates: [{ id: 'tema', frames: [{ name: 'texto', flow: true }, { name: 'dinero', style: 'caja-b' }] }],
};

const book = () => {
  const chapters = [
    chapter('a', 'One', ':::callout{type="caja-a"}\nUno.\n:::\n\n:::callout{type="caja-a"}\nDos.\n:::\n'),
    chapter('b', 'Two', '::::page{template="tema"}\n# Tema\n::::\n\n:::callout{type="caja-b"}\nTres.\n:::\n'),
  ];
  return { chapters, markdown: chapters[0]!.markdown, config: CONFIG };
};

describe('the frame-style tools', () => {
  it('say where each style is used and what could be merged', async () => {
    const read = await harness(book()).call('sandbox_frame_styles');
    expect(read.styles.find((s: { id: string }) => s.id === 'caja-a')).toMatchObject({ boxes: 2, byChapter: [{ chapter: 1, boxes: 2 }] });
    expect(read.styles.find((s: { id: string }) => s.id === 'caja-b')).toMatchObject({ boxes: 1, frames: [{ templateId: 'tema', frame: 'dinero', scope: 'base' }], composedPages: 1 });
    expect(read.suggestions).toEqual([{ keep: 'caja-a', merge: ['caja-b'], fields: ['padding.bottom', 'padding.left', 'padding.right', 'padding.top'], groups: ['padding'], moves: 0 }]);
    expect(read.stylesAfterMerging).toBe(2);
  });

  it('merge every suggestion, rewriting the frames and the fences, as steps sandbox_undo takes back', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_merge_styles', { all: true, wait: false });
    expect(done).toMatchObject({ merged: ['caja-b'], styles: 2, fencesRewritten: 1, inChapters: [2], undoSteps: 2 });
    const s = get();
    expect(s.config.calloutStyles!.map((st) => st.id)).toEqual(['note', 'caja-a']);
    expect(s.config.pageTemplates![0]!.frames![1]!.style).toBe('caja-a');
    expect(s.chapters[1]!.markdown).toContain(':::callout{type="caja-a"}\nTres.');
    // The design first: every state on the way names styles that exist.
    expect((await call('sandbox_undo', {})).ok).toBe(true);
    expect(get().config.calloutStyles).toEqual(CONFIG.calloutStyles);
    expect(get().chapters[1]!.markdown).toContain(':::callout{type="caja-a"}\nTres.');
    expect((await call('sandbox_undo', {})).ok).toBe(true);
    expect(get().chapters[1]!.markdown).toBe(book().chapters[1]!.markdown);
  });

  it('refuse a style the book does not have', async () => {
    const done = await harness(book()).call('sandbox_merge_styles', { groups: [{ keep: 'caja-a', merge: ['nope'] }] });
    expect(done.error).toMatch(/No callout style "nope"/);
  });
});
