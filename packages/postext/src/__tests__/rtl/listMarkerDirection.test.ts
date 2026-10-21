import { describe, it, expect } from 'vitest';
import { arabicMarkNeeded, buildDocument, markerSetText, renderPageToCanvas, renderToHtml } from '../../index.js';
import type { PostextConfig, VDTBlock, VDTDocument } from '../../index.js';

// #664: the marker of a right-to-left list item reads in its item's
// direction on the canvas, as it does in HTML: `1-` with its hyphen on the
// number's left, between the number and the text. Found on Cookbook Nº 109
// (#660), whose list of gates printed `-1`, the hyphen on the outer side.

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

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Painted { text: string; left: number; right: number; rtl: boolean; font: string }

/** A 2D context that tracks its transform and records each text run
 *  painted: where its box lands on the sheet, and the direction the
 *  context was set to. */
function paint(doc: VDTDocument, pageIndex = 0): Painted[] {
  const painted: Painted[] = [];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const t: Record<string, unknown> = {
    font: '', textAlign: 'left', direction: 'ltr', textBaseline: 'alphabetic', letterSpacing: '0px',
    save() { stack.push(m); },
    restore() { m = stack.pop() ?? m; },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) { m = mul(m, [a, b, c, d, e, f]); },
    translate(x: number, y: number) { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale(x: number, y: number) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    measureText(s: string) { return { width: s.length * 7 }; },
    fillText(text: string, x: number) {
      const w = text.length * 7;
      const a = m[0] * x + m[4];
      const b = m[0] * (x + w) + m[4];
      painted.push({ text, left: Math.min(a, b), right: Math.max(a, b), rtl: t.direction === 'rtl', font: String(t.font) });
    },
  };
  const ctx = new Proxy(t, {
    get(target, key) {
      if (typeof key === 'string' && key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) { target[key as string] = value; return true; },
    deleteProperty(target, key) { delete target[key as string]; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  renderPageToCanvas(doc.pages[pageIndex]!, doc, canvas);
  return painted;
}

const pt = (value: number) => ({ value, unit: 'pt' as const });
const PAGE = { width: pt(400), height: pt(500), dpi: 72, margins: { top: pt(30), bottom: pt(30), left: pt(30), right: pt(30) } };
const base = (extra: PostextConfig): PostextConfig => ({
  page: PAGE, layout: { layoutType: 'single' }, header: { elements: [] }, footer: { elements: [] }, ...extra,
});
const items = (doc: VDTDocument): VDTBlock[] => doc.blocks.filter((b) => b.type === 'listItem');
/** The painted run whose text is `text`. */
const run = (painted: Painted[], text: string): Painted => {
  const found = painted.find((p) => p.text === text);
  if (!found) throw new Error(`no run "${text}" in ${JSON.stringify(painted.map((p) => p.text))}`);
  return found;
};

const LIST = '1. باب بوجلود\n2. باب المحروق';
const hyphen = { orderedLists: { levels: [{ level: 1, numberFormat: 'arabic', separator: '-' }] } } as unknown as PostextConfig;

describe('layout: how a marker reads', () => {
  it('says right to left for the items of a right-to-left list only', () => {
    expect(items(buildDocument({ markdown: LIST }, base({ locale: 'ar-MA', ...hyphen }))).map((b) => [b.bulletText, b.bulletDirection]))
      .toEqual([['1-', 'rtl-arabic'], ['2-', 'rtl-arabic']]);
    expect(items(buildDocument({ markdown: LIST }, base({ locale: 'ar', ...hyphen }))).map((b) => [b.bulletText, b.bulletDirection]))
      .toEqual([['١-', 'rtl-arabic'], ['٢-', 'rtl-arabic']]);
    expect(items(buildDocument({ markdown: LIST }, base({ locale: 'he', ...hyphen })))[0]!.bulletDirection).toBe('rtl');
    expect(items(buildDocument({ markdown: '1. One\n2. Two' }, base({ locale: 'en' })))[0]!.bulletDirection).toBeUndefined();
  });

  it('follows a block set against the document', () => {
    const inArabic = buildDocument({ markdown: ':::paragraphs{dir=ltr}\n1. One\n2. Two\n:::' }, base({ locale: 'ar' }));
    expect(items(inArabic)[0]!.bulletDirection).toBeUndefined();
    const inEnglish = buildDocument({ markdown: ':::paragraphs{dir=rtl}\n1. باب\n2. باب\n:::' }, base({ locale: 'en', ...hyphen }));
    expect(items(inEnglish)[0]!.bulletDirection).toBe('rtl');
  });

  it('a list inside a box says the same', () => {
    const doc = buildDocument({ markdown: `:::callout\n${LIST}\n:::` }, base({ locale: 'ar-MA', ...hyphen }));
    const inBox = items(doc);
    expect(inBox.every((b) => b.containerId !== undefined)).toBe(true);
    expect(inBox.length).toBe(2);
    expect(inBox.map((b) => b.bulletDirection)).toEqual(['rtl-arabic', 'rtl-arabic']);
  });
});

describe('canvas: the marker of a right-to-left item', () => {
  // The marker is one text set right to left (#770): the browser orders
  // its runs and mirrors its brackets, as it does in the HTML's box, and a
  // mark with no letter takes the forms it has in that text. Up to postext
  // 1.29 each run was a text of its own.
  it('is one text set right to left, in the box the layout gave it', () => {
    for (const [locale, one] of [['ar-MA', '1'], ['ar', '١']] as const) {
      const doc = buildDocument({ markdown: LIST }, base({ locale, ...hyphen }));
      const painted = paint(doc);
      const marker = run(painted, `${one}-`);
      expect(marker.rtl, locale).toBe(true);
      expect(painted.some((p) => p.text === '-' || p.text === one), locale).toBe(false);
      // The item's text stands on the left of it.
      const word = run(painted, 'باب');
      expect(word.right).toBeLessThan(marker.left);
      // And the marker keeps its box.
      const item = items(doc)[0]!;
      const W = doc.pages[0]!.width;
      expect(marker.right).toBeCloseTo(W - item.bulletOffsetX!, 6);
      expect(marker.left).toBeCloseTo(W - item.bulletOffsetX! - 14, 6);
    }
  });

  it('a number in brackets is one text too: the browser keeps its digits in order and mirrors the brackets', () => {
    const md = Array.from({ length: 12 }, (_, i) => `${i + 1}. باب`).join('\n');
    const doc = buildDocument({ markdown: md }, base({ locale: 'ar-MA', orderedLists: { levels: [{ level: 1, numberFormat: 'arabic', prefix: '(', separator: ')' }] } } as unknown as PostextConfig));
    expect(items(doc)[11]!.bulletText).toBe('(12)');
    const painted = paint(doc);
    expect(run(painted, '(12)').rtl).toBe(true);
    expect(painted.some((p) => p.text === '12' || p.text === '(' || p.text === ')')).toBe(false);
  });

  it('European digits an Arabic-script document reads as an Arabic number take the Arabic letter mark', () => {
    expect(markerSetText('3-1', 'rtl-arabic')).toBe('\u061C3-1');
    expect(markerSetText('3-1', 'rtl')).toBe('3-1');
    expect(markerSetText('1-', 'rtl-arabic')).toBe('1-');
    expect(arabicMarkNeeded('١-')).toBe(false);
  });

  it('reads a separator and a prefix styled apart from the number the same way', () => {
    const doc = buildDocument({ markdown: LIST }, base({ locale: 'ar', orderedLists: { fontFamily: 'Optima', separatorFontFamily: 'DIN Pro', levels: [{ level: 1, numberFormat: 'arabic', prefix: '(', separator: ')' }] } } as unknown as PostextConfig));
    const item = items(doc)[0]!;
    expect(item.separatorText).toBe(')');
    expect(item.prefixText).toBe('(');
    const painted = paint(doc);
    const number = run(painted, '١');
    const open = painted.find((p) => p.text === '(' && p.left >= number.right - 1e-6)!;
    const close = painted.find((p) => p.text === ')' && p.right <= number.left + 1e-6)!;
    expect(open.rtl).toBe(true);
    expect(close.rtl).toBe(true);
  });

  it('an Arabic list in an English book: the marker set right to left on the text\'s right', () => {
    const doc = buildDocument({ markdown: ':::paragraphs{dir=rtl}\n1. باب\n2. باب\n:::' }, base({ locale: 'en', ...hyphen }));
    const painted = paint(doc);
    const marker = run(painted, '1-');
    expect(marker.rtl).toBe(true);
    const item = items(doc)[0]!;
    expect(marker.left).toBeCloseTo(item.bulletOffsetX!, 6);
    expect(run(painted, 'باب').right).toBeLessThan(marker.left);
  });

  it('paints a left-to-right list as before, in any book', () => {
    const english = paint(buildDocument({ markdown: '1. One\n2. Two' }, base({ locale: 'en', ...hyphen })));
    expect(run(english, '1-').rtl).toBe(false);
    const inArabic = paint(buildDocument({ markdown: ':::paragraphs{dir=ltr}\n1. One\n2. Two\n:::' }, base({ locale: 'ar', ...hyphen })));
    expect(run(inArabic, '١-').rtl).toBe(false);
  });

  it('a contents number of a Maghreb book orders as a Mashriq one (#665)', () => {
    const md = ['# الفهرس {style="front"}', ':::toc', '# أبواب فاس {startAt=3}', 'نص.', '## الأبواب الكبرى', 'نص.'].join('\n\n');
    const config = (locale: string): PostextConfig => base({
      locale,
      headings: { levels: [{ level: 1, numberingTemplate: '{1}', breakBefore: { enabled: false } }, { level: 2, numberingTemplate: '{1}-{2}' }] },
      headingStyles: [{ id: 'front', numbered: false, toc: false }],
      toc: { levels: [{ level: 1, fontSize: pt(10), numberFontSize: pt(10) }, { level: 2, fontSize: pt(10), numberFontSize: pt(10), numberWidth: pt(30) }] },
    } as unknown as PostextConfig);
    for (const [locale, three, one] of [['ar-MA', '3', '1'], ['ar', '٣', '١']] as const) {
      const doc = buildDocument({ markdown: md }, config(locale));
      const entry = doc.blocks.find((b) => b.tocEntry !== undefined && b.bulletText === `${three}-${one}`)!;
      expect(entry, locale).toBeDefined();
      expect(entry.bulletDirection).toBe('rtl-arabic');
      const painted = paint(doc, entry.pageIndex);
      // The chapter on the right of the hyphen, the section on its left.
      const chapter = painted.filter((p) => p.text === three).find((p) => painted.some((q) => q.text === '-' && Math.abs(q.right - p.left) < 1e-6))!;
      expect(chapter, locale).toBeDefined();
      const sep = painted.find((q) => q.text === '-' && Math.abs(q.right - chapter.left) < 1e-6)!;
      expect(painted.some((q) => q.text === one && Math.abs(q.right - sep.left) < 1e-6), locale).toBe(true);
    }
  });
});

describe('HTML: the marker of a right-to-left item', () => {
  it('is set in its item\'s direction, in logical order', () => {
    const doc = buildDocument({ markdown: LIST }, base({ locale: 'ar-MA', ...hyphen }));
    const html = renderToHtml(doc);
    expect(html).toMatch(/<div class="pt-bullet"[^>]*>1-<\/div>/);
    expect(html).not.toContain('&#x61C;');
  });

  it('gives a compound number of an Arabic-script book an Arabic letter mark (#665)', () => {
    const doc = buildDocument({ markdown: LIST }, base({ locale: 'ar-MA', ...hyphen }));
    const item = items(doc)[0]!;
    item.bulletText = '3-1';
    expect(renderToHtml(doc)).toMatch(/<div class="pt-bullet"[^>]*>&#x61C;3-1<\/div>/);
    item.bulletDirection = 'rtl';
    expect(renderToHtml(doc)).toMatch(/<div class="pt-bullet"[^>]*>3-1<\/div>/);
  });
});
