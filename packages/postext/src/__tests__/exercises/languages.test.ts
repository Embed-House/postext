import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { createMeasurementCache } from '../../measure/index.js';
import { parseMarkdown } from '../../parse/index.js';
import { readExercises } from '../../exercises/model.js';
import type { VDTBlock, VDTDocument } from '../../vdt.js';
import type { PostextConfig } from '../../types.js';

// Exercises in Chinese, Japanese and Arabic books (#1234): the marks, digits
// and brackets each language prints.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const config = (extra: PostextConfig): PostextConfig => ({
  headings: { balancing: { enabled: false } },
  page: { width: mm(148), height: mm(210), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } },
  layout: { layoutType: 'single' },
  ...extra,
});
const build = (md: string, cfg: PostextConfig): VDTDocument => buildDocument({ markdown: md }, cfg, createMeasurementCache());
const textOf = (b: VDTBlock): string => b.lines.map((l) => (l.segments ?? []).map((s) => (s.chip ? `[${s.chip.blank ? '_' : s.chip.runs.map((r) => r.text).join('')}]` : s.text)).join('')).join(' / ');
const texts = (doc: VDTDocument): string[] => doc.blocks.filter((b) => b.type !== 'callout').map(textOf);

describe('exercises in other scripts (#1234)', () => {
  it('keeps a ruby whole in a gap', () => {
    const { exercises } = readExercises(parseMarkdown(':::exercise\nWrite.\n\n[[{春天|chūn tiān}]] [[a | b]]\n:::\n'));
    const gaps = exercises[0]!.gaps.map((g) => g.gap.options.length);
    expect(gaps).toEqual([1, 2]);
  });

  it('sets a Chinese number with its full-width suffix and no word space', () => {
    const doc = build('# 一\n\n:::exercise\n看拼音，写词语。\n\n- [x] 对\n- [ ] 错\n:::\n', config({
      locale: 'zh-Hans', exerciseStyles: [{ id: 'lx', number: { format: 'simp-chinese-informal', suffix: '、' } }],
    }));
    expect(texts(doc).find((t) => t.includes('看拼音'))).toMatch(/^\[一、\]看拼音/);
  });

  it('prints a true/false bracket and a Chinese inline choice in full-width brackets', () => {
    const md = '# 一\n\n:::exercise{type=truefalse}\n判断。\n\n- [x] 燕子飞回来了。\n:::\n\n:::exercise\n选择。\n\n种子 [[(zhǒng) | zhòng]]\n:::\n';
    const all = texts(build(md, config({ locale: 'zh-Hans', exerciseStyles: [{ id: 'lx', trueFalse: { look: 'bracket' } }] }))).join('\n');
    expect(all).toContain('燕子飞回来了。\t（[_]）');
    expect(all).toContain('（[zhǒng]　[zhòng]）');
  });

  it('numbers items and keys in Arabic-Indic digits, a key split by the Arabic semicolon', () => {
    const md = '# أ\n\n:::exercise{type=truefalse}\nصح أم خطأ؟\n\n- [x] الشمس نجم.\n- [ ] القمر كوكب.\n:::\n\n:::exercise{type=order}\nرتّب.\n\n1. أ\n2. ب\n:::\n';
    const doc = build(md, config({ locale: 'ar', exercises: { solutions: { placement: 'chapterEnd' } } }));
    const all = texts(doc).join('\n');
    expect(all).toContain('١.');
    expect(all).not.toMatch(/(^|\s)[12]\./m);
    expect(all).toContain('١ صح؛ ٢ خطأ');
    expect(all).not.toContain(' · ');
  });

  it('prints no entry at the chapter end for an exercise with nothing to print', () => {
    const md = '# U\n\n:::exercise\nWhy?\n:::\n\n:::exercise\nFill [[in]].\n:::\n';
    const all = texts(build(md, config({ exercises: { solutions: { placement: 'chapterEnd' } } }))).join('\n');
    expect(all).not.toMatch(/^1\.\s*$/m);
    expect(all).toMatch(/^2\.\tin$/m);
  });

  it('paints the synthetic boxes and chips in the palette main colour', () => {
    const green = { hex: '#2f7a55', model: 'hex' as const };
    const doc = build('# U\n\n:::exercise{bank}\nFill [[in]].\n:::\n', config({
      colorPalette: [{ id: 'main-color', name: 'main', value: green }],
      exercises: { solutions: { placement: 'chapterEnd' } },
    }));
    const word = doc.blocks.flatMap((b) => b.lines.flatMap((l) => l.segments ?? [])).find((s) => s.chip && !s.chip.blank && s.chip.runs.some((r) => r.text === 'in'));
    expect(word?.chip?.borderColor?.toLowerCase()).toBe('#2f7a55');
  });
});
