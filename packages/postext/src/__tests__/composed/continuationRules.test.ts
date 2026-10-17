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
