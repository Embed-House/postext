import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { continuationAfter, contentOutline } from '../../pipeline/continuation.js';
import { createMeasurementCache } from '../../measure/index.js';
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
const textOf = (b: VDTBlock): string => b.lines.map((l) => (l.segments ?? []).map((s) => (s.chip ? `[${s.chip.blank ? '___' : s.chip.runs.map((r) => r.text).join('')}]` : s.text)).join('')).join(' / ');
const texts = (doc: VDTDocument): string[] => doc.blocks.filter((b) => b.type !== 'callout').map(textOf);

describe('exercise solutions (#1229)', () => {
  it('turns an inverted solution half round about its box', () => {
    const doc = buildDocument({ markdown: ':::exercise\nPick.\n\n- [x] Yes\n- [ ] No\n:::\n' }, { ...base, exercises: { solutions: { placement: 'inverted' } } }, createMeasurementCache());
    const turned = doc.blocks.filter((b) => b.turn);
    expect(turned.length).toBeGreaterThan(1);
    const frame = turned.find((b) => b.type === 'callout')!;
    expect(frame.callout?.turned).toBe(true);
    expect(turned.every((b) => b.turn!.cx === frame.bbox.x + frame.bbox.width / 2)).toBe(true);
    expect(turned.map(textOf).filter(Boolean)).toEqual(['a) Yes']);
  });

  it('numbers exercises on through a book and prints its solutions from the outline', () => {
    const config: PostextConfig = { ...base, exercises: { solutions: { placement: 'directive' } }, exerciseStyles: [{ id: 'ex', number: { resetOn: 'never' } }] };
    const ch1 = '# One\n\n:::exercise\nFill: [[cat]].\n:::\n\n:::exercise\nPick.\n\n- [x] Yes\n- [ ] No\n:::\n';
    const ch2 = '# Two\n\n:::exercise{type=truefalse}\nSay.\n\n- [x] True one\n:::\n\n# Answers\n\n:::solutions{scope="book"}\n';
    const after1 = continuationAfter({ markdown: ch1 }, config);
    const o1 = contentOutline({ markdown: ch1 }, config);
    const o2 = contentOutline({ markdown: ch2 }, config, after1);
    expect(o2.hasIndex).toBe(true);
    const outline = [...o1.outline, ...o2.outline];
    expect(outline.filter((e) => e.kind === 'exercise').map((e) => [e.number, e.exercise!.key, e.exercise!.chapter])).toEqual([
      ['1', 'cat', 'One'], ['2', 'a) Yes', 'One'], ['3', '1 T', 'Two'],
    ]);
    const doc = buildDocument({ markdown: ch2, continuation: after1, outline }, config, createMeasurementCache());
    const t = texts(doc);
    expect(t.slice(0, 2)).toEqual(['Two', '[3.] Say.']);
    expect(t[2]!.startsWith('1.\tTrue one\t')).toBe(true);
    expect(t.slice(3)).toEqual(['Answers', 'One', '1.\tcat', '2.\ta) Yes', 'Two', '3.\t1 T']);
  });
});
