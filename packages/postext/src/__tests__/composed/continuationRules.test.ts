import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build';
import { createMeasurementCache } from '../../measure';
import type { FrameConfig, PageTemplate } from '../../composed/types';
import type { ContentWarning, PostextConfig, VDTBlock, VDTDocument, VDTFrame, VDTPage } from '../../index';
import { page8Fixture } from './fixtures/page8';

// Findings of the composed-pages recipes (#882) on content that goes on to
// other pages: the ladder's order (#920), the frame that takes the content
// (#919), where a frame is cut (#913), what an added page keeps (#912) and
// a story that jumps to a later page (#917).

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
const MM = 300 / 25.4;
const BASE = page8Fixture('es').config;

const build = (markdown: string, templates: PageTemplate[], config: Partial<PostextConfig> = {}): VDTDocument =>
  buildDocument({ markdown, resources: page8Fixture('es').resources }, { ...BASE, ...config, pageTemplates: templates }, createMeasurementCache());
const composedPages = (doc: VDTDocument): VDTPage[] => doc.pages.filter((p) => p.composed);
const frameOn = (page: VDTPage, name: string): VDTFrame => page.composed!.frames.find((f) => f.name === name)!;
const blocksOf = (page: VDTPage, f: VDTFrame): VDTBlock[] => f.blockIds.map((id) => page.floats!.find((b) => b.id === id)!);
const textOf = (blocks: readonly VDTBlock[]): string => blocks.filter((b) => b.type !== 'callout').flatMap((b) => b.lines.map((l) => l.text)).join(' ');
const overlayOf = (box: VDTBlock | undefined): string[] =>
  (box?.designOverlay?.blocks ?? []).flatMap((d) => (d.kind === 'text' ? [d.lines.map((l) => l.text).join(' ')] : []));
const warningsOf = (doc: VDTDocument, ...kinds: string[]): ContentWarning[] => (doc.contentWarnings ?? []).filter((w) => kinds.includes(w.kind));
const para = (word: string, n: number): string => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
const count = (s: string, word: string): number => s.split(word).length - 1;

/** A page with one box held to `heightMm`, its text `words` long. */
const oneBox = (frame: Partial<FrameConfig>, extra: PageTemplate[] = []): PageTemplate[] => [
  { id: 'hoja', header: false, frames: [{ name: 'caja', style: 'caja-azul', width: mm(186), placement: { anchor: { to: 'container', edge: 'top-left' } }, ...frame }] },
  ...extra,
];
const boxPage = (words: number): string => ['::::page{template="hoja"}', ':::frame{slot="caja" label="Caja"}', para('palabra', words), ':::', '::::', ''].join('\n');

describe('the ladder goes on before it shrinks a frame that can continue (#920)', () => {
  // A box a few lines short: shrinking to 90 % would make it fit.
  const words = (() => {
    for (let n = 100; n < 2000; n += 20) {
      const doc = build(boxPage(n), oneBox({ height: mm(60), overflow: { continueIn: 'next-page' }, fit: { preferContinue: false } }));
      const first = composedPages(doc)[0]!;
      if (frameOn(first, 'caja').scale < 0.95) return n;
    }
    throw new Error('no length found');
  })();

  it('by default the box goes on at full size', () => {
    const doc = build(boxPage(words), oneBox({ height: mm(60), overflow: { continueIn: 'next-page' } }));
    const pages = composedPages(doc);
    expect(pages).toHaveLength(2);
    for (const p of pages) expect(frameOn(p, 'caja').scale).toBe(1);
    expect(pages[0]!.composed!.log.some((e) => e.kind === 'textScaled')).toBe(false);
    expect(pages[0]!.composed!.log.some((e) => e.kind === 'continued')).toBe(true);
    expect(warningsOf(doc, 'frameOverflow')).toEqual([]);
  });

  it('fit.preferContinue: false shrinks first and keeps the story on its page', () => {
    const doc = build(boxPage(words), oneBox({ height: mm(60), overflow: { continueIn: 'next-page' }, fit: { preferContinue: false } }));
    const pages = composedPages(doc);
    expect(pages).toHaveLength(1);
    expect(frameOn(pages[0]!, 'caja').scale).toBeLessThan(1);
    expect(pages[0]!.composed!.log.some((e) => e.kind === 'textScaled')).toBe(true);
  });

  it('a frame that cannot go on still shrinks', () => {
    const doc = build(boxPage(words), oneBox({ height: mm(60) }));
    expect(frameOn(composedPages(doc)[0]!, 'caja').scale).toBeLessThan(1);
  });

  it('on the last page continuation may add, the text shrinks again', () => {
    // The tiny receiver takes none of it: the step is reverted, and the
    // ladder shrinks the text before it warns.
    const tiny: PageTemplate = { id: 'diminuta', header: false, frames: [{ name: 'caja', style: 'caja-azul', width: mm(186), height: mm(4) }] };
    const doc = build(boxPage(words * 4), oneBox({ height: mm(60), overflow: { continueIn: 'template:diminuta' } }, [tiny]));
    const ws = warningsOf(doc, 'frameOverflow') as Extract<ContentWarning, { kind: 'frameOverflow' }>[];
    expect(ws).toHaveLength(1);
    expect(ws[0]!.stepsTried).toEqual(['free', 'continue', 'shrinkText']);
  });
});

describe('a threaded story goes on where its chain starts (#919)', () => {
  /** Three columns threaded a → b → c; c goes on as `rule`. */
  const columns = (id: string, prefix: string, rule: string): PageTemplate => ({
    id,
    header: false,
    frames: (['1', '2', '3'] as const).map((k, i) => ({
      name: `${prefix}-${k}`,
      width: mm(56),
      height: 'fill' as const,
      placement: { anchor: { to: 'container' as const, edge: 'top-left' as const }, offset: { x: mm(i * 62) } },
      ...(k === '1' ? { flow: true } : {}),
      ...(k !== '3' ? { next: `${prefix}-${Number(k) + 1}` } : { overflow: { continueIn: rule } }),
      fit: { shrinkText: false, scaleImages: false },
    })),
  });
  const story = ['::::page{template="cuerpo"}', ...Array.from({ length: 70 }, (_, i) => [para(`p${i}w`, 110), '']).flat(), '::::', ''].join('\n');

  for (const rule of ['template:cuerpo', 'next-page']) {
    it(`a template that goes on into itself fills every column of every added page (${rule})`, () => {
      const doc = build(story, [columns('cuerpo', 'col', rule)]);
      const pages = composedPages(doc);
      expect(pages.length).toBeGreaterThanOrEqual(4);
      // Every page but the last fills its three columns.
      for (const p of pages.slice(0, -1)) {
        for (const k of ['1', '2', '3']) expect(frameOn(p, `col-${k}`).blockIds.length, `p. ${p.index} col-${k}`).toBeGreaterThan(0);
      }
      expect(pages[pages.length - 1]!.composed!.frames.find((f) => f.name === 'col-1')!.blockIds.length).toBeGreaterThan(0);
      // The chain goes on from c to the next page's a.
      for (let k = 1; k < pages.length; k++) {
        expect(frameOn(pages[k]!, 'col-1').continuedFrom).toBe(frameOn(pages[k - 1]!, 'col-3').id);
      }
      expect(warningsOf(doc, 'frameOverflow', 'frameContinuationLimit')).toEqual([]);
      // Every word once.
      const all = pages.flatMap((p) => ['1', '2', '3'].map((k) => textOf(blocksOf(p, frameOn(p, `col-${k}`))))).join(' ');
      for (const i of [0, 17, 39, 69]) expect(count(all, `p${i}w5 `)).toBe(1);
    });
  }

  it('goes on in the flow frame of another template whose frames have other names', () => {
    const doc = build(story.replace('template="cuerpo"', 'template="primera"'), [columns('primera', 'col', 'template:seguido'), columns('seguido', 'sig', 'template:seguido')]);
    const pages = composedPages(doc);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const p of pages.slice(1, -1)) {
      for (const k of ['1', '2', '3']) expect(frameOn(p, `sig-${k}`).blockIds.length).toBeGreaterThan(0);
    }
  });
});

describe('a frame is cut as the running text is (#913)', () => {
  const steps = (lead: number, items = 5): string => [
    '::::page{template="hoja"}',
    ':::frame{slot="caja" label="Pasos"}',
    para('intro', lead),
    '',
    '### Mi registro de la semana',
    '',
    ...Array.from({ length: items }, (_, i) => `- ${para(`item${i}w`, 12)}`),
    ':::',
    '::::',
    '',
  ].join('\n');
  /** The first piece of each length of introduction, and the second. */
  const cuts = (items: number) => Array.from({ length: 60 }, (_, k) => 40 + k * 6).map((lead) => {
    const doc = build(steps(lead, items), oneBox({ height: mm(70), overflow: { continueIn: 'next-page' } }));
    const pages = composedPages(doc);
    const piece = (p: VDTPage | undefined) => (p ? blocksOf(p, frameOn(p, 'caja')).filter((b) => b.type !== 'callout') : []);
    return { lead, first: piece(pages[0]), rest: piece(pages[1]), doc };
  });

  it('never leaves a heading at the foot of a piece', () => {
    let seen = 0;
    for (const { first, rest } of cuts(5)) {
      if (rest.length === 0) continue;
      seen++;
      expect(first[first.length - 1]!.type).not.toBe('heading');
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('leaves at least two items of a list on each side of a cut between items', () => {
    let between = 0;
    for (const { first, rest } of cuts(5)) {
      const before = first.filter((b) => b.type === 'listItem').length;
      const after = rest.filter((b) => b.type === 'listItem').length;
      // A cut inside an item counts it on both sides.
      const split = before > 0 && after > 0 && before + after > 5;
      if (before === 0 || after === 0 || split) continue;
      between++;
      expect(before).toBeGreaterThanOrEqual(2);
      expect(after).toBeGreaterThanOrEqual(2);
    }
    expect(between).toBeGreaterThan(0);
  });

  it("a short list under shortListSplit: 'avoid' moves whole", () => {
    for (const lead of Array.from({ length: 40 }, (_, k) => 40 + k * 8)) {
      const doc = build(steps(lead, 3), oneBox({ height: mm(70), overflow: { continueIn: 'next-page' } }), { bodyText: { ...BASE.bodyText, shortListSplit: 'avoid' } as never });
      const pages = composedPages(doc);
      if (pages.length < 2) continue;
      const items = (p: VDTPage) => blocksOf(p, frameOn(p, 'caja')).filter((b) => b.type === 'listItem').length;
      const a = items(pages[0]!);
      const b = items(pages[1]!);
      // Whole on one side, or cut inside one item.
      expect(a === 0 || b === 0 || a + b === 4).toBe(true);
    }
  });
});
