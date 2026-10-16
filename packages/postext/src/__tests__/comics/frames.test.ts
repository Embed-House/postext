/**
 * One page model (#885): a comic page's split generates frames; panels gain
 * a callout style (`box`) and Markdown text (`::panel{text}`).
 */
import { describe, it, expect } from 'vitest';
import { buildDocument, renderPageToCanvas, renderToHtml, collectContentWarnings, parseMarkdown, comicPaintsUnderText, composedFrameBlockIds, comicFramePaintOrder, pageComics } from '../../index';
import type { PostextConfig, Resource } from '../../types';
import type { VDTDocument, VDTPage } from '../../vdt';

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

const pic: Resource = { id: 'pic', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'pic-file', format: 'png', width: 1000, height: 1000 } };

const comicPage = (doc: VDTDocument): VDTPage => doc.pages.find((p) => p.comic)!;
const inside = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

const boxes: PostextConfig = {
  calloutStyles: [
    { id: 'caja', title: '', backgroundEnabled: true, background: { hex: '#fdf0c0', model: 'hex' }, border: { enabled: true, color: { hex: '#aa3300', model: 'hex' }, width: { value: 1, unit: 'mm' } }, borderRadius: { value: 2, unit: 'mm' }, padding: { top: { value: 3, unit: 'mm' }, right: { value: 3, unit: 'mm' }, bottom: { value: 3, unit: 'mm' }, left: { value: 3, unit: 'mm' } } },
  ],
} as unknown as PostextConfig;

describe('frames a split generates', () => {
  it('makes one frame per panel, insets one layer up, with ids from the fence and the panel', () => {
    const md = 'Intro.\n\n:::page{split="50 / [50 | *]"}\n::panel{art=pic #opening}\nana: Hi.\n::panel{inset="10% 10% 30% 30%"}\n::panel\nben: Oh.\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [pic] }, {});
    const comic = comicPage(doc).comic!;
    expect(comic.id).toBe('cm0');
    expect(comic.frames!.map((f) => [f.id, f.name, f.layer, f.panel])).toEqual([
      ['cm0:opening', 'opening', 1, 0],
      ['cm0:p2', 'p2', 2, 1],
      ['cm0:p3', 'p3', 1, 2],
      ['cm0:p4', 'p4', 1, 3],
    ]);
    comic.panels.forEach((p, i) => {
      expect(p.frameId).toBe(comic.frames![i]!.id);
      expect(comic.frames![i]!.rect).toEqual(p.bbox);
      expect(comic.frames![i]!.configPath).toBe('');
    });
    // The inset's frame lies over the frame before it.
    expect(inside(comic.frames![1]!.rect, comic.frames![0]!.rect)).toBe(true);
    // Balloons are named after their panel's frame and their script line.
    expect(comic.balloons.map((b) => b.elementId)).toEqual(['cm0:opening:b0', 'cm0:p3:b0']);
  });

  it('gives a slanted cell its outline, and a second comic of the chapter the next ordinal', () => {
    const md = ':::page{split="50~60 / *"}\n::panel\n::panel\n:::\n\n:::page\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const [a, b] = doc.pages.filter((p) => p.comic).map((p) => p.comic!);
    expect(a!.frames![0]!.polygon).toBeDefined();
    expect(a!.frames![0]!.polygon).toEqual(a!.panels[0]!.polygon);
    expect(b!.id).toBe('cm1');
    expect(b!.frames![0]!.polygon).toBeUndefined();
  });

  it('moves the frames of a strip with it onto the sheet', () => {
    const md = 'Text.\n\n:::strip{split="* | *"}\n::panel\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = doc.pages.find((p) => p.columns.some((c) => c.blocks.some((b) => b.comic)))!;
    const comic = pageComics(page)[0]!;
    expect(comic.id).toBe('cm0');
    comic.panels.forEach((p, i) => expect(comic.frames![i]!.rect).toEqual(p.bbox));
  });

  it('cuts the frames of a spread with its panels', () => {
    const md = ':::page{spread split="* | *"}\n::panel\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const halves = doc.pages.filter((p) => p.comic).map((p) => p.comic!);
    expect(halves).toHaveLength(2);
    for (const half of halves) {
      expect(half.frames!.map((f) => f.panel)).toEqual(half.panels.map((p) => p.index));
      half.panels.forEach((p, i) => expect(half.frames![i]!.rect).toEqual(p.bbox));
    }
  });
});

describe('panel box styles', () => {
  it('dresses a panel in the callout style its box names', () => {
    const md = ':::page{split="50 / *"}\n::panel{box=caja}\n::panel{box=caja border=none bg="#000000"}\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, boxes);
    const [p1, p2] = comicPage(doc).comic!.panels;
    expect(p1!.background).toBe('#fdf0c0');
    expect(p1!.border).toEqual({ width: expect.closeTo(1 / 25.4 * doc.config.page.dpi, 3), color: '#aa3300', style: 'solid' });
    expect(p1!.radius).toBeGreaterThan(0);
    // The panel's own attributes win.
    expect(p2!.border.style).toBe('none');
    expect(p2!.background).toBe('#000000');
    expect(comicPage(doc).comic!.frames![0]!.styleId).toBe('caja');
  });

  it('warns about a box no callout style defines', () => {
    const md = ':::page\n::panel{box=nope}\n:::\n';
    const w = collectContentWarnings(md, boxes).filter((x) => x.kind === 'comicPanelFrame');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ reason: 'unknownBox', panel: 0, style: 'nope' });
    expect(md.slice(w[0]!.sourceStart!, w[0]!.sourceEnd!)).toBe('nope');
  });
});

describe('text panels', () => {
  const md = '# Chapter\n\n:::page{split="40 / *"}\n::panel{text}\nThe first *paragraph* of the panel.\n\nA second paragraph.\n::panel\nana: Hello!\n:::\n\nAfter the comic.\n';

  it('reads the body as Markdown, not as a script', () => {
    const blocks = parseMarkdown(md);
    const comic = blocks.find((b) => b.comic)!.comic!;
    expect(comic.panels[0]!.items).toEqual([]);
    expect(md.slice(comic.panels[0]!.text!.start, comic.panels[0]!.text!.end)).toBe('The first *paragraph* of the panel.\n\nA second paragraph.');
    expect(comic.panels[1]!.items).toHaveLength(1);
    const paras = blocks.filter((b) => b.type === 'paragraph').map((b) => b.text);
    expect(paras).toEqual(['The first paragraph of the panel.', 'A second paragraph.', 'After the comic.']);
  });

  it('pours the body into the panel frame, as floats of the comic page', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = comicPage(doc);
    const frame = page.comic!.frames![0]!;
    expect(frame.blockIds).toEqual(['cm0:p1', 'cm0:p1-c0', 'cm0:p1-c1']);
    const floats = page.floats ?? [];
    expect(floats.map((b) => b.id)).toEqual(frame.blockIds);
    for (const b of floats) {
      expect(inside(b.bbox, page.comic!.panels[0]!.bbox)).toBe(true);
      expect(doc.blocks.includes(b)).toBe(true);
    }
    expect(floats[1]!.lines.map((l) => l.text).join(' ')).toContain('The first paragraph');
    // The paragraphs are set once: the text after the comic opens the next page.
    const after = doc.pages.filter((p) => p !== page).flatMap((p) => p.columns.flatMap((c) => c.blocks)).filter((b) => b.type === 'paragraph');
    expect(after.map((b) => b.lines.map((l) => l.text).join(' '))).toEqual(['After the comic.']);
    expect(comicPaintsUnderText(page)).toBe(true);
    expect([...composedFrameBlockIds(page)]).toEqual(frame.blockIds);
    expect(comicFramePaintOrder(page).map((i) => (i.kind === 'frame' ? i.frame.id : ''))).toEqual(['cm0:p1']);
  });

  it('paints the text over its panel and under the lettering', () => {
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = comicPage(doc);
    const calls: string[] = [];
    const ctx: Record<string | symbol, unknown> = new Proxy({}, {
      get(target: Record<string | symbol, unknown>, key) {
        if (key === 'fillText') return (t: string) => calls.push(`text:${t}`);
        if (key === 'fillRect') return () => calls.push('fillRect');
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
    const text = calls.findIndex((c) => c.startsWith('text:') && c.includes('first'));
    const hello = calls.findIndex((c) => c.startsWith('text:') && c.includes('Hello'));
    expect(text).toBeGreaterThan(-1);
    expect(hello).toBeGreaterThan(text);
    // The HTML writes the frame after its panel's figure, before the next one.
    const html = renderToHtml(doc);
    const fig = html.indexOf('data-panel="0"');
    const frameAt = html.indexOf('data-frame-id="cm0:p1"');
    const next = html.indexOf('data-panel="1"');
    expect(fig).toBeGreaterThan(-1);
    expect(frameAt).toBeGreaterThan(fig);
    expect(next).toBeGreaterThan(frameAt);
  });

  it('lays a text panel with a box style in that style, the panel drawing none', () => {
    const boxed = md.replace('::panel{text}', '::panel{text box=caja valign=middle}');
    const doc = buildDocument({ markdown: boxed, resources: [] }, boxes);
    const page = comicPage(doc);
    const box = page.floats![0]!;
    expect(box.callout?.styleId).toBe('caja');
    expect(page.comic!.panels[0]!.border.style).toBe('none');
    expect(page.comic!.panels[0]!.background).toBeUndefined();
    expect(page.comic!.frames![0]!.styleId).toBe('caja');
  });

  it('clips what does not fit and says so', () => {
    const long = Array.from({ length: 120 }, (_, i) => `Line ${i} of a text far too long for its panel.`).join('\n\n');
    const doc = buildDocument({ markdown: `:::page{split="10 / *"}\n::panel{text}\n${long}\n::panel\n:::\n`, resources: [] }, {});
    const page = comicPage(doc);
    expect(page.comic!.frames![0]!.overflowPx).toBeGreaterThan(0);
    const w = doc.contentWarnings?.find((x) => x.kind === 'comicPanelFrame');
    expect(w).toMatchObject({ reason: 'textOverflow', panel: 0, pageIndex: page.index });
  });

  it('sets the text in the flow after a strip, a spread or a right-to-left comic', () => {
    const strip = 'Before.\n\n:::strip{split="* | *"}\n::panel{text}\nStrip words.\n::panel\n:::\n';
    const sdoc = buildDocument({ markdown: strip, resources: [] }, {});
    expect(sdoc.blocks.some((b) => b.lines.some((l) => l.text.includes('Strip words.')))).toBe(true);
    expect(collectContentWarnings(strip, {}).find((x) => x.kind === 'comicPanelFrame')).toMatchObject({ reason: 'strip' });
    const spread = ':::page{spread split="* | *"}\n::panel{text}\nSpread words.\n::panel\n:::\n';
    expect(collectContentWarnings(spread, {}).find((x) => x.kind === 'comicPanelFrame')).toMatchObject({ reason: 'spread' });
    const rtl = { direction: 'rtl', locale: 'ar' } as unknown as PostextConfig;
    const single = ':::page{split="50 / *"}\n::panel{text}\nكلمات.\n::panel\n:::\n';
    const rdoc = buildDocument({ markdown: single, resources: [] }, rtl);
    expect(comicPage(rdoc).comic!.frames![0]!.blockIds).toEqual([]);
    expect(rdoc.blocks.some((b) => b.lines.some((l) => l.text.includes('كلمات')))).toBe(true);
    expect(collectContentWarnings(single, rtl).find((x) => x.kind === 'comicPanelFrame')).toMatchObject({ reason: 'flow' });
  });
});
