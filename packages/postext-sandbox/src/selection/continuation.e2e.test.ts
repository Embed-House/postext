import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource, VDTBlock, VDTDocument, VDTFrame, VDTPage } from 'postext';
import { atLevel, breadcrumb, breadcrumbText, pickAt, resolveSelection, selectedElement, type CrumbLabels } from './pageSelection';
import { selectionTarget } from './selectionTargets';

// A frame whose content goes on on a page added after the composed page
// (#859): the piece there is the same `:::frame` of the Markdown (#865).

class StubCtx {
  font = '';
  measureText(s: string): { width: number } { return { width: s.length * 7 }; }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class { getContext(): StubCtx { return new StubCtx(); } };

type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const mm = (value: number) => ({ value, unit: 'mm' as const });
const MM = 300 / 25.4;
const LABELS = { selectionPage: 'Page __name__', selectionGroup: '__name__', selectionFrame: '__name__', selectionParagraph: 'paragraph __n__', selectionText: 'text', selectionBox: 'box __n__' } as unknown as CrumbLabels;

/** The first box's text twice over. */
const doubled = (md: string): string => md.replace(/(:::frame\{slot="dinero"[^\n]*\n)([\s\S]*?)(\n:::\n)/, (_, open: string, body: string, close: string) => `${open}${body}\n\n${body}${close}`);
const SIGUE = (name: string) => ({
  id: 'tema-sigue',
  header: false,
  frames: [{ name, style: 'caja-azul', width: mm(186), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { y: mm(8) } } }],
});

let page8: Fixture;
beforeAll(async () => {
  page8 = ((await import(/* @vite-ignore */ new URL('../../../postext/src/__tests__/composed/fixtures/page8.ts', import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
});

function build(locale: 'es' | 'en', overflowFrame: string, edit: (md: string) => string = (m) => m): { md: string; doc: VDTDocument } {
  const f = page8(locale);
  const base = f.config.pageTemplates![0]! as unknown as { frames: { name: string }[] } & Record<string, unknown>;
  const loose = { ...base, frames: base.frames.map((fr) => (fr.name === 'dinero' ? { ...fr, minHeight: undefined } : fr)) };
  const tight = buildDocument({ markdown: f.markdown, resources: f.resources }, { ...f.config, pageTemplates: [loose] as never }, createMeasurementCache());
  const boxMm = Math.ceil(tight.pages[0]!.composed!.frames.find((fr) => fr.name === 'dinero')!.rect.height / MM) + 6;
  const tpl = { ...base, overflowTemplate: 'tema-sigue', frames: base.frames.map((fr) => (fr.name === 'dinero' ? { ...fr, minHeight: undefined, maxHeight: mm(boxMm), overflow: { continueIn: 'next-page' } } : fr)) };
  const md = edit(doubled(f.markdown));
  const doc = buildDocument({ markdown: md, resources: f.resources }, { ...f.config, pageTemplates: [tpl, SIGUE(overflowFrame)] as never }, createMeasurementCache());
  return { md, doc };
}

const composed = (doc: VDTDocument): VDTPage[] => doc.pages.filter((p) => p.composed);
const piece = (page: VDTPage): VDTFrame => page.composed!.frames.find((f) => f.id === 'cp0:dinero~1')!;
const textBlocks = (page: VDTPage, f: VDTFrame): VDTBlock[] => f.blockIds.map((id) => page.floats!.find((b) => b.id === id)!).filter((b) => b && b.type !== 'callout' && b.lines.length > 0);
const onText = (b: VDTBlock) => ({ x: b.lines[0]!.bbox.x + 3, y: b.lines[0]!.bbox.y + b.lines[0]!.bbox.height / 2 });

describe('a continued frame across its added page (#859, #865)', () => {
  for (const name of ['dinero', 'cuerpo']) {
    it(`a click on the piece on the added page selects text of the same :::frame (overflow frame named ${name})`, () => {
      const { md, doc } = build('es', name);
      const [, added] = composed(doc) as [VDTPage, VDTPage];
      expect(added.composed!.continuationOf).toBeDefined();
      const f = piece(added);
      const block = textBlocks(added, f)[0]!;
      const p = onText(block);
      const sel = pickAt(doc, added.index, p.x, p.y, null)!;
      const fence = md.indexOf(':::frame{slot="dinero"');
      const close = md.indexOf('\n:::\n', fence);
      const glyph = selectedElement(sel).source as { kind: string; start: number };
      expect(glyph.kind).toBe('markdown');
      expect(glyph.start).toBeGreaterThan(fence);
      expect(glyph.start).toBeLessThan(close);
      // Climbing: the paragraph, then the frame, both inside the fence.
      const para = selectionTarget(doc, atLevel(sel, 1), 'content') as { kind: string; start: number; end: number };
      expect(para.kind).toBe('markdown');
      expect(para.start).toBeGreaterThan(fence);
      expect(para.end).toBeLessThanOrEqual(close);
      const frameAt = sel.chain.findIndex((e) => e.level === 'frame');
      expect(sel.chain[frameAt]!.id).toBe('cp0:dinero~1');
      const frame = selectionTarget(doc, atLevel(sel, frameAt), 'content') as { kind: string; start: number; end: number };
      expect(frame.kind).toBe('markdown');
      expect(frame.start).toBeGreaterThan(fence);
      expect(frame.end).toBeLessThanOrEqual(close);
      // The path names the slot written in the Markdown.
      expect(breadcrumbText(breadcrumb(doc, atLevel(sel, frameAt)), LABELS)).toBe(`Page ${added.pageLabel} › dinero`);
    });
  }

  it('the piece picked is found again after the text before the box grows', () => {
    const { doc } = build('es', 'dinero');
    const [, added] = composed(doc) as [VDTPage, VDTPage];
    const f = piece(added);
    const p = onText(textBlocks(added, f)[0]!);
    const sel = pickAt(doc, added.index, p.x, p.y, null)!;
    const frameAt = sel.chain.findIndex((e) => e.level === 'frame');
    const after = build('es', 'dinero', (md) => md.replace('Cada familia necesita', 'Cada familia, grande o pequeña, necesita')).doc;
    const again = resolveSelection(after, atLevel(sel, frameAt))!;
    expect(selectedElement(again)).toMatchObject({ level: 'frame', id: 'cp0:dinero~1' });
    expect(after.pages[again.pageIndex]!.composed!.continuationOf).toBeDefined();
  });
});
