import { describe, it, expect } from 'vitest';
import { renderBlock } from '../canvas-backend/blockRender';
import { trackedPieces, shapedOtherwise } from '../canvas-backend/trackedText';
import { renderToHtml } from '../html-backend';
import { buildDocument } from '../pipeline';
import type { PostextConfig } from '../types';
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
const LIGATURES: [string, number][] = [['ffi', 0.75], ['ff', 0.5], ['fi', 0.5], ['fl', 0.5]];
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

/** The measuring half of a browser's 2D context. */
class BrowserCtx {
  font = '10px Body';
  letterSpacing = '0px';
  measured = 0;
  measureText(s: string): { width: number } {
    this.measured++;
    const spacing = parseFloat(this.letterSpacing) || 0;
    return { width: naturalWidth(s, sizeOf(this.font), spacing === 0) + spacing * s.length };
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
