import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { createMeasurementCache } from '../../measure/index.js';
import { inlineIconBox } from '../../measure/inlineIcon.js';
import type { VDTBlock, VDTDocument } from '../../vdt.js';
import type { PostextConfig } from '../../types.js';

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
const base: PostextConfig = {
  headings: { balancing: { enabled: false } },
  page: { width: mm(148), height: mm(210), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } },
  layout: { layoutType: 'single' },
};
const build = (md: string, cfg: PostextConfig = base): VDTDocument => buildDocument({ markdown: md }, cfg, createMeasurementCache());
const textOf = (b: VDTBlock): string => b.lines.map((l) => (l.segments ?? []).map((s) => (s.chip ? `[${s.chip.blank ? '_'.repeat(3) : s.chip.runs.map((r) => r.text).join('')}]` : s.text)).join('')).join(' / ');

describe('exercises laid out (#1227)', () => {
  it('sets a gaps exercise with its number and blanks', () => {
    const doc = build('# Plants\n\n:::exercise\nComplete the sentences.\n\n1. The roots take in [[water]].\n2. The leaves make [[food]].\n:::\n');
    const texts = doc.blocks.filter((b) => b.type !== 'callout').map(textOf);
    expect(texts.join('\n')).toMatchSnapshot();
    expect(doc.exercises?.[0]).toMatchObject({ kind: 'gaps', number: '1', key: '1 water · 2 food' });
  });

  it('sets choice, true/false, match, order', () => {
    const md = [
      '# Unit', '',
      ':::exercise', 'Choose.', '', '- [ ] Madrid', '- [x] Lisbon', '- [ ] Rome', ':::', '',
      ':::exercise{type=truefalse}', 'True or false?', '', '- [x] The Sun is a star.', '- [ ] The Moon is a planet.', ':::', '',
      ':::exercise', 'Join.', '', '- Bee -> Hive', '- Bird -> Nest', '- Spider -> Web', ':::', '',
      ':::exercise{type=order}', 'Order.', '', '1. Plant', '2. Water', '3. Grow', ':::', '',
      ':::exercise{type=open lines=2}', 'Why?', ':::', '',
      ':::exercise{type=wordsearch}', 'Find.', '', '- SUN', '- MOON', '- STAR', ':::', '',
      ':::exercise{type=crossword}', 'Solve.', '', '- SUN: Our star', '- MOON: It orbits the Earth', '- NEST: A home for birds', ':::', '',
      ':::exercise{type=arithmetic}', 'Work out.', '', '- 345 + 278', '- 864 ÷ 4', ':::', '',
    ].join('\n');
    const doc = build(md);
    expect(doc.exercises?.map((e) => [e.kind, e.number, e.key])).toMatchSnapshot();
    const texts = doc.blocks.filter((b) => b.type !== 'callout').map(textOf);
    expect(texts.join('\n')).toMatchSnapshot();
  });

  it('prints the solutions at the end of the chapter and a teacher edition', () => {
    const md = '# One\n\n:::exercise\nPick.\n\n- [ ] a\n- [x] b\n:::\n\n:::exercise\nFill [[in]].\n\n:::solution\nIt is *in*.\n:::\n:::\n\n# Two\n\nText.\n';
    const doc = build(md, { ...base, exercises: { solutions: { placement: 'chapterEnd' }, edition: 'teacher' } });
    const texts = doc.blocks.filter((b) => b.type !== 'callout').map(textOf);
    expect(texts.join('\n')).toMatchSnapshot();
  });

  it('sets activity icons as inline symbols: a picture of the book, or a glyph in its face and colour', () => {
    const cfg: PostextConfig = {
      ...base,
      exerciseStyles: [{ id: 'a', icons: {
        write: { resourceId: 'pencil', alt: 'Write', size: 1 },
        oral: { glyph: '*', fontFamily: 'Icons', color: { hex: '#2b7a3d', model: 'hex' }, alt: 'Speak' },
      } }],
    };
    const resources = [{ id: 'pencil', typeId: 'figure', kind: 'svg' as const, createdAt: 0, updatedAt: 0, svg: { fileId: 'pencil.svg', width: 24, height: 24 } }];
    const doc = buildDocument({ markdown: ':::exercise{icon="write oral"}\nFill [[in]].\n:::\n', resources }, cfg, createMeasurementCache());
    const icons = doc.blocks.flatMap((b) => b.lines.flatMap((l) => (l.segments ?? []).flatMap((s) => (s.swatch?.icon ? [s.swatch.icon] : []))));
    expect(icons).toHaveLength(2);
    expect(icons[0]).toMatchObject({ kind: 'resource', alt: 'Write', fileId: 'pencil.svg', svg: true });
    expect(icons[1]).toMatchObject({ kind: 'glyph', alt: 'Speak', glyph: '*', color: '#2b7a3d' });
    expect(icons[1]!.fontString).toContain('Icons');
  });

  it('sets activity icons on the band of a shaped number (#1248)', () => {
    const cfg: PostextConfig = {
      ...base,
      exerciseStyles: [{ id: 'a', number: { shape: 'disc', fontSize: { value: 1.05, unit: 'em' } }, icons: {
        write: { resourceId: 'pencil', alt: 'Write' },
        oral: { resourceId: 'pencil', alt: 'Speak', size: 0.8 },
      } }],
    };
    const resources = [{ id: 'pencil', typeId: 'figure', kind: 'svg' as const, createdAt: 0, updatedAt: 0, svg: { fileId: 'pencil.svg', width: 24, height: 24 } }];
    const doc = buildDocument({ markdown: ':::exercise{icon="write oral"}\nFill [[in]].\n:::\n', resources }, cfg, createMeasurementCache());
    const segs = doc.blocks.flatMap((b) => b.lines.flatMap((l) => l.segments ?? []));
    const disc = segs.find((s) => s.chip && !s.chip.blank)!.chip!;
    const [write, oral] = segs.flatMap((s) => (s.swatch?.icon ? [s.swatch.icon] : []));
    // Without a size of its own: the disc's height, its top and its bottom.
    expect(write!.heightPx).toBeCloseTo(disc.ascent + disc.descent, 1);
    expect(write!.dropPx).toBeCloseTo(disc.descent, 1);
    expect(inlineIconBox(write!, 0, 100).y).toBeCloseTo(100 - disc.ascent, 1);
    // With its own size: centred on the disc.
    const box = inlineIconBox(oral!, 0, 100);
    expect(box.y + box.height / 2).toBeCloseTo(100 + (disc.descent - disc.ascent) / 2, 1);
    expect(oral!.heightPx).toBeLessThan(write!.heightPx);
  });

  it('keeps an icon on the baseline beside a bare number', () => {
    const cfg: PostextConfig = { ...base, exerciseStyles: [{ id: 'a', icons: { write: { resourceId: 'pencil', alt: 'Write' } } }] };
    const resources = [{ id: 'pencil', typeId: 'figure', kind: 'svg' as const, createdAt: 0, updatedAt: 0, svg: { fileId: 'pencil.svg', width: 24, height: 24 } }];
    const doc = buildDocument({ markdown: ':::exercise{icon="write"}\nFill [[in]].\n:::\n', resources }, cfg, createMeasurementCache());
    const icon = doc.blocks.flatMap((b) => b.lines.flatMap((l) => (l.segments ?? []).flatMap((s) => (s.swatch?.icon ? [s.swatch.icon] : []))))[0]!;
    expect(icon.dropPx).toBeUndefined();
    expect(inlineIconBox(icon, 0, 100)).toMatchObject({ baseline: 100, y: 100 - icon.heightPx });
  });

  it('writes a true/false answer in a bracket: full width in Chinese', () => {
    const md = ':::exercise{type=truefalse}\n判断。\n\n- [x] 云是小水滴。\n:::\n';
    const zh = build(md, { ...base, locale: 'zh-Hans', exerciseStyles: [{ id: 'a', trueFalse: { look: 'bracket' } }] });
    expect(zh.blocks.map(textOf).join('\n')).toContain('（[___]）');
    const pt = build(md.replace('判断。', 'V ou F.'), { ...base, locale: 'pt-BR', exerciseStyles: [{ id: 'a', trueFalse: { look: 'bracket' } }] });
    expect(pt.blocks.map(textOf).join('\n')).toContain('([___])');
  });
});
