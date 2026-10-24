import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { contentOutline } from '../../pipeline/continuation.js';
import { createMeasurementCache } from '../../measure/index.js';
import { readOperation } from '../../exercises/model.js';
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
const build = (md: string, cfg: PostextConfig = base): VDTDocument => buildDocument({ markdown: md }, cfg, createMeasurementCache());

describe('exercises named, banks placed (#1225, #1227)', () => {
  it('a reference to an exercise prints its name', () => {
    const md = '# One\n\n:::exercise{#ex:roots}\nFill [[in]].\n:::\n\n:::exercise{#ex:tree}\nPick.\n\n- [x] a\n- [ ] b\n:::\n\nSee :ref{id="ex:tree"}.\n';
    expect(texts(build(md)).at(-1)).toBe('See Exercise 2.');
    const outline = contentOutline({ markdown: md }, base).outline;
    expect(outline.filter((e) => e.kind === 'anchor').map((e) => [e.anchorId, e.numberLabel, e.number])).toEqual([['ex:roots', 'Exercise 1', '1'], ['ex:tree', 'Exercise 2', '2']]);
  });

  it('sets the bank where its line stands, without the model answer', () => {
    const md = ':::exercise{example}\nComplete.\n\n1. The roots take in [[water]].\n\n::bank[stones]\n\n2. The leaves make [[food]].\n:::\n';
    const t = texts(build(md));
    const bank = t.findIndex((x) => x.includes('[stones]'));
    expect(t[bank]).not.toContain('[water]');
    expect(t[bank]).toContain('[food]');
    expect(bank).toBeGreaterThan(t.findIndex((x) => x.includes('roots')));
    expect(bank).toBeLessThan(t.findIndex((x) => x.includes('leaves')));
  });

  it('reads a multiplication written with a middle dot', () => {
    expect(readOperation('124 · 3', 0)).toMatchObject({ op: '×', result: '372' });
  });
});
