/**
 * Text panels (`::panel{text}`) on strips and spreads, and text set to the
 * middle or the foot of a slanted cell (#959).
 */
import { describe, it, expect } from 'vitest';
import { buildDocument, renderPageToCanvas, renderToHtml, collectContentWarnings, comicFramePaintOrder, composedFrameBlockIds, pageComics, sourceAt, flowRectToPage, flowToPage } from '../../index.js';
import { comicBlockOnSheet } from '../../comics/index.js';
import { innerBox } from '../../comics/textPanels.js';
import type { PostextConfig } from '../../types.js';
import type { BoundingBox, VDTBlock, VDTDocument, VDTPage } from '../../vdt.js';

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

const inside = (a: BoundingBox, b: BoundingBox): boolean =>
  a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
const stripPage = (doc: VDTDocument): VDTPage =>
  doc.pages.find((p) => p.columns.some((c) => c.blocks.some((b) => b.comic)) || (p.floats ?? []).some((b) => b.comic))!;
const stripBlock = (page: VDTPage): VDTBlock =>
  [...page.columns.flatMap((c) => c.blocks), ...(page.floats ?? [])].find((b) => b.comic)!;
const wordsOf = (b: VDTBlock): string => b.lines.map((l) => l.text).join(' ');

describe('text panels on a strip (#959)', () => {
  const md = 'Before the strip.\n\n:::strip{split="* | *" aspect=2.5}\n::panel{text}\nThe strip says *this* in its first panel.\n::panel\nana: Hello!\n:::\n\nAfter the strip.\n';

  it('sets the text in the panel frame, on the sheet where the strip stands, once', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = stripPage(doc);
    const strip = stripBlock(page);
    const frame = strip.comic!.frames![0]!;
    expect(frame.blockIds.length).toBeGreaterThan(0);
    // The strip's own comic stays relative to its block; the sheet copy has the text.
    const onSheet = comicBlockOnSheet(page, strip)!;
    expect(onSheet.frames![0]!.blockIds).toEqual(frame.blockIds);
    const floats = page.floats ?? [];
    expect(floats.filter((b) => frame.blockIds.includes(b.id)).length).toBe(frame.blockIds.length);
    for (const b of floats.filter((x) => frame.blockIds.includes(x.id))) {
      expect(doc.blocks.includes(b)).toBe(true);
      expect(inside(flowRectToPage(page, b.bbox), onSheet.panels[0]!.bbox)).toBe(true);
    }
    // The words are set in the frame and nowhere else.
    const holding = doc.blocks.filter((b) => wordsOf(b).includes('first panel'));
    expect(holding.length).toBe(1);
    expect(floats.includes(holding[0]!)).toBe(true);
    // The text after the strip is the flow's.
    expect(doc.blocks.some((b) => wordsOf(b).includes('After the strip.'))).toBe(true);
    expect(collectContentWarnings(md, {}).some((x) => x.kind === 'comicPanelFrame')).toBe(false);
  });

  it('moves with the strip: a floated strip keeps its text in its band', () => {
    const floated = md.replace('aspect=2.5', 'aspect=2.5 placement=bottom');
    const doc = buildDocument({ markdown: floated, resources: [] }, {});
    const page = stripPage(doc);
    const strip = stripBlock(page);
    const onSheet = comicBlockOnSheet(page, strip)!;
    const frame = onSheet.frames![0]!;
    expect(frame.blockIds.length).toBeGreaterThan(0);
    const texts = (page.floats ?? []).filter((b) => frame.blockIds.includes(b.id));
    expect(texts.length).toBe(frame.blockIds.length);
    for (const b of texts) expect(inside(flowRectToPage(page, b.bbox), onSheet.panels[0]!.bbox)).toBe(true);
  });

  it('sets a page-wide strip placed where it stands, text and all', () => {
    const wide = md.replace('aspect=2.5', 'aspect=4 span=page');
    const doc = buildDocument({ markdown: wide, resources: [] }, { layout: { columns: 2 } } as unknown as PostextConfig);
    const page = stripPage(doc);
    const onSheet = comicBlockOnSheet(page, stripBlock(page))!;
    const frame = onSheet.frames![0]!;
    expect(frame.blockIds.length).toBeGreaterThan(0);
    const texts = (page.floats ?? []).filter((b) => frame.blockIds.includes(b.id));
    expect(texts.length).toBe(frame.blockIds.length);
    for (const b of texts) expect(inside(flowRectToPage(page, b.bbox), onSheet.panels[0]!.bbox)).toBe(true);
    expect(doc.blocks.filter((b) => wordsOf(b).includes('first panel')).length).toBe(1);
  });

  it('clips what does not fit and reports it on the strip\'s page', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Line ${i} of a text far too long for its panel.`).join('\n\n');
    const overflowing = `Before.\n\n:::strip{split="* | *" aspect=3}\n::panel{text}\n${long}\n::panel\n:::\n`;
    const doc = buildDocument({ markdown: overflowing, resources: [] }, {});
    const page = stripPage(doc);
    expect(stripBlock(page).comic!.frames![0]!.overflowPx).toBeGreaterThan(0);
    const w = doc.contentWarnings?.find((x) => x.kind === 'comicPanelFrame');
    expect(w).toMatchObject({ reason: 'textOverflow', panel: 0, pageIndex: page.index });
  });

  it('paints the strip\'s panels, then its text, then its lettering', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = stripPage(doc);
    expect(composedFrameBlockIds(page).size).toBeGreaterThan(0);
    expect(comicFramePaintOrder(page, pageComics(page)[0]).length).toBe(1);
    const calls: string[] = [];
    const ctx: Record<string | symbol, unknown> = new Proxy({}, {
      get(target: Record<string | symbol, unknown>, key) {
        if (key === 'fillText') return (t: string) => calls.push(`text:${t}`);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    renderPageToCanvas(page, doc, { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement);
    const first = calls.findIndex((c) => c.includes('first'));
    const hello = calls.findIndex((c) => c.includes('Hello'));
    const before = calls.findIndex((c) => c.includes('Before'));
    expect(first).toBeGreaterThan(-1);
    expect(hello).toBeGreaterThan(first);
    expect(before).toBeGreaterThan(-1);
    // Written once: the frame's blocks are not painted again with the floats.
    expect(calls.filter((c) => c.includes('first')).length).toBe(1);
  });

  it('writes the frame inside the strip\'s markup, over its panel', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const html = renderToHtml(doc);
    const fig = html.indexOf('data-panel="0"');
    const frameAt = html.indexOf('data-frame-id="cm0:p1"');
    const next = html.indexOf('data-panel="1"');
    expect(fig).toBeGreaterThan(-1);
    expect(frameAt).toBeGreaterThan(fig);
    expect(next).toBeGreaterThan(frameAt);
  });

  it('answers a click on its words with the text, then the frame and the strip', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = stripPage(doc);
    const strip = stripBlock(page);
    const frame = strip.comic!.frames![0]!;
    const para = (page.floats ?? []).find((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph')!;
    const line = para.lines[0]!;
    const at = flowToPage(page, line.bbox.x + 4, line.bbox.y + line.bbox.height / 2);
    const chain = sourceAt(doc, page.index, at.x, at.y);
    expect(chain[0]!.level).toBe('text');
    expect(chain.slice(-2).map((e) => e.id)).toEqual(['cm0:p1', 'cm0']);
  });

  it('sets a vertical book\'s strip text vertically, inside the panel', () => {
    const config = { locale: 'ja', layout: { writingMode: 'vertical-rl', layoutType: 'single' } } as unknown as PostextConfig;
    const jp = '前の文。\n\n:::strip{split="* | *" aspect=2.5}\n::panel{text}\nコマの中の言葉です。\n::panel\n:::\n';
    const doc = buildDocument({ markdown: jp, resources: [] }, config);
    const page = stripPage(doc);
    expect(page.flow).toBeDefined();
    const onSheet = comicBlockOnSheet(page, stripBlock(page))!;
    const frame = onSheet.frames![0]!;
    expect(frame.blockIds.length).toBeGreaterThan(0);
    for (const b of (page.floats ?? []).filter((x) => frame.blockIds.includes(x.id) && x.type === 'paragraph')) {
      expect(inside(flowRectToPage(page, b.bbox), onSheet.panels[0]!.bbox)).toBe(true);
    }
  });
});

describe('text panels on a spread (#959)', () => {
  const half = (doc: VDTDocument, side: 'left' | 'right'): VDTPage => doc.pages.find((p) => p.comic?.spread === side)!;

  it('sets a text panel of one half on that page', () => {
    const md = ':::page{spread split="* | *"}\n::panel{text}\nWords of the left page.\n::panel{text}\nWords of the right page.\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    for (const [side, words] of [['left', 'left page'], ['right', 'right page']] as const) {
      const page = half(doc, side);
      const comic = page.comic!;
      const frame = comic.frames!.find((f) => f.blockIds.length > 0)!;
      expect(frame).toBeDefined();
      const texts = (page.floats ?? []).filter((b) => frame.blockIds.includes(b.id));
      expect(texts.length).toBe(frame.blockIds.length);
      expect(texts.some((b) => wordsOf(b).includes(words))).toBe(true);
      for (const b of texts) expect(inside(b.bbox, comic.panels.find((p) => p.index === frame.panel)!.bbox)).toBe(true);
    }
    // Each text once, and nothing left for the flow.
    expect(doc.blocks.filter((b) => wordsOf(b).includes('left page')).length).toBe(1);
    expect(doc.blocks.filter((b) => wordsOf(b).includes('right page')).length).toBe(1);
    expect(collectContentWarnings(md, {}).some((x) => x.kind === 'comicPanelFrame')).toBe(false);
  });

  it('gives a panel across the spine to the page that holds most of it, off the gutter', () => {
    const md = ':::page{spread split="* / *" }\n::panel{text}\n' + 'Words that run across the spread. '.repeat(10) + '\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const left = half(doc, 'left');
    const right = half(doc, 'right');
    const holders = [left, right].filter((p) => p.comic!.frames!.some((f) => f.blockIds.length > 0));
    expect(holders.length).toBe(1);
    const page = holders[0]!;
    const frame = page.comic!.frames!.find((f) => f.blockIds.length > 0)!;
    const texts = (page.floats ?? []).filter((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph');
    expect(texts.length).toBeGreaterThan(0);
    // The gutter: 8 mm about the spine, half of it on this page.
    const dpi = doc.config.page.dpi;
    const gutter = (4 / 25.4) * dpi;
    const spineX = page.comic!.spread === 'left' ? page.comic!.frame.x + page.comic!.frame.width : page.comic!.frame.x;
    for (const b of texts) {
      for (const l of b.lines) {
        const span = l.measure ?? { x: l.bbox.x, width: l.bbox.width };
        if (page.comic!.spread === 'left') expect(span.x + span.width).toBeLessThanOrEqual(spineX - gutter + 1);
        else expect(span.x).toBeGreaterThanOrEqual(spineX + gutter - 1);
      }
    }
    expect(doc.blocks.filter((b) => wordsOf(b).includes('across the spread')).length).toBeGreaterThan(0);
  });

  it('reports a text that does not fit on its page', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of a text far too long for its panel.`).join('\n\n');
    const md = `:::page{spread split="10 / *"}\n::panel{text}\n${long}\n::panel\n:::\n`;
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const w = doc.contentWarnings?.find((x) => x.kind === 'comicPanelFrame');
    expect(w).toMatchObject({ reason: 'textOverflow', panel: 0 });
  });
});

describe('text set to the middle or the foot of a slanted cell (#959)', () => {
  const words = 'Words follow the edge of the cell. '.repeat(14);
  const lay = (attrs: string, split = '30~32 / *') => {
    const md = `:::page{split="${split}"}\n::panel{text${attrs}}\n${words}\n::panel\n:::\n`;
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = doc.pages.find((p) => p.comic)!;
    const frame = page.comic!.frames![0]!;
    const paras = (page.floats ?? []).filter((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph');
    return { page, frame, lines: paras.flatMap((b) => b.lines), paras };
  };
  const inPoly = (poly: readonly { x: number; y: number }[], x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  for (const align of ['middle', 'bottom'] as const) {
    it(`follows the slant with valign=${align}: lines of different lengths, inside the outline, lower than from the top`, () => {
      // (A steeper slant for the middle: the straight box then ends well above the cell's foot.)
      const split = align === 'middle' ? '30~45 / *' : undefined;
      const top = lay('', split);
      const set = lay(` valign=${align}`, split);
      expect(set.frame.polygon).toBeDefined();
      expect(set.lines.length).toBeGreaterThan(2);
      for (const l of set.lines) {
        const y = l.bbox.y + l.bbox.height;
        const w = (l.segments ?? []).reduce((n, sg) => n + sg.width, 0);
        expect(inPoly(set.frame.polygon!, l.bbox.x + 0.5, y - 0.5)).toBe(true);
        expect(inPoly(set.frame.polygon!, l.bbox.x + w - 0.5, y - 0.5)).toBe(true);
      }
      const widths = new Set(set.lines.slice(0, -1).map((l) => Math.round((l.segments ?? []).reduce((n, sg) => n + sg.width, 0) / 10)));
      expect(widths.size).toBeGreaterThan(1);
      // Set lower in the cell than from the top.
      const firstY = (r: ReturnType<typeof lay>) => r.paras[0]!.bbox.y;
      expect(firstY(set)).toBeGreaterThan(firstY(top));
      // Not kept to the straight box inside the cell any more (it ends at
      // the slant's highest point): the text is aligned in the whole cell.
      const box = innerBox(set.frame.polygon!, set.page.comic!.panels[0]!.bbox);
      const cell = set.frame.rect;
      const top0 = set.paras[0]!.bbox.y;
      const last = set.paras[set.paras.length - 1]!;
      const bottom0 = last.bbox.y + last.bbox.height;
      if (align === 'middle') expect(Math.abs((top0 + bottom0) / 2 - (cell.y + cell.height / 2))).toBeLessThan(2 * last.lines[0]!.bbox.height + 60);
      else expect(bottom0).toBeGreaterThan(box.y + box.height);
    });
  }

  it('keeps a text that cannot settle inside the cell, in the straight box it had before', () => {
    // A steep slant at the foot leaves no room for text set to the foot.
    const steep = lay(' valign=bottom', '40~60 / *');
    expect(steep.lines.length).toBeGreaterThan(0);
    for (const l of steep.lines) {
      const y = l.bbox.y + l.bbox.height;
      const w = (l.segments ?? []).reduce((n, sg) => n + sg.width, 0);
      expect(inPoly(steep.frame.polygon!, l.bbox.x + 0.5, y - 0.5)).toBe(true);
      expect(inPoly(steep.frame.polygon!, l.bbox.x + w - 0.5, y - 0.5)).toBe(true);
    }
    const box = innerBox(steep.frame.polygon!, steep.page.comic!.panels[0]!.bbox);
    expect(steep.paras[steep.paras.length - 1]!.bbox.y + steep.paras[steep.paras.length - 1]!.bbox.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
  });

  it('sets the middle lines where the slant leaves room for them, not where the top lines were', () => {
    const middle = lay(' valign=middle');
    const bottom = lay(' valign=bottom');
    expect(bottom.paras[0]!.bbox.y).toBeGreaterThan(middle.paras[0]!.bbox.y);
  });
});
