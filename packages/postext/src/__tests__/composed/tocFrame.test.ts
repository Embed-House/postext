/**
 * The contents in a frame of a composed page (#983, #987): a `:::toc` inside
 * a frame, or taken by a frame with `takes: 'toc'`, is laid by the contents'
 * own rules: part rows drawn from `toc.parts.design`, the rhythm of the
 * flow's contents (no repeated head row between entries), entries that link
 * to their page, a block kept together across the cuts of `overflow`.
 */
import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build';
import { createMeasurementCache } from '../../measure';
import { checkComposedSlots } from '../../composed/slotChecks';
import { composedPages } from '../../composed/document';
import { validatePageTemplates } from '../../composed/validate';
import { parseMarkdown } from '../../parse';
import type { PageTemplate } from '../../composed/types';
import type { PostextConfig, VDTBlock, VDTDocument, VDTFrame, VDTPage } from '../../index';

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
const DPI = 300;
const MM = DPI / 25.4;
const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const PAGE: PostextConfig = {
  page: { width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: false } }] } as never,
  headingStyles: [{ id: 'indice', numbered: false, toc: false }] as never,
  toc: { parts: { enabled: true } } as never,
  bodyText: { paragraphSpacing: true } as never,
};

/** A template with the contents' own frame under a title frame. */
const template = (extra: Partial<PageTemplate['frames'] extends (infer F)[] | undefined ? F : never> = {}, listHeight = mm(200)): PageTemplate => ({
  id: 'contents',
  frames: [
    { name: 'title', takes: 'h1', height: mm(20), placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'list', takes: 'toc', height: listHeight, placement: { anchor: { to: '#title', edge: 'below' }, offset: { y: mm(4) } }, ...extra },
  ] as never,
});

/** `parts` parts of `per` chapters each, then the page of contents first. */
const book = (page: string, parts = 2, per = 2): string => {
  const out: string[] = [page];
  for (let p = 0; p < parts; p++) {
    out.push(`:::part{number="${'ABCDEF'[p]}" title="Part ${p + 1}"}\n:::`);
    for (let c = 0; c < per; c++) out.push(`# Chapter ${p}-${c}\n\n${words(30)}`);
  }
  return out.join('\n\n');
};
const TAKING = `::::page{template="contents"}
# Contents {style="indice"}

:::toc{keep="part"}
::::`;
const SLOTTED = `::::page{template="contents"}
# Contents {style="indice"}

:::frame{slot="list"}
:::toc{keep="part"}
:::
::::`;

const build = (md: string, templates: PageTemplate[], extra: PostextConfig = {}): VDTDocument =>
  buildDocument({ markdown: md }, { ...PAGE, ...extra, pageTemplates: templates }, createMeasurementCache());
const composed = (doc: VDTDocument): VDTPage[] => doc.pages.filter((p) => p.composed);
const frameOf = (page: VDTPage, name: string): VDTFrame => page.composed!.frames.find((f) => f.name === name)!;
const blocksOf = (page: VDTPage, f: VDTFrame): VDTBlock[] => f.blockIds.map((id) => page.floats!.find((b) => b.id === id)!);
const text = (b: VDTBlock): string => b.lines.map((l) => l.text).join(' ');
const rows = (page: VDTPage, name: string): VDTBlock[] => blocksOf(page, frameOf(page, name)).filter((b) => b.type !== 'callout');

describe('the contents in a frame (#983)', () => {
  for (const [how, md] of [['taken by a frame with takes: toc', TAKING], ['written inside a :::frame', SLOTTED]] as const) {
    it(`${how}: part rows are drawn and entries follow each other without a repeated head row`, () => {
      const doc = build(book(md), [template()]);
      const page = composed(doc)[0]!;
      const list = rows(page, 'list');
      // Part A, its two entries, part B, its two entries.
      expect(list.map((b) => (b.tocPart ? 'part' : text(b).replace(/ \d+$/, '')))).toEqual(['part', 'Chapter 0-0', 'Chapter 0-1', 'part', 'Chapter 1-0', 'Chapter 1-1']);
      for (const part of list.filter((b) => b.tocPart)) {
        expect(part.designOverlay).toBeDefined();
        expect(part.designOverlay!.blocks.some((b) => b.kind === 'text')).toBe(true);
      }
      // The title that heads the page is not one of the entries.
      expect(list.map(text).join(' ')).not.toContain('Contents');
    });

    it(`${how}: rows are spaced as the flow's contents are, and entries link to their page`, () => {
      const doc = build(book(md), [template()]);
      const page = composed(doc)[0]!;
      const list = rows(page, 'list');
      const flowDoc = buildDocument({ markdown: book(md.replace(/::::page[^\n]*\n/, '').replace(/:::frame\{slot="list"\}\n/, '').replace(/\n:::\n::::/, '\n').replace(/\n::::$/, '')) }, { ...PAGE }, createMeasurementCache());
      const flow = flowDoc.blocks.filter((b) => b.pageIndex === 0 && (b.tocPart || b.tocEntry));
      expect(flow).toHaveLength(list.length);
      const gaps = (bs: VDTBlock[]) => bs.slice(1).map((b, i) => Math.round((b.bbox.y - bs[i]!.bbox.y) * 100) / 100);
      expect(gaps(list)).toEqual(gaps(flow));
      const entries = list.filter((b) => b.tocEntry);
      expect(entries.every((b) => b.tocEntry!.pageIndex !== undefined)).toBe(true);
      expect(entries.map((b) => text(b).match(/(\d+)$/)?.[1])).toEqual(flow.filter((b) => b.tocEntry).map((b) => text(b).match(/(\d+)$/)?.[1]));
    });
  }

  it('takes: toc leaves the title to its own frame and the contents to theirs', () => {
    const doc = build(book(TAKING), [template()]);
    const page = composed(doc)[0]!;
    expect(blocksOf(page, frameOf(page, 'title')).some((b) => b.type === 'heading' && text(b) === 'Contents')).toBe(true);
    expect(rows(page, 'title').some((b) => b.tocEntry || b.tocPart)).toBe(false);
    // Nothing of the contents is left in the flow.
    expect(doc.blocks.filter((b) => (b.tocEntry || b.tocPart) && !blocksOf(page, frameOf(page, 'list')).includes(b))).toEqual([]);
  });

  it('a template ground stays under the contents: decoration paints before the frame', () => {
    const ground: PageTemplate = { ...template(), decoration: { elements: [{ kind: 'box', id: 'ground', placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } }, style: { backgroundColor: { hex: '#fdf1d6', model: 'hex' } } }] } as never };
    const page = composed(build(book(TAKING), [ground]))[0]!;
    const box = page.composed!.decoration!.blocks.find((b) => b.kind === 'box')!;
    expect(box.bbox.width).toBeGreaterThanOrEqual(200 * MM - 1);
    expect(box.bbox.height).toBeGreaterThanOrEqual(260 * MM - 1);
    expect(rows(page, 'list').length).toBeGreaterThan(0);
  });

  it('a block of the contents goes whole to the page that follows when a cut would split it', () => {
    // 45 mm of contents: part A with its entries fit, part B does not.
    const tall = book(TAKING.replace('::::page{template="contents"}', '::::page{template="contents"}'), 2, 5);
    const t = template({ overflow: { continueIn: 'next-page' } }, mm(50));
    const doc = build(tall, [t]);
    const pages = composed(doc);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const first = rows(pages[0]!, 'list').map((b) => (b.tocPart ? `part:${b.tocPart.title}` : text(b).replace(/ \d+$/, '')));
    const second = rows(pages[1]!, 'list').map((b) => (b.tocPart ? `part:${b.tocPart.title}` : text(b).replace(/ \d+$/, '')));
    expect(first[0]).toBe('part:Part 1');
    expect(first.filter((r) => r.startsWith('Chapter 0'))).toHaveLength(5);
    // Part 2 is not cut: it opens the added page with all five entries.
    expect(first.some((r) => r === 'part:Part 2')).toBe(false);
    expect(second[0]).toBe('part:Part 2');
    expect(second.filter((r) => r.startsWith('Chapter 1'))).toHaveLength(5);
    // The page that goes on carries the template's decoration.
    expect(pages[1]!.composed!.frames.some((f) => f.name === 'list')).toBe(true);
  });

  it('a block taller than the frame is cut after its head and two entries, and the added page repeats the head', () => {
    const t = template({ overflow: { continueIn: 'next-page' } }, mm(42));
    const doc = build(book(TAKING, 1, 12), [t]);
    const pages = composed(doc);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const first = rows(pages[0]!, 'list');
    const second = rows(pages[1]!, 'list');
    expect(first[0]!.tocPart?.title).toBe('Part 1');
    expect(first.filter((b) => b.tocEntry).length).toBeGreaterThanOrEqual(2);
    // The rest opens with the head repeated, marked as a repeat.
    expect(second[0]!.tocPart?.continued).toBe(true);
    expect(second[0]!.designOverlay).toBeDefined();
    // Every entry is set once, in order.
    const names = [...first, ...second].filter((b) => b.tocEntry && !b.tocEntry.continued).map((b) => text(b).replace(/ \d+$/, ''));
    expect(names).toEqual(Array.from({ length: 12 }, (_, i) => `Chapter 0-${i}`));
    // No repeat anywhere but the top of the added page.
    expect([...first, ...second].filter((b) => b.tocPart?.continued)).toHaveLength(1);
  });

  it('the slot checks count the contents as what the frame receives', () => {
    const pagesOf = (md: string) => composedPages(parseMarkdown(md));
    const config = { pageTemplates: [template()] };
    expect(checkComposedSlots(pagesOf(TAKING), config)).toEqual([]);
    // No :::toc on the page: the frame that takes it has nothing.
    const empty = checkComposedSlots(pagesOf('::::page{template="contents"}\n# Contents\n::::'), config);
    expect(empty.map((w) => [w.kind, 'frame' in w ? w.frame : ''])).toEqual([['slotEmpty', 'list']]);
  });

  it('the settings check accepts takes: toc', () => {
    const warnings = validatePageTemplates({ pageTemplates: [template()] } as never);
    expect(warnings.filter((w) => w.kind === 'unknownConfigValue')).toEqual([]);
  });
});
