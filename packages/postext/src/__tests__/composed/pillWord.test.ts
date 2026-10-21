import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build';
import { createMeasurementCache } from '../../measure';
import type { FrameConfig, PageTemplate } from '../../composed/types';
import type { ContentWarning, PostextConfig, VDTDocument, VDTFrame, VDTLine } from '../../index';

// #1084: a pill held to its height (`minHeight` = `maxHeight`) whose word is
// wider than its measure. The ladder's text shrink used to stop at the
// largest scale that fits, which could be one where the word is divided
// over two short lines; a smaller scale, down to `fit.minScale`, that sets
// the word whole and fits wins. Dividing stays the last resort.

// Half an em per character, at the font's size: the text shrinks with it.
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16);
    return { width: s.length * size * 0.5 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const CONFIG: PostextConfig = {
  page: { width: mm(200), height: mm(260), dpi: 300, margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: false } }] } as never,
  bodyText: { fontSize: pt(11), lineHeight: pt(16), firstLineIndent: pt(0) } as never,
  calloutStyles: [{ id: 'pill', backgroundEnabled: true, background: hex('#cfe3f5'), padding: { top: mm(0), right: mm(1), bottom: mm(0), left: mm(1) } }] as never,
};
const at: FrameConfig['placement'] = { anchor: { to: 'container', edge: 'top-left' } };
/** A pill 32 mm wide (30 mm of measure) and 10.5 mm tall: the 19-letter
 *  word is 36.8 mm at full size, whole from a scale of 0.825; two lines of
 *  it fit the height from 0.93 down. */
const pill = (fit: FrameConfig['fit'], extra: Partial<FrameConfig> = {}): FrameConfig => ({
  name: 'pill', style: 'pill', placement: at, width: mm(32), minHeight: mm(10.5), maxHeight: mm(10.5), verticalAlign: 'middle', fit, ...extra,
});
const WORD = 'Administrationalism';
const build = (frames: FrameConfig[], word = WORD): VDTDocument =>
  buildDocument({ markdown: `::::page{template="t"}\n\n:::frame{slot="pill"}\n${word}\n:::\n\n::::` }, { ...CONFIG, pageTemplates: [{ id: 't', frames } as PageTemplate] }, createMeasurementCache());
const page = (doc: VDTDocument) => doc.pages.find((p) => p.composed)!;
const frame = (doc: VDTDocument): VDTFrame => page(doc).composed!.frames.find((f) => f.name === 'pill')!;
const lines = (doc: VDTDocument): VDTLine[] => (page(doc).floats ?? []).filter((b) => frame(doc).blockIds.includes(b.id)).flatMap((b) => b.lines ?? []);
const overflows = (doc: VDTDocument) => (doc.contentWarnings ?? []).filter((w): w is Extract<ContentWarning, { kind: 'frameOverflow' }> => w.kind === 'frameOverflow');

describe('a one-line pill sets a long word smaller before it divides it (#1084)', () => {
  it('the word whole, at the largest scale that sets it whole, within minScale', () => {
    const doc = build([pill({ minScale: 0.7 })]);
    expect(lines(doc).map((l) => l.text)).toEqual([WORD]);
    expect(lines(doc)[0]!.hyphenated).toBe(false);
    const s = frame(doc).scale;
    expect(s).toBeGreaterThanOrEqual(0.7);
    expect(s).toBe(0.825);
    expect(frame(doc).overflowPx).toBe(0);
    expect(overflows(doc)).toEqual([]);
  });

  it('with minScale 1 the word is divided as before (and overflows the pill)', () => {
    const doc = build([pill({ minScale: 1 })]);
    expect(lines(doc).length).toBe(2);
    expect(lines(doc)[0]!.hyphenated).toBe(true);
    expect(frame(doc).scale).toBe(1);
    expect(overflows(doc)).toHaveLength(1);
  });

  it('a minScale the whole word does not reach keeps the largest scale that fits, divided', () => {
    // Whole from 0.825: at 0.85 the word still divides; two lines fit there.
    const doc = build([pill({ minScale: 0.85 })]);
    expect(lines(doc).length).toBe(2);
    expect(frame(doc).scale).toBe(0.925);
    expect(overflows(doc)).toEqual([]);
  });

  it('also when the divided word fits the height at full size: a pill tall enough for its two pieces', () => {
    // 12 mm holds two lines of 16 pt: the frame is not short, the word
    // used to stay divided at full size.
    const doc = build([pill({ minScale: 0.7 }, { minHeight: mm(12), maxHeight: mm(12) })]);
    expect(lines(doc).map((l) => l.text)).toEqual([WORD]);
    expect(frame(doc).scale).toBe(0.825);
    // A fixed height holds it the same way.
    const fixed = build([pill({ minScale: 0.7 }, { height: mm(12), minHeight: undefined, maxHeight: undefined })]);
    expect(frame(fixed).scale).toBe(0.825);
    // A frame free to grow (no maxHeight, no fixed height) keeps its size.
    const free = build([pill({ minScale: 0.7 }, { minHeight: undefined, maxHeight: undefined })]);
    expect(lines(free).length).toBe(2);
    expect(frame(free).scale).toBe(1);
    // As does one whose text may not shrink.
    const kept = build([pill({ minScale: 0.7, shrinkText: false }, { minHeight: mm(12), maxHeight: mm(12) })]);
    expect(lines(kept).length).toBe(2);
    expect(frame(kept).scale).toBe(1);
  });

  it('a pill whose words wrap at spaces is not set smaller for it', () => {
    // Two short words on two lines fit at full size: no division, no shrink.
    const doc = build([pill({ minScale: 0.7 }, { minHeight: mm(12), maxHeight: mm(12) })], 'Public office');
    expect(frame(doc).scale).toBe(1);
  });
});
