import { describe, expect, it } from 'vitest';
import { buildDocument, type PageTemplate, type PostextConfig, type VDTDocument, type VDTFrame, type VDTPage } from 'postext';
import { dimensionToMm, mmToPx, pageAreas, spreadFlowSide, spreadGutterBand, spreadPageAreas } from './frameGeometry.js';

// The template editor draws a spread page's sheet and its spine in the
// page's flow frame (#961): the facing page and the gutter band are on the
// side the engine laid them, whichever way the flow runs. The expected
// values come from frames the engine laid on real spreads.

(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return { font: '', measureText: (s: string) => ({ width: s.length * 7 }) };
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const PAGE = {
  page: { width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } },
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: false } }] },
} as unknown as PostextConfig;

const GUTTER = 10;
/** Across the sheet along the pages (columns), then along the flow (rows). */
const ACROSS: PageTemplate = {
  id: 'sheet',
  spread: true,
  gutter: mm(GUTTER),
  area: 'content',
  grid: { columns: 4, rows: 3, columnGap: mm(6) },
  frames: [
    { name: 'band', crossGutter: true, grid: { col: 1, row: 1, cols: 4 } },
    { name: 'whole', grid: { col: 1, row: 2, cols: 4 } },
    { name: 'second', grid: { col: 3, row: 3, cols: 2 } },
  ],
};
const DOWN: PageTemplate = {
  id: 'sheet',
  spread: true,
  gutter: mm(GUTTER),
  area: 'content',
  grid: { columns: 1, rows: 6, rowGap: mm(8) },
  frames: [
    { name: 'band', crossGutter: true, grid: { col: 1, row: 1, rows: 6 } },
    { name: 'whole', grid: { col: 1, row: 1, rows: 6 } },
    { name: 'second', grid: { col: 1, row: 4, rows: 3 } },
  ],
};
const MD = [
  '::::page{template="sheet" spread}',
  ':::frame{slot="band"}', 'A band across the spine.', ':::', '',
  ':::frame{slot="whole"}', 'A frame that keeps off it.', ':::', '',
  ':::frame{slot="second"}', 'Words on the second page.', ':::',
  '::::',
].join('\n');

function spreadOf(template: PageTemplate, extra: Record<string, unknown>): { doc: VDTDocument; pages: VDTPage[] } {
  const doc = buildDocument({ markdown: MD }, { ...PAGE, ...extra, pageTemplates: [template] } as PostextConfig);
  return { doc, pages: doc.pages.filter((p) => p.composed?.spread) };
}

const frame = (page: VDTPage, name: string): VDTFrame => page.composed!.frames.find((f) => f.name === name)!;
const frameOrUndefined = (page: VDTPage, name: string): VDTFrame | undefined => page.composed!.frames.find((f) => f.name === name);

/** What the editor computes for a page, as `frameEditor.ts` does. */
function editorGeometry(doc: VDTDocument, page: VDTPage) {
  const c = page.composed!;
  const vertical = page.flow?.writingMode === 'vertical-rl';
  const axis = vertical ? 'y' : 'x';
  const sized = vertical ? { width: page.height, height: page.width, contentArea: page.contentArea } : { width: page.width, height: page.height, contentArea: page.contentArea };
  const side = spreadFlowSide(c.spread === 'right' ? 'right' : 'left', !!page.flow);
  const areas = spreadPageAreas(sized, doc.pages[c.facingPage!]!, doc.trimOffset, side, axis);
  const gutterPx = mmToPx(dimensionToMm(mm(GUTTER)), doc.config.page.dpi) / 2;
  const band = spreadGutterBand({ width: sized.width, height: sized.height }, doc.trimOffset, side, gutterPx, 0, axis);
  return { side, axis, areas, band, gutterPx, sized };
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 1);

describe('the sheet of a spread page in its flow frame (#961)', () => {
  const books: [string, Record<string, unknown>, PageTemplate][] = [
    ['left to right', {}, ACROSS],
    ['left to right, bound on the right', { page: { ...(PAGE.page as object), binding: 'right' } }, ACROSS],
    ['right to left', { direction: 'rtl' }, ACROSS],
    ['vertical, bound on the right', { locale: 'ja', layout: { layoutType: 'single', writingMode: 'vertical-rl' }, page: { ...(PAGE.page as object), binding: 'right' } }, DOWN],
  ];

  for (const [name, extra, template] of books) {
    it(`${name}: the areas span the sheet the engine laid, from the first page to the second`, () => {
      const { doc, pages } = spreadOf(template, extra);
      expect(pages).toHaveLength(2);
      for (const page of pages) {
        const { areas, axis } = editorGeometry(doc, page);
        // The band crosses the whole `content` area of the sheet: the engine's
        // rect on this page is the editor's area, on this page's own frame.
        const band = frame(page, 'band').rect;
        if (axis === 'x') {
          near(band.x, areas.content.x);
          near(band.x + band.width, areas.content.x + areas.content.width);
        } else {
          near(band.y, areas.content.y);
          near(band.y + band.height, areas.content.y + areas.content.height);
        }
      }
    });

    it(`${name}: the gutter band is on the inner edge, where the engine keeps a frame off the spine`, () => {
      const { doc, pages } = spreadOf(template, extra);
      for (const page of pages) {
        const { band, side, axis, gutterPx, sized } = editorGeometry(doc, page);
        // The band lies within the page it is drawn on.
        expect(band.x).toBeGreaterThanOrEqual(-0.01);
        expect(band.y).toBeGreaterThanOrEqual(-0.01);
        expect(band.x + band.width).toBeLessThanOrEqual(sized.width + 0.01);
        expect(band.y + band.height).toBeLessThanOrEqual(sized.height + 0.01);
        if (side === 0) {
          // The first page's frame is cut at the band's start.
          const whole = frame(page, 'whole').rect;
          expect(frameOrUndefined(page, 'second')).toBeUndefined();
          if (axis === 'x') near(whole.x + whole.width, band.x);
          else near(whole.y + whole.height, band.y);
        } else {
          // The second page's frame starts where the band ends.
          const second = frame(page, 'second').rect;
          expect(frameOrUndefined(page, 'whole')).toBeUndefined();
          if (axis === 'x') near(second.x, band.x + band.width);
          else near(second.y, band.y + band.height);
        }
        near(axis === 'x' ? band.width : band.height, gutterPx);
      }
    });
  }

  it('the first page along the flow is the left page on a left-to-right book and the right one otherwise', () => {
    for (const [extra, template, firstIs] of [[{}, ACROSS, 'left'], [{ direction: 'rtl' }, ACROSS, 'right'], [{ locale: 'ja', layout: { layoutType: 'single', writingMode: 'vertical-rl' }, page: { ...(PAGE.page as object), binding: 'right' } }, DOWN, 'right']] as const) {
      const { pages } = spreadOf(template, extra);
      const first = pages.find((p) => spreadFlowSide(p.composed!.spread === 'right' ? 'right' : 'left', !!p.flow) === 0)!;
      expect(first.composed!.spread).toBe(firstIs);
      expect(pages.filter((p) => p !== first)).toHaveLength(1);
    }
  });

  it('a page that is not a spread keeps its own areas', () => {
    expect(spreadFlowSide('left', false)).toBe(0);
    expect(spreadFlowSide('right', false)).toBe(1);
    expect(spreadFlowSide('right', true)).toBe(0);
    expect(spreadFlowSide('left', true)).toBe(1);
    const own = { width: 200, height: 300, contentArea: { x: 20, y: 20, width: 160, height: 260 } };
    expect(pageAreas(own, 10).trim).toEqual({ x: 10, y: 10, width: 180, height: 280 });
  });
});
