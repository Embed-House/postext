/**
 * One page model (#885): a comic page's split generates frames; panels gain
 * a callout style (`box`) and Markdown text (`::panel{text}`).
 */
import { describe, it, expect } from 'vitest';
import { buildDocument, renderPageToCanvas, renderToHtml, collectContentWarnings, parseMarkdown, comicPaintsUnderText, composedFrameBlockIds, comicFramePaintOrder, pageComics, sourceAt, elementsForSource, findElement, flowRectToPage, flowToPage, pageRectToFlow } from '../../index.js';
import type { PostextConfig, Resource } from '../../types.js';
import { shrinkScale } from '../../comics/textPanels.js';
import type { VDTDocument, VDTPage } from '../../vdt.js';

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

  it('keeps the text of a slanted panel inside its outline', () => {
    const slanted = md.replace('split="40 / *"', 'split="30~60 / *"').replace('::panel{text}', '::panel{text valign=bottom}');
    const doc = buildDocument({ markdown: slanted, resources: [] }, {});
    const page = comicPage(doc);
    const poly = page.comic!.panels[0]!.polygon;
    const inPoly = (x: number, y: number): boolean => {
      // Convex, clockwise on the sheet: every edge has the point on its right.
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < -0.5) return false;
      }
      return true;
    };
    for (const b of page.floats!.filter((x) => x.type === 'paragraph')) {
      for (const l of b.lines) {
        // The span the line is set in: its narrowed measure beside the
        // slant (#909), else its box.
        const span = l.measure ?? { x: l.bbox.x, width: l.bbox.width };
        expect(inPoly(span.x, l.bbox.y + l.bbox.height)).toBe(true);
        expect(inPoly(span.x + span.width, l.bbox.y + l.bbox.height)).toBe(true);
      }
    }
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

  for (const [name, config] of [
    ['right-to-left', { direction: 'rtl', locale: 'ar' }],
    ['vertical', { locale: 'ja', layout: { writingMode: 'vertical-rl', layoutType: 'single' } }],
  ] as const) {
    it(`sets a ${name} book's text panel in its frame, in the page's flow frame (#909)`, () => {
      const single = ':::page{split="50 / *"}\n::panel{text}\nكلمات 言葉 words.\n::panel\n:::\n';
      const doc = buildDocument({ markdown: single, resources: [] }, config as unknown as PostextConfig);
      const page = comicPage(doc);
      expect(page.flow).toBeDefined();
      const frame = page.comic!.frames![0]!;
      expect(frame.blockIds.length).toBeGreaterThan(0);
      expect(collectContentWarnings(single, config as unknown as PostextConfig).some((x) => x.kind === 'comicPanelFrame')).toBe(false);
      // Its paragraph, in the flow frame, lies inside the panel as the sheet shows it.
      const para = page.floats!.find((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph')!;
      const onSheet = flowRectToPage(page, para.bbox);
      const panel = page.comic!.panels[0]!.bbox;
      expect(onSheet.x).toBeGreaterThanOrEqual(panel.x - 0.5);
      expect(onSheet.x + onSheet.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      expect(onSheet.y).toBeGreaterThanOrEqual(panel.y - 0.5);
      expect(onSheet.y + onSheet.height).toBeLessThanOrEqual(panel.y + panel.height + 0.5);
      // The text is not set again in the flow after the comic.
      expect(doc.blocks.filter((b) => b.lines.some((l) => l.text.includes('words'))).length).toBe(1);
      // A click on its words, on the sheet, finds them, then the frame and the comic.
      const line = para.lines[0]!;
      const at = flowToPage(page, line.bbox.x + 4, line.bbox.y + line.bbox.height / 2);
      const chain = sourceAt(doc, page.index, at.x, at.y);
      expect(chain[0]!.level).toBe('text');
      expect(chain.slice(-2).map((e) => e.id)).toEqual(['cm0:p1', 'cm0']);
      // The backends paint it in the flow frame: the frame given there.
      const painted = comicFramePaintOrder(page)[0]!;
      expect(painted.kind === 'frame' && painted.frame.rect).toEqual(pageRectToFlow(page, frame.rect));
      // The HTML writes it over its panel in a box that turns or mirrors it as the flow is.
      const html = renderToHtml(doc);
      const i = html.indexOf('data-frame-id="cm0:p1"');
      expect(html.lastIndexOf('class="pt-flow', i)).toBeGreaterThan(html.lastIndexOf('class="pt-comic', i));
    });
  }
});

describe('text panels that shrink, and lines that follow a slant (#909)', () => {
  const long = 'Words of the narrator. '.repeat(200);
  const page = (attrs: string, split = '30 / *') =>
    comicPage(buildDocument({ markdown: `:::page{split="${split}"}\n::panel{text${attrs}}\n${long}\n::panel\n:::\n`, resources: [] }, {}));

  it('without shrink the text stops at 90 % and overflows; with it, it is set smaller until it fits', () => {
    const plain = page('').comic!.frames![0]!;
    expect(plain.scale).toBeCloseTo(0.9, 6);
    expect(plain.overflowPx).toBeGreaterThan(0);
    const shrunk = page(' shrink').comic!.frames![0]!;
    expect(shrunk.scale).toBeLessThan(0.9);
    expect(shrunk.scale).toBeGreaterThanOrEqual(0.5);
    expect(shrunk.overflowPx).toBe(0);
    // A floor of its own: never under it.
    const floor = page(' shrink=0.8').comic!.frames![0]!;
    expect(floor.scale).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });

  it('reads the shrink attribute', () => {
    expect(shrinkScale(undefined)).toBeUndefined();
    expect(shrinkScale('')).toBe(0.5);
    expect(shrinkScale('70%')).toBe(0.7);
    expect(shrinkScale('0.1')).toBe(0.25);
    expect(shrinkScale('false')).toBeUndefined();
  });

  it('sets the lines of a slanted cell short where the slant crosses them, inside its outline', () => {
    const md = ':::page{split="40~60 / *"}\n::panel{text}\n' + 'Words follow the edge of the cell. '.repeat(14) + '\n::panel\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const p = comicPage(doc);
    const frame = p.comic!.frames![0]!;
    expect(frame.polygon).toBeDefined();
    const lines = p.floats!.filter((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph').flatMap((b) => b.lines);
    expect(lines.length).toBeGreaterThan(2);
    // Every line's ends lie inside the cell's outline (its slanted foot).
    const inPoly = (x: number, y: number) => {
      const poly = frame.polygon!;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    for (const l of lines) {
      const y = l.bbox.y + l.bbox.height;
      const segs = l.segments ?? [];
      const w = segs.reduce((n, sg) => n + sg.width, 0);
      expect(inPoly(l.bbox.x + 0.5, y - 0.5)).toBe(true);
      expect(inPoly(l.bbox.x + w - 0.5, y - 0.5)).toBe(true);
    }
    // The lines are not all one length: the slant shortens some.
    const widths = new Set(lines.slice(0, -1).map((l) => Math.round((l.segments ?? []).reduce((n, sg) => n + sg.width, 0) / 10)));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('source map of comics', () => {
  const md = ':::page{split="40 / *"}\n::panel{text}\nWords of the panel.\n::panel{art=pic}\nana: Hello there!\n:::\n';

  it('answers a balloon, a panel and a text panel with stable ids', () => {
    const doc = buildDocument({ markdown: md, resources: [pic] }, {});
    const page = comicPage(doc);
    const comic = page.comic!;
    const b = comic.balloons[0]!;
    const atBalloon = sourceAt(doc, page.index, b.bbox.x + b.bbox.width / 2, b.bbox.y + b.bbox.height / 2);
    const levels = atBalloon.map((e) => [e.level, e.id]);
    expect(levels.slice(-3)).toEqual([['box', 'cm0:p2:b0'], ['frame', 'cm0:p2'], ['template', 'cm0']]);
    expect(md.slice(atBalloon.at(-3)!.source.kind === 'markdown' ? (atBalloon.at(-3)!.source as { start: number }).start : 0)).toMatch(/^ana: Hello there!/);
    // Off the balloon, on the picture: the art, the frame, the comic.
    const panel = comic.panels[1]!;
    const atArt = sourceAt(doc, page.index, panel.bbox.x + 4, panel.bbox.y + panel.bbox.height - 4);
    expect(atArt.map((e) => e.level)).toEqual(['resource', 'frame', 'template']);
    expect(atArt[0]!.source).toEqual({ kind: 'resource', resourceId: 'pic' });
    // On a text panel's words: the text, its line and paragraph, the story box, the frame, the comic.
    const para = page.floats!.find((x) => x.type === 'paragraph')!;
    const line = para.lines[0]!;
    const atText = sourceAt(doc, page.index, line.bbox.x + 10, line.bbox.y + line.bbox.height / 2);
    expect(atText.map((e) => e.level)).toEqual(['text', 'line', 'block', 'box', 'frame', 'template']);
    expect(atText.slice(-2).map((e) => e.id)).toEqual(['cm0:p1', 'cm0']);
  });

  it('finds the comic, its frames and balloons by id and by source', () => {
    const doc = buildDocument({ markdown: md, resources: [pic] }, {});
    const page = comicPage(doc);
    expect(findElement(doc, 'cm0')).toMatchObject({ pageIndex: page.index, element: { level: 'template' } });
    expect(findElement(doc, 'cm0:p2')).toMatchObject({ pageIndex: page.index, element: { level: 'frame' } });
    expect(findElement(doc, 'cm0:p2:b0')).toMatchObject({ element: { level: 'box' } });
    const at = md.indexOf('Hello');
    const found = elementsForSource(doc, at, at + 1).map((m) => m.element.id);
    expect(found).toEqual(expect.arrayContaining(['cm0', 'cm0:p2', 'cm0:p2:b0']));
  });
});
