import { describe, it, expect } from 'vitest';
import { renderPageToCanvas } from '../canvas-backend';
import { renderBlock } from '../canvas-backend/blockRender';
import { beginMirroredFlow } from '../canvas-backend/mirrorFrame';
import { fillTrackedWord, trackedPieces, shapedOtherwise } from '../canvas-backend/trackedText';
import { renderToHtml } from '../html-backend';
import { buildDocument } from '../pipeline';
import type { PostextConfig, Resource } from '../types';
import type { VDTBlock, VDTDocument, VDTLine } from '../vdt';

// #663: a tracked word is measured at its natural width, ligatures counted,
// plus the tracking times its letters. A browser shapes it without its
// common ligatures once `letterSpacing` is not zero, so the canvas painted
// "first" wider than its place and the word space after it closed up
// ("firstis"). The word is painted in pieces instead, its ligature whole;
// the HTML asks for the ligatures as features.

// A face with ff, fi, fl and ffi ligatures narrower than their letters, as a
// browser measures it: under a letter-spacing the ligatures are off and the
// spacing follows every letter.
const ADVANCE = (ch: string): number => {
  if (ch === ' ') return 0.25;
  if ('ilf.,'.includes(ch)) return 0.3;
  if (/[A-Z]/.test(ch)) return 0.66;
  return 0.5;
};
// An Arabic and a Hebrew word, and the ligature each holds in this face
// (lam + alef, alef + lamed), which the letter-spacing turns off as well.
const SALAM = '\u0633\u0644\u0627\u0645';
const ISRAEL = '\u05D9\u05E9\u05E8\u05D0\u05DC';
/** A Hebrew word with no ligature. */
const SHALOM = '\u05E9\u05DC\u05D5\u05DD';
const LIGATURES: [string, number][] = [['ffi', 0.75], ['ff', 0.5], ['fi', 0.5], ['fl', 0.5], ['\u0644\u0627', 0.5], ['\u05D0\u05DC', 0.5]];
function naturalWidth(text: string, size: number, ligatures: boolean): number {
  let w = 0;
  for (let i = 0; i < text.length;) {
    const lig = ligatures ? LIGATURES.find(([l]) => text.startsWith(l, i)) : undefined;
    if (lig) {
      w += lig[1] * size;
      i += lig[0].length;
    } else {
      w += ADVANCE(text[i]!) * size;
      i++;
    }
  }
  return w;
}
const sizeOf = (font: string): number => parseFloat(/(\d*\.?\d+)px/.exec(font)?.[1] ?? '10');

/** The measuring half of a browser's 2D context. `keeps`: a browser that
 *  keeps the ligatures under a letter-spacing, so no word is cut. */
class BrowserCtx {
  font = '10px Body';
  letterSpacing = '0px';
  measured = 0;
  constructor(readonly keeps = false) {}
  measureText(s: string): { width: number } {
    this.measured++;
    const spacing = parseFloat(this.letterSpacing) || 0;
    return { width: naturalWidth(s, sizeOf(this.font), this.keeps || spacing === 0) + spacing * s.length };
  }
}
/** A painting context: every `fillText` with the letter-spacing it had. */
type Painted = { text: string; x: number; y: number; spacing: number; width: number };
function paintingCtx(): { ctx: CanvasRenderingContext2D; seen: Painted[] } {
  const seen: Painted[] = [];
  const ctx = Object.assign(new BrowserCtx(), {
    fillStyle: '', textBaseline: 'alphabetic',
    fillText(this: BrowserCtx, text: string, x: number, y: number) {
      seen.push({ text, x, y, spacing: parseFloat(this.letterSpacing) || 0, width: this.measureText(text).width });
    },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, moveTo() {}, lineTo() {}, stroke() {},
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, seen };
}

// The layout measures through an OffscreenCanvas at letter-spacing 0.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): BrowserCtx {
    return new BrowserCtx();
  }
};

describe('the pieces of a tracked word (#663)', () => {
  it('a word with no ligature is painted whole', () => {
    const { ctx } = paintingCtx();
    expect(shapedOtherwise(ctx, 'hands')).toBe(false);
    expect(trackedPieces(ctx, 'hands')).toBeNull();
  });

  it('a ligature is a piece of its own, set where the natural shaping puts it', () => {
    const { ctx } = paintingCtx();
    expect(shapedOtherwise(ctx, 'first')).toBe(true);
    expect(trackedPieces(ctx, 'first')).toEqual([
      { text: 'fi', offset: 0, glyphsBefore: 0, ligature: true },
      { text: 'rst', offset: 5, glyphsBefore: 1, ligature: false },
    ]);
    // o | ffi | ces: the three letters of one ligature stay together.
    expect(trackedPieces(ctx, 'offices')!.map((p) => [p.text, p.offset, p.glyphsBefore, p.ligature])).toEqual([
      ['o', 0, 0, false],
      ['ffi', 5, 1, true],
      ['ces', 12.5, 2, false],
    ]);
  });

  it('leaves the letter-spacing as it found it and measures a word once', () => {
    const { ctx } = paintingCtx();
    ctx.letterSpacing = '-0.2px';
    trackedPieces(ctx, 'reflect');
    expect(ctx.letterSpacing).toBe('-0.2px');
    const before = (ctx as unknown as BrowserCtx).measured;
    trackedPieces(ctx, 'reflect');
    shapedOtherwise(ctx, 'reflect');
    expect((ctx as unknown as BrowserCtx).measured).toBe(before);
  });

  it('a context that measures no letter-spacing paints every word whole', () => {
    const stub = { font: '10px Stub', letterSpacing: '0px', measureText: (s: string) => ({ width: s.length * 5 }) };
    expect(trackedPieces(stub as unknown as CanvasRenderingContext2D, 'first')).toBeNull();
    expect(shapedOtherwise(stub as unknown as CanvasRenderingContext2D, 'first')).toBe(false);
    expect(trackedPieces({ font: '10px Other' } as unknown as CanvasRenderingContext2D, 'first')).toBeNull();
  });
});

const pt = (value: number) => ({ value, unit: 'pt' as const });
// 72 dpi: 1 pt = 1 px.
const CONFIG: PostextConfig = {
  page: { width: pt(160), height: pt(900), dpi: 72, margins: { top: pt(10), bottom: pt(10), left: pt(10), right: pt(10) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14), firstLineIndent: pt(0), hyphenation: { enabled: false } },
};
// Four lines set naturally, the last a runt; three with 10‰ of negative
// tracking (`tightenRunts`). Justified, the second line holds no ligature;
// ragged, the third.
const JUSTIFIED = 'fire stood the offices first is office within lets stood lets left stood is offices is office first a fire.';
const RAGGED = 'is of office stood stood find osmosis first of osmosis lets fire its lets within is within and lets.';

const paragraph = (doc: VDTDocument): VDTBlock => doc.blocks.find((b) => b.type === 'paragraph')!;
const tracked = (text: string, config: PostextConfig = CONFIG): { doc: VDTDocument; block: VDTBlock } => {
  const doc = buildDocument({ markdown: text }, config);
  return { doc, block: paragraph(doc) };
};
const LEFT: PostextConfig = { ...CONFIG, bodyText: { ...CONFIG.bodyText, textAlign: 'left' } };
/** Where the ink of each word of `line` ends against where its segment
 *  does, from the pieces the canvas painted inside it. */
function wordEnds(block: VDTBlock, line: VDTLine, seen: Painted[]): { text: string; ink: number; place: number }[] {
  const segments = line.segments!;
  const justified = block.textAlign === 'justify' && !line.isLastLine;
  const wordWidth = segments.reduce((w, s) => (s.kind === 'space' ? w : w + s.width), 0);
  const spaces = segments.filter((s) => s.kind === 'space').length;
  const out: { text: string; ink: number; place: number }[] = [];
  let x = line.bbox.x;
  for (const seg of segments) {
    if (seg.kind === 'space') {
      x += justified ? (block.bbox.width - wordWidth) / spaces : seg.width;
      continue;
    }
    const pieces = seen.filter((p) => p.y === line.baseline && (Math.abs(p.x - x) < 1e-6 || (p.x > x && p.x < x + seg.width - 1e-6)));
    expect(pieces.map((p) => p.text).join('')).toBe(seg.text);
    out.push({ text: seg.text, ink: Math.max(...pieces.map((p) => p.x + p.width)), place: x + seg.width });
    x += seg.width;
  }
  return out;
}

describe('a tracked paragraph on canvas (#663)', () => {
  it('the paragraphs are tightened and hold ligatures', () => {
    for (const block of [tracked(JUSTIFIED).block, tracked(RAGGED, LEFT).block]) {
      expect(block.lines).toHaveLength(3);
      expect(block.letterSpacing).toBeCloseTo(-0.1, 5);
      expect(block.lines.filter((l) => /fi/.test(l.text)).length).toBe(2);
    }
  });

  it('paints a word with a ligature in its place: the ligature whole, the rest tracked', () => {
    const { block } = tracked(JUSTIFIED);
    const t = block.letterSpacing!;
    const { ctx, seen } = paintingCtx();
    renderBlock(ctx, block, block.bbox.width, block.bbox.x);
    // The ligatures were painted, each with no letter-spacing.
    const ligatures = seen.filter((p) => p.text === 'fi' || p.text === 'ffi');
    expect(ligatures).toHaveLength(8);
    expect(ligatures.every((p) => p.spacing === 0)).toBe(true);
    // No word shaped without its ligature, and every other piece tracked.
    expect(seen.some((p) => /fi/.test(p.text) && p.spacing !== 0)).toBe(false);
    expect(seen.filter((p) => !ligatures.includes(p)).every((p) => Math.abs(p.spacing - t) < 1e-9)).toBe(true);
    // Each word ends where its segment does: within the tracking the
    // letters of its ligatures do not take.
    for (const line of block.lines) {
      for (const word of wordEnds(block, line, seen)) {
        expect(Math.abs(word.ink - word.place)).toBeLessThanOrEqual(2 * Math.abs(t) + 1e-6);
      }
    }
  });

  it('painted with the letter-spacing alone, the same words would overrun their places', () => {
    const { block } = tracked(JUSTIFIED);
    const t = block.letterSpacing!;
    const measure = new BrowserCtx();
    measure.letterSpacing = `${t}px`;
    const first = block.lines.flatMap((l) => l.segments!).find((s) => s.text === 'first')!;
    // "first" without its ligature: one letter's advance wider than the place.
    expect(measure.measureText('first').width - first.width).toBeCloseTo(1, 5);
  });

  it('a ragged tracked line painted as one text goes word by word when it holds a ligature', () => {
    const { block } = tracked(RAGGED, LEFT);
    const t = block.letterSpacing!;
    const { ctx, seen } = paintingCtx();
    renderBlock(ctx, block, block.bbox.width, block.bbox.x);
    const [one, two, three] = block.lines as [VDTLine, VDTLine, VDTLine];
    for (const line of [one, two]) {
      expect(seen.some((p) => p.text === line.text)).toBe(false);
      for (const word of wordEnds(block, line, seen)) expect(Math.abs(word.ink - word.place)).toBeLessThanOrEqual(2 * Math.abs(t) + 1e-6);
    }
    expect(seen.filter((p) => p.text === 'fi' || p.text === 'ffi').every((p) => p.spacing === 0)).toBe(true);
    // The line with no ligature: one fillText, as before.
    expect(seen.filter((p) => p.text === three.text)).toHaveLength(1);
    expect(ctx.letterSpacing).toBe('0px');
  });

  it('an untracked paragraph is painted as before, nothing measured', () => {
    const doc = buildDocument({ markdown: 'The first of its offices.' }, LEFT);
    const block = paragraph(doc);
    expect(block.letterSpacing).toBeUndefined();
    const ctx = Object.assign(new BrowserCtx(), {
      fillStyle: '', textBaseline: 'alphabetic', texts: [] as string[],
      fillText(this: { texts: string[] }, text: string) { this.texts.push(text); },
    });
    renderBlock(ctx as unknown as CanvasRenderingContext2D, block, block.bbox.width, block.bbox.x);
    expect(ctx.texts).toEqual(['The first of its offices.']);
    expect(ctx.measured).toBe(0);
  });
});

describe('a tracked line in HTML (#663)', () => {
  it('asks for its ligatures after the letter-spacing', () => {
    const { doc, block } = tracked(JUSTIFIED);
    const html = renderToHtml(doc);
    const t = block.letterSpacing!;
    expect(html).toContain(`letter-spacing:${t}px;font-feature-settings:'liga' 1,'clig' 1;`);
  });

  it('a run in another face asks again after its own font', () => {
    const doc = buildDocument({ markdown: JUSTIFIED.replace('first is', '**first** is') }, CONFIG);
    expect(paragraph(doc).letterSpacing).toBeLessThan(0);
    expect(renderToHtml(doc)).toMatch(/<span style="font:[^;]+;font-feature-settings:'liga' 1,'clig' 1;line-height:0;[^"]*">first<\/span>/);
  });

  it('an untracked line carries no feature', () => {
    const html = renderToHtml(buildDocument({ markdown: 'The **first** of its offices.' }, CONFIG));
    expect(html).not.toContain("'liga'");
  });
});

// #685: a right-to-left page paints its flow through a mirror and turns
// every `fillText` back about its own box (`mirrorFrame.ts`). The pieces of
// a tracked word are several `fillText`s: each was turned about itself and
// stayed at its mirrored place, the first piece at the right end of the
// word, so "five" came out "vefi". The word is one run: the frame turns it
// once, about its box. And no word with a right-to-left or a joining letter
// is ever cut.

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
/** A run as it lands on the sheet: where its box starts (`x`, `y`), the
 *  way its glyphs advance (`ux`, `uy`: (1, 0) on an upright page), whether
 *  they read mirrored (`det` < 0), and the context it was painted with. */
type Run = { text: string; x: number; y: number; ux: number; uy: number; det: number; width: number; baseline: number; spacing: number; direction: string; font: string };
const leftOf = (r: Run): number => Math.min(r.x, r.x + r.ux * r.width);
const rightOf = (r: Run): number => Math.max(r.x, r.x + r.ux * r.width);

/** A browser's 2D context (the measurer above) that keeps its transform
 *  and its state. `keeps`: see {@link BrowserCtx}; its fonts carry another
 *  name, so what is known of a word in one browser is not taken for the
 *  other. */
function sheetCanvas(keeps = false): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; runs: Run[] } {
  const runs: Run[] = [];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: { m: M; state: Record<string, unknown> }[] = [];
  const measure = new BrowserCtx(keeps);
  const state: Record<string, unknown> = { font: '10px Body', textAlign: 'left', direction: 'ltr', textBaseline: 'alphabetic', letterSpacing: '0px', fillStyle: '' };
  const measureText = (s: string): { width: number } => {
    measure.font = state.font as string;
    measure.letterSpacing = state.letterSpacing as string;
    return measure.measureText(s);
  };
  const api: Record<string, unknown> = {
    save() { stack.push({ m, state: { ...state } }); },
    restore() {
      const top = stack.pop();
      if (!top) return;
      m = top.m;
      Object.assign(state, top.state);
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) { m = mul(m, [a, b, c, d, e, f]); },
    translate(x: number, y: number) { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale(x: number, y: number) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(t: number) { m = mul(m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]); },
    measureText,
    fillText(text: string, x: number, y: number) {
      const width = measureText(text).width;
      // The run's box from its alignment, as a browser places it.
      const rtl = state.direction === 'rtl';
      const from = state.textAlign === 'right' || (state.textAlign === 'start' && rtl) || (state.textAlign === 'end' && !rtl) ? x - width : x;
      runs.push({
        text, x: m[0] * from + m[2] * y + m[4], y: m[1] * from + m[3] * y + m[5], ux: m[0], uy: m[1], det: m[0] * m[3] - m[1] * m[2],
        width, baseline: y, spacing: parseFloat(state.letterSpacing as string) || 0, direction: state.direction as string, font: state.font as string,
      });
    },
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key === 'string' && key in api) return api[key];
      if (typeof key === 'string' && key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) {
      // The mirrored frame puts its own `fillText` on the context.
      if (typeof key === 'string' && key in api) api[key] = value;
      else target[key as string] = key === 'font' && keeps ? `${value}, Keeps` : value;
      return true;
    },
    has(target, key) { return typeof key === 'string' && (key in api || key in target); },
    deleteProperty() { return true; },
    getOwnPropertyDescriptor() { return undefined; },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx, runs };
}
function runsOn(doc: VDTDocument, page = 0, keeps = false): Run[] {
  const { canvas, runs } = sheetCanvas(keeps);
  renderPageToCanvas(doc.pages[page]!, doc, canvas);
  return runs;
}
/** The runs on each baseline of an upright page, from the sheet's left. */
function rows(runs: Run[]): Run[][] {
  const by = new Map<number, Run[]>();
  for (const r of runs) by.set(r.baseline, [...(by.get(r.baseline) ?? []), r]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => leftOf(a) - leftOf(b)));
}

/**
 * The page painted by a browser that drops the ligatures of a tracked word
 * against the same page painted by one that keeps them, which paints every
 * word whole and so where the frame, the line's order and any turn of the
 * block put it. A word in pieces must start where the whole word starts,
 * read the same way, and hold its pieces at their places in the natural
 * shaping. Returns the words painted in pieces. For pages whose tracked
 * lines are painted word by word in either browser.
 */
function againstWholeWords(doc: VDTDocument, page = 0): Run[][] {
  const cut = runsOn(doc, page);
  const whole = runsOn(doc, page, true);
  const words: Run[][] = [];
  let j = 0;
  for (const w of whole) {
    const pieces: Run[] = [];
    let text = '';
    while (text.length < w.text.length && j < cut.length) {
      pieces.push(cut[j]!);
      text += cut[j++]!.text;
    }
    expect(text).toBe(w.text);
    const first = pieces[0]!;
    const known = pieces.length > 1 ? trackedPieces(Object.assign(paintingCtx().ctx, { font: first.font }), w.text)! : undefined;
    pieces.forEach((p, k) => {
      const at = known ? known[k]!.offset + w.spacing * known[k]!.glyphsBefore : 0;
      expect(p.x).toBeCloseTo(w.x + w.ux * at, 6);
      expect(p.y).toBeCloseTo(w.y + w.uy * at, 6);
      expect(p.ux).toBeCloseTo(w.ux, 9);
      expect(p.uy).toBeCloseTo(w.uy, 9);
      // Read as written, never through the mirror.
      expect(p.det).toBeGreaterThan(0);
      expect(p.direction).toBe(w.direction);
      expect(p.spacing).toBe(known?.[k]!.ligature ? 0 : w.spacing);
    });
    if (pieces.length > 1) words.push(pieces);
  }
  expect(j).toBe(cut.length);
  return words;
}

const RTL: PostextConfig = { ...CONFIG, direction: 'rtl' };
const RTL_LEFT: PostextConfig = { ...LEFT, direction: 'rtl' };
const ltrBlock = (text: string): string => `:::paragraphs{dir=ltr}\n${text}\n:::`;

describe('a word in pieces inside a mirrored frame (#685)', () => {
  it('is turned once, about its box: the pieces in reading order from the box\'s left', () => {
    const { ctx, runs } = sheetCanvas();
    const t = -0.1;
    ctx.letterSpacing = `${t}px`;
    const end = beginMirroredFlow(ctx, 200);
    const paint = (text: string, x: number, y: number): void => ctx.fillText(text, x, y);
    fillTrackedWord(ctx, 'first', 40, 50, t, paint);
    // A word with no ligature beside it: one `fillText`, turned by the frame.
    fillTrackedWord(ctx, 'hands', 100, 50, t, paint);
    expect(ctx.letterSpacing).toBe(`${t}px`);
    end();
    expect(runs.map((r) => r.text)).toEqual(['fi', 'rst', 'hands']);
    const [fi, rst, hands] = runs as [Run, Run, Run];
    // "first" was measured 20 px wide and five letters tracked: its box is
    // [40, 59.5] in the flow, [140.5, 160] on the sheet.
    expect(leftOf(fi)).toBeCloseTo(200 - 40 - (20 + 5 * t), 6);
    expect(fi.spacing).toBe(0);
    // The rest after the ligature and its one glyph of tracking.
    expect(leftOf(rst)).toBeCloseTo(leftOf(fi) + 5 + t, 6);
    expect(rst.spacing).toBe(t);
    // It ends at the box's right, less the tracking the ligature's second
    // letter does not take (one glyph, as on a left-to-right page).
    expect(rightOf(rst)).toBeCloseTo(200 - 40 - t, 6);
    expect(runs.every((r) => r.det > 0 && r.ux === 1)).toBe(true);
    // The whole word stands as the frame always put it.
    expect(leftOf(hands)).toBeCloseTo(200 - 100 - (25 + 5 * t), 6);
    expect(rightOf(hands)).toBeCloseTo(100, 6);
  });

  it('outside a mirrored frame the pieces start at the word\'s left', () => {
    const { ctx, runs } = sheetCanvas();
    ctx.letterSpacing = '-0.1px';
    fillTrackedWord(ctx, 'first', 40, 50, -0.1, (text, x, y) => ctx.fillText(text, x, y));
    expect(runs.map((r) => [r.text, +leftOf(r).toFixed(6), r.spacing])).toEqual([['fi', 40, 0], ['rst', 44.9, -0.1]]);
  });
});

describe('a tracked left-to-right paragraph on a right-to-left page (#685)', () => {
  for (const [name, text, ltr, rtl] of [['justified', JUSTIFIED, CONFIG, RTL], ['ragged', RAGGED, LEFT, RTL_LEFT]] as const) {
    it(`${name}: every piece lands where a left-to-right page puts it`, () => {
      const plain = buildDocument({ markdown: text }, ltr);
      const mirrored = buildDocument({ markdown: ltrBlock(text) }, rtl);
      expect(mirrored.pages[0]!.flow?.writingMode).toBe('horizontal-tb');
      const block = paragraph(mirrored);
      const t = block.letterSpacing!;
      expect(t).toBeCloseTo(-0.1, 5);
      const a = rows(runsOn(plain));
      const b = rows(runsOn(mirrored));
      expect(b.length).toBe(block.lines.length);
      expect(b.length).toBe(a.length);
      b.forEach((row, i) => {
        // From the sheet's left the pieces spell the line: "fi" before
        // "rst", never after it.
        expect(row.map((r) => r.text).join('')).toBe(block.lines[i]!.text.replace(/ /g, ''));
        expect(row.every((r) => r.det > 0)).toBe(true);
        // The margins are equal, so the line stands as on the left-to-right
        // page; a ragged line of the mirrored page starts the tracking of
        // one glyph further in (it is aligned by its other end), words in
        // pieces and whole words alike.
        const shift = leftOf(row[0]!) - leftOf(a[i]![0]!);
        expect(Math.abs(shift)).toBeLessThanOrEqual(Math.abs(t) + 1e-9);
        if (a[i]!.length === 1) {
          // A line with no ligature: one text on the left-to-right page,
          // word by word on the mirrored one, over the same stretch.
          expect(rightOf(row[row.length - 1]!) - shift).toBeCloseTo(rightOf(a[i]![0]!), 6);
          return;
        }
        expect(row.length).toBe(a[i]!.length);
        row.forEach((r, k) => {
          const q = a[i]![k]!;
          expect(r.text).toBe(q.text);
          expect(r.spacing).toBe(q.spacing);
          expect(leftOf(r) - shift).toBeCloseTo(leftOf(q), 6);
          expect(rightOf(r) - shift).toBeCloseTo(rightOf(q), 6);
        });
      });
      expect(b.flat().filter((r) => r.text === 'fi' || r.text === 'ffi').length).toBeGreaterThan(3);
    });
  }
});

/** A page whose level-2 headings are tracked: half a point after each letter. */
const tracked2 = (config: PostextConfig): PostextConfig => ({
  ...config,
  page: { ...config.page, width: pt(400) },
  headings: { levels: [{ level: 2, letterSpacing: pt(0.5) }] },
});
const headingOf = (doc: VDTDocument): VDTBlock => doc.blocks.find((b) => b.type === 'heading')!;

describe('right-to-left words on a tracked line (#685)', () => {
  it('an Arabic or a Hebrew word is never cut, though its face has ligatures', () => {
    const { ctx } = paintingCtx();
    for (const word of [SALAM, ISRAEL, `first${SALAM}`, `${ISRAEL}first`]) {
      // The browser shapes it otherwise under a letter-spacing…
      expect(shapedOtherwise(ctx, word)).toBe(true);
      // …and it is still painted whole, with one `fillText`.
      expect(trackedPieces(ctx, word)).toBeNull();
      const seen: [string, number, number][] = [];
      ctx.letterSpacing = '0.5px';
      fillTrackedWord(ctx, word, 10, 20, 0.5, (text, x, y) => seen.push([text, x, y]));
      expect(seen).toEqual([[word, 10, 20]]);
      expect(ctx.letterSpacing).toBe('0.5px');
    }
  });

  for (const [name, config, dir] of [['a right-to-left line of a left-to-right page', CONFIG, ' {dir=rtl}'], ['a line of a right-to-left page', RTL, '']] as const) {
    it(`${name}: the Arabic word untracked, the Hebrew ones whole, the Latin ones in reading order`, () => {
      const doc = buildDocument({ markdown: `## ${SHALOM} first ${SALAM} office ${SHALOM}${dir}` }, tracked2(config));
      const line = headingOf(doc).lines[0]!;
      expect(line.segments!.filter((s) => s.rtl && s.kind !== 'space').map((s) => s.text)).toEqual([SHALOM, SALAM, SHALOM]);
      const runs = runsOn(doc);
      // Arabic: one `fillText`, no letter-spacing, right to left.
      expect(runs.filter((r) => r.text.includes('\u0644\u0627')).map((r) => [r.text, r.spacing, r.direction])).toEqual([[SALAM, 0, 'rtl']]);
      // Hebrew: one `fillText` a word, tracked as measured, right to left.
      expect(runs.filter((r) => r.text.includes('\u05E9')).map((r) => [r.text, r.spacing, r.direction])).toEqual([[SHALOM, 0.5, 'rtl'], [SHALOM, 0.5, 'rtl']]);
      // The Latin words: in pieces, where the whole words would stand.
      const words = againstWholeWords(doc);
      const first = words.find((w) => w[0]!.text === 'fi')!;
      const office = words.find((w) => w[0]!.text === 'o')!;
      expect(words).toHaveLength(2);
      expect(first.map((r) => r.text)).toEqual(['fi', 'rst']);
      expect(office.map((r) => r.text)).toEqual(['o', 'ffi', 'ce']);
      for (const w of words) for (let k = 1; k < w.length; k++) expect(leftOf(w[k]!)).toBeGreaterThan(leftOf(w[k - 1]!));
      // The line reads from the right: "first" stands right of "office",
      // the Arabic word between them.
      const salam = runs.find((r) => r.text === SALAM)!;
      expect(leftOf(first[0]!)).toBeGreaterThanOrEqual(rightOf(salam) - 1e-6);
      expect(leftOf(salam)).toBeGreaterThanOrEqual(rightOf(office[2]!) - 1);
    });
  }
});

const cell = (content: string) => ({ content });
/** A table whose header cells are tracked (`headerLetterSpacing`). */
const table = (extra: Partial<Resource> = {}, direction?: 'ltr' | 'rtl'): Resource => ({
  id: 'tab', typeId: 'table', kind: 'table', caption: 'A table', createdAt: 0, updatedAt: 0,
  table: {
    model: { headerRowCount: 1, rows: [[cell('first office'), cell('fire lets')], [cell('stood'), cell('is')]] },
    ...(direction ? { direction } : {}),
  },
  placement: { position: 'here' },
  ...extra,
});
const withTable = (config: PostextConfig): PostextConfig => ({
  ...config,
  page: { ...config.page, width: pt(300), height: pt(400) },
  tableStyle: { headerLetterSpacing: pt(0.5) },
});
const TABLE_MD = 'Text.\n\n::resource{id="tab"}\n\nMore.';
/** The page that holds the table, in the flow or as a float. */
const tablePage = (doc: VDTDocument): number =>
  doc.pages.findIndex((p) => [...p.columns.flatMap((c) => c.blocks), ...(p.floats ?? [])].some((b) => b.resourceBlock?.resource.id === 'tab'));

describe('tracked header cells in either direction (#685)', () => {
  const header = [['fi', 'rst'], ['o', 'ffi', 'ce'], ['fi', 're']];
  for (const [name, config, direction] of [
    ['a table of a left-to-right page', CONFIG, undefined],
    ['a table of a right-to-left page', RTL, undefined],
    ['a left-to-right table of a right-to-left page', RTL, 'ltr'],
    ['a right-to-left table of a left-to-right page', CONFIG, 'rtl'],
  ] as const) {
    it(`${name}: the words in pieces stand where the whole words would`, () => {
      const doc = buildDocument({ markdown: TABLE_MD, resources: [table({}, direction)] }, withTable(config));
      const words = againstWholeWords(doc, tablePage(doc));
      expect(words.map((w) => w.map((r) => r.text)).sort()).toEqual([...header].sort());
      // Upright: each word reads from the sheet's left.
      for (const w of words) for (let k = 1; k < w.length; k++) expect(leftOf(w[k]!)).toBeGreaterThan(leftOf(w[k - 1]!));
    });
  }

  for (const rotate of ['ccw', 'cw'] as const) {
    for (const [name, config] of [['left-to-right', CONFIG], ['right-to-left', RTL]] as const) {
      it(`a table turned ${rotate} on a ${name} page: the pieces follow the turn`, () => {
        const doc = buildDocument({ markdown: TABLE_MD, resources: [table({ placement: { rotate } })] }, withTable(config));
        const page = tablePage(doc);
        expect(page).toBeGreaterThanOrEqual(0);
        const words = againstWholeWords(doc, page);
        expect(words.map((w) => w.map((r) => r.text)).sort()).toEqual([...header].sort());
        for (const w of words) {
          // Turned a quarter: the letters advance up or down the sheet,
          // each piece further along than the one before.
          expect(Math.abs(w[0]!.ux)).toBeLessThan(1e-9);
          for (let k = 1; k < w.length; k++) expect((w[k]!.y - w[k - 1]!.y) * w[0]!.uy).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('lines that are never cut (#685)', () => {
  it('a vertical line is painted the same whether the browser drops ligatures or not', () => {
    const doc = buildDocument({ markdown: '## first office fire' }, tracked2({ ...CONFIG, layout: { writingMode: 'vertical-rl', layoutType: 'single' } }));
    expect(headingOf(doc).letterSpacing ?? headingOf(doc).lines[0]!.letterSpacing).toBeCloseTo(0.5, 6);
    // What was painted and where; the two browsers measure the run apart.
    const put = (r: Run) => ({ ...r, font: r.font.replace(', Keeps', ''), width: 0 });
    const cut = runsOn(doc).map(put);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut).toEqual(runsOn(doc, 0, true).map(put));
    // The words with their neighbours, tracked: no ligature set apart.
    expect(cut.map((r) => r.text).join(' ')).toContain('first');
    expect(cut.some((r) => r.text === 'fi' || r.text === 'ffi' || r.spacing === 0)).toBe(false);
  });
});

describe('a tracked line in HTML, either direction (#685)', () => {
  it('a left-to-right paragraph of a right-to-left page asks for its ligatures as on a left-to-right page', () => {
    const plain = renderToHtml(buildDocument({ markdown: JUSTIFIED }, CONFIG));
    const mirrored = renderToHtml(buildDocument({ markdown: ltrBlock(JUSTIFIED) }, RTL));
    const asked = (html: string): number => html.split("font-feature-settings:'liga' 1,'clig' 1;").length - 1;
    expect(asked(plain)).toBe(3);
    expect(asked(mirrored)).toBe(3);
    // The words are whole in the markup: nothing to put in order.
    for (const word of ['first', 'offices', 'fire']) expect(mirrored).toContain(word);
  });

  it('an Arabic word of a tracked line takes no letter-spacing; a Hebrew one keeps the line\'s', () => {
    const html = renderToHtml(buildDocument({ markdown: `## ${SHALOM} first ${SALAM} office ${SHALOM}` }, tracked2(RTL)));
    expect(html).toContain("letter-spacing:0.5px;font-feature-settings:'liga' 1,'clig' 1;");
    expect(html).toMatch(new RegExp(`<span[^>]*letter-spacing:0;[^>]*>${SALAM}</span>`));
    expect(html).toContain(SHALOM);
    expect(html).not.toMatch(new RegExp(`<span[^>]*letter-spacing:0;[^>]*>${SHALOM}</span>`));
  });
});
