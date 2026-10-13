import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline';
import type { PostextConfig } from '../../types';
import type { VDTBlock } from '../../vdt';

// #770, round 2: the number of a contents entry in a right-to-left
// document. The canvas paints it with its context set right to left and
// the HTML sets it in a box of that direction; the layout measured it left
// to right, where the marks at its ends are runs apart. A document shaped
// in its own language measures it in the direction it is painted in.

const isMark = (ch: string): boolean => ch === '«' || ch === '»';

/**
 * The advance of `text` at 10 px in a face that draws its guillemets by
 * the run they stand in, as Markazi Text does in Arabic: 4.7 px each when
 * the text is measured left to right (a run apart, shaped alone), 4.1 px
 * in the right-to-left run the outputs paint. A space is 2.5 px, any other
 * character 5 px.
 */
function faceWidth(text: string, rtl: boolean): number {
  let px = 0;
  for (const ch of Array.from(text)) px += ch === ' ' ? 2.5 : isMark(ch) ? (rtl ? 4.1 : 4.7) : 5;
  return px;
}
class MeasureContext {
  font = '10px Kitab';
  lang = 'inherit';
  direction = 'ltr';
  measureText(s: string): { width: number } {
    return { width: faceWidth(s, this.direction === 'rtl') };
  }
}
const globals = globalThis as unknown as { OffscreenCanvas: unknown; OffscreenCanvasRenderingContext2D: unknown };
globals.OffscreenCanvasRenderingContext2D = MeasureContext;
globals.OffscreenCanvas = class {
  getContext(): MeasureContext {
    return new MeasureContext();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
function config(template: string, locale: string, shapingLanguage: 'host' | 'document'): PostextConfig {
  return {
    locale,
    page: { dpi: 72, width: pt(360), height: pt(400), margins: { top: pt(18), bottom: pt(18), left: pt(18), right: pt(18) } },
    layout: { layoutType: 'single' },
    bodyText: { shapingLanguage },
    headings: { levels: [{ level: 1, breakBefore: { enabled: false }, numberingTemplate: template }] },
    headingStyles: [{ id: 'front', numbered: false, toc: false }],
    toc: { levels: [{ level: 1, fontSize: pt(10), numberFontSize: pt(10) }] },
  };
}
const chapters = (titles: string[]) => ['# Contents {style="front"}', ':::toc', ...titles.flatMap((t) => [`# ${t}`, 'Text.'])].join('\n\n');
const entries = (blocks: VDTBlock[]) => blocks.filter((b) => b.tocEntry !== undefined && b.bulletText);

const FIRST = '«الفصل الأول»';
const SECOND = '«الفصل الثاني»';
const GAP = 5; // 0.5 em of 10 px

describe('#770: a contents number is measured as it is painted', () => {
  it('right to left, in a document shaped in its own language', () => {
    const doc = buildDocument({ markdown: chapters(['البداية', 'النهاية']) }, config('«الفصل {1:ordinal}»', 'ar', 'document'));
    const rows = entries(doc.blocks);
    expect(rows.map((b) => b.bulletText)).toEqual([FIRST, SECOND]);
    expect(rows.map((b) => b.bulletDirection)).toEqual(['rtl-arabic', 'rtl-arabic']);
    // The column is as wide as the widest number painted: 65.7 px, where
    // the number measured left to right is 66.9 px.
    const widest = faceWidth(SECOND, true);
    expect(widest).toBeCloseTo(65.7, 6);
    expect(faceWidth(SECOND, false)).toBeCloseTo(66.9, 6);
    for (const b of rows) {
      expect(b.lines[0]!.bbox.x - b.bbox.x).toBeCloseTo(widest + GAP, 6);
      // Each number ends on the edge of the column, at its painted width.
      expect(b.bulletOffsetX! + faceWidth(b.bulletText!, true)).toBeCloseTo(b.bbox.x + widest, 6);
    }
  });

  it('left to right in a document shaped in its host’s language, as it was', () => {
    const doc = buildDocument({ markdown: chapters(['البداية', 'النهاية']) }, config('«الفصل {1:ordinal}»', 'ar', 'host'));
    const rows = entries(doc.blocks);
    expect(rows.map((b) => b.bulletText)).toEqual([FIRST, SECOND]);
    const widest = faceWidth(SECOND, false);
    for (const b of rows) {
      expect(b.lines[0]!.bbox.x - b.bbox.x).toBeCloseTo(widest + GAP, 6);
      expect(b.bulletOffsetX! + faceWidth(b.bulletText!, false)).toBeCloseTo(b.bbox.x + widest, 6);
    }
  });

  it('left to right in a left-to-right document, whatever it is shaped in', () => {
    for (const mode of ['host', 'document'] as const) {
      const doc = buildDocument({ markdown: chapters(['One', 'Two']) }, config('«Chapter {1}»', 'en', mode));
      const rows = entries(doc.blocks);
      expect(rows.map((b) => b.bulletText)).toEqual(['«Chapter 1»', '«Chapter 2»']);
      expect(rows.map((b) => b.bulletDirection)).toEqual([undefined, undefined]);
      const widest = faceWidth('«Chapter 1»', false);
      for (const b of rows) expect(b.lines[0]!.bbox.x - b.bbox.x).toBeCloseTo(widest + GAP, 6);
    }
  });
});
