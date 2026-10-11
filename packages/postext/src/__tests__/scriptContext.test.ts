import { describe, it, expect, beforeEach } from 'vitest';
import { renderPageToCanvas } from '../canvas-backend';
import { beginMirroredFlow } from '../canvas-backend/mirrorFrame';
import { fillScriptWord } from '../canvas-backend/scriptText';
import { renderToHtml } from '../html-backend';
import { buildDocument } from '../pipeline';
import { clearMeasurementCache } from '../measure';
import { measureBlock } from '../measure/plain';
import { faceReadsScript, isLetterless, resolveScriptContext, scriptMark, scriptTextWidth, setMeasureScriptContext, withScriptMark } from '../measure/script';
import { measureTextWidth } from '../measure/canvas';
import { spanIsolates } from '../bidi';
import { parseInlineFormatting } from '../parse/inlineFormatting';
import type { PostextConfig } from '../types';
import type { VDTBlock, VDTDocument, VDTLineSegment } from '../vdt';

// #725: a word with no letter (`46.`, `1367)`) has no script of its own. A
// face may draw its punctuation by script (Amiri: a Latin full stop and
// brackets under `latn`, Arabic ones otherwise, of other widths), and each
// shaper handed such a word alone picks one by a rule of its own. Chrome
// 131's canvas took the font's default forms, Chrome 154's the Latin ones,
// so a document broke its lines otherwise from one to the other. The
// layout now gives the word the script of the text around it and every
// stage shapes it in that script.

const NBSP = '\u00A0';
const BEH = '\u0628';
const VERSE_SIGN = '\u060E';

/** How each character is drawn: by its own script, or by the script of
 *  the run it stands in when it has none. */
type Script = 'Latn' | 'Arab' | 'Grek' | 'Cyrl' | 'Hebr';
function ownScript(ch: string): Script | undefined {
  if (/\p{Script=Latin}/u.test(ch)) return 'Latn';
  if (/\p{Script=Arabic}/u.test(ch)) return 'Arab';
  if (/\p{Script=Greek}/u.test(ch)) return 'Grek';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'Cyrl';
  if (/\p{Script=Hebrew}/u.test(ch)) return 'Hebr';
  return undefined;
}
/** Advances in a face like Amiri, in ems: the Latin forms of the full
 *  stop, the brackets and the guillemets are another width than the
 *  default ones. A face named `Plain` draws them one way. */
function advance(ch: string, script: Script | 'DFLT', sensitive: boolean): number {
  const latin = !sensitive || script === 'Latn';
  if (ch === ' ' || ch === NBSP) return 0.25;
  if (ch === '.') return latin ? 0.2 : 0.3;
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']') return latin ? 0.25 : 0.45;
  if (ch === '\u00AB' || ch === '\u00BB') return latin ? 0.47 : 0.41;
  if (ch === ',') return 0.2;
  return 0.5;
}
const isRtlLetter = (ch: string): boolean => /[\u0590-\u08FF]/.test(ch) && /\p{L}/u.test(ch);
const isLtrLetter = (ch: string): boolean => /\p{L}/u.test(ch) && !isRtlLetter(ch);
const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

/** The browser whose canvas is measured and painted on: 131 reads the
 *  script of a word from all of it and sets a word with no letter in the
 *  font's default forms; 154 reads each bidi run alone and sets one with
 *  no letter in Latin forms. Both shape the words of a text one by one. */
let chrome: 131 | 154 = 154;

function shapedWidth(text: string, font: string, direction: string): number {
  const size = parseFloat(/(\d*\.?\d+)px/.exec(font)?.[1] ?? '10');
  const sensitive = !font.includes('Plain');
  let width = 0;
  for (const word of text.split(/( )/)) {
    if (word === '') continue;
    const chars = [...word];
    // The runs a version itemises on its own.
    const units: string[][] = [];
    if (chrome === 131) units.push(chars);
    else {
      const rtl = direction === 'rtl';
      const side = (ch: string): string => (rtl ? (isLtrLetter(ch) || isDigit(ch) ? 'l' : 'r') : isRtlLetter(ch) ? 'r' : 'l');
      for (const ch of chars) {
        const last = units[units.length - 1];
        if (last && side(last[0]!) === side(ch)) last.push(ch);
        else units.push([ch]);
      }
    }
    for (const unit of units) {
      const first = unit.map(ownScript).find((s) => s !== undefined);
      let script: Script | 'DFLT' = first ?? (chrome === 131 ? 'DFLT' : 'Latn');
      for (const ch of unit) {
        script = ownScript(ch) ?? script;
        width += advance(ch, script, sensitive) * size;
      }
    }
  }
  return width;
}

class BrowserCtx {
  font = '10px Body';
  direction = 'ltr';
  letterSpacing = '0px';
  measureText(s: string): { width: number } {
    return { width: shapedWidth(s, this.font, this.direction) };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): BrowserCtx {
    return new BrowserCtx();
  }
};
function on(version: 131 | 154): void {
  chrome = version;
  clearMeasurementCache();
}
beforeEach(() => {
  on(154);
  setMeasureScriptContext({ enabled: true, script: 'Latn' });
});

const AMIRI = '10px Amiri';
const PLAIN = '10px Plain';

describe('a word with no letter (#725)', () => {
  it('is one of digits, punctuation or symbols alone', () => {
    for (const word of ['46.', '1367)', '\u00BB.', '(', '2016).', '3.14', '\u2014', '12\u00A0000']) expect(isLetterless(word)).toBe(true);
    for (const word of ['a.', '(d.', '\u0661', BEH, 'n\u00BA', '']) expect(isLetterless(word)).toBe(false);
  });

  it('alone, it is measured otherwise by each browser in a face that draws punctuation by script', () => {
    on(131);
    expect(measureTextWidth('46.', AMIRI)).toBeCloseTo(13, 6);
    expect(measureTextWidth('46.', PLAIN)).toBeCloseTo(12, 6);
    on(154);
    expect(measureTextWidth('46.', AMIRI)).toBeCloseTo(12, 6);
  });

  it('beside its mark it is measured the same by both, in each script and direction', () => {
    for (const version of [131, 154] as const) {
      on(version);
      expect(faceReadsScript(AMIRI)).toBe(true);
      expect(faceReadsScript(PLAIN)).toBe(false);
      expect(scriptTextWidth('46.', AMIRI, 'Latn', false)).toBeCloseTo(12, 6);
      expect(scriptTextWidth('1367)', AMIRI, 'Latn', false)).toBeCloseTo(22.5, 6);
      // Arabic forms, painted left to right (a number in an Arabic sentence)…
      expect(scriptTextWidth('3.14', AMIRI, 'Arab', false)).toBeCloseTo(18, 6);
      // …and right to left (its brackets).
      expect(scriptTextWidth('(', AMIRI, 'Arab', true)).toBeCloseTo(4.5, 6);
      expect(scriptTextWidth(').', AMIRI, 'Arab', true)).toBeCloseTo(7.5, 6);
      // A script the face has no forms for takes its default ones.
      expect(scriptTextWidth('46.', AMIRI, 'Grek', false)).toBeCloseTo(13, 6);
      expect(scriptTextWidth('46.', AMIRI, 'Hebr', false)).toBeCloseTo(13, 6);
      expect(scriptTextWidth(')', AMIRI, 'Hebr', true)).toBeCloseTo(4.5, 6);
    }
  });

  it('a letter after a left-to-right word would not do on a current browser: the mark is a sign of the script with no direction', () => {
    expect(scriptMark('Latn', false)).toEqual({ lead: '', trail: `${NBSP}n` });
    expect(scriptMark('Arab', false)).toEqual({ lead: '', trail: `${NBSP}${VERSE_SIGN}` });
    expect(scriptMark('Arab', true)).toEqual({ lead: `${BEH}${NBSP}`, trail: '' });
    expect(scriptMark('Hebr', true)).toEqual({ lead: `\u05D0${NBSP}`, trail: '' });
    expect(withScriptMark('46.', 'Latn', false)).toBe(`46.${NBSP}n`);
    // An Arabic letter opens a right-to-left run, which Chrome 154 shapes
    // apart from the number before it.
    on(154);
    const ctx = new BrowserCtx();
    ctx.font = AMIRI;
    expect(ctx.measureText(`3.14${BEH}`).width - ctx.measureText(BEH).width).toBeCloseTo(17, 6);
    expect(ctx.measureText(`3.14${NBSP}${VERSE_SIGN}`).width - ctx.measureText(`${NBSP}${VERSE_SIGN}`).width).toBeCloseTo(18, 6);
  });
});

describe('the script of a word with no letter (#725)', () => {
  type Fallback = Parameters<typeof resolveScriptContext>[5];
  const at = (text: string, word: string, odd = false, isolates: Parameters<typeof resolveScriptContext>[4] = [], ...fallback: [Fallback?]) => {
    const start = text.indexOf(word);
    return resolveScriptContext(text, start, start + word.length, odd, isolates, fallback.length > 0 ? fallback[0] : 'Latn');
  };

  it('the recipes: a Latin note set in an Arabic face', () => {
    expect(at('in bayts 12, 16 and 46. The', '46.')).toBe('Latn');
    expect(at('a mark between \u00AB \u00BB. The', '\u00BB.')).toBe('Latn');
    expect(at('a mark between \u00AB \u00BB. The', '\u00AB')).toBe('Latn');
    expect(at('al-Maqrizi (d. 1367) wrote', '1367)')).toBe('Latn');
    expect(at('W3C, Layout Requirements (W3C, 2016).', '2016).')).toBe('Latn');
  });

  it('an Arabic sentence: the number and its brackets in Arabic forms', () => {
    const text = '\u062A\u0648\u0641\u064A (1367) \u0647\u0646\u0627';
    expect(at(text, '1367')).toBe('Arab');
    expect(at(text, '(', true)).toBe('Arab');
    expect(at(text, ')', true)).toBe('Arab');
  });

  it('a word that opens its text takes the script of the letter after it', () => {
    expect(at('1367) was the year', '1367)')).toBe('Latn');
    expect(at(`(1) ${BEH}${BEH}`, '(1)')).toBe('Arab');
  });

  it('a word in an isolate reads the isolate, not the text around it', () => {
    // An English title set as a left-to-right isolate in an Arabic sentence.
    const text = `${BEH}${BEH} Moby Dick (1851) ${BEH}${BEH}`;
    const iso = [{ start: 3, end: 19, direction: 'ltr' as const }];
    expect(text.slice(3, 19)).toBe('Moby Dick (1851)');
    expect(at(text, '(1851)', false, iso)).toBe('Latn');
    // The same number with nothing but itself in its isolate: the
    // document's language decides.
    const alone = `${BEH}${BEH} (1851) ${BEH}${BEH}`;
    expect(at(alone, '(1851)', false, [{ start: 3, end: 9, direction: 'ltr' }], 'Arab')).toBe('Arab');
    expect(at(alone, '(1851)', false, [{ start: 3, end: 9, direction: 'ltr' }], 'Latn')).toBe('Latn');
    // And the isolates of real spans.
    const spans = parseInlineFormatting(`${BEH}${BEH} :ltr[Moby Dick (1851)] ${BEH}`);
    const joined = spans.map((s) => s.text).join('');
    const ranges = spanIsolates(spans);
    expect(ranges).toHaveLength(1);
    expect(resolveScriptContext(joined, joined.indexOf('(1851)'), joined.indexOf('(1851)') + 6, false, ranges, 'Arab')).toBe('Latn');
  });

  it('a word that ends a Latin phrase in a right-to-left paragraph: its number Latin, its stop Arabic', () => {
    // The stop takes the paragraph's direction (level 1): the layout cuts
    // the word there, and each piece is asked on its own.
    const text = `${BEH}${BEH} see 46.`;
    expect(at(text, '46')).toBe('Latn');
    expect(resolveScriptContext(text, text.length - 1, text.length, true, [], 'Arab')).toBe('Arab');
  });

  it('a word painted right to left takes a right-to-left script only', () => {
    expect(at('abc ( def', '(', true, [], 'Latn')).toBeUndefined();
    expect(at('abc ( def', '(', true, [], 'Arab')).toBe('Arab');
    expect(at(`abc ( \u05D0\u05D1`, '(', true)).toBe('Hebr');
  });

  it('a paragraph with no letter takes the script of the document\'s language, or none', () => {
    expect(at('1367)', '1367)', false, [], 'Latn')).toBe('Latn');
    expect(at('1367)', '1367)', false, [], 'Arab')).toBe('Arab');
    expect(at('1367)', '1367)', false, [], undefined)).toBeUndefined();
  });

  it('beside a script the engine does not act on, the word is left alone', () => {
    expect(at('\u7EA2\u697C 1367) \u68A6', '1367)')).toBeUndefined();
    expect(at('\u0E01\u0E02 46.', '46.')).toBeUndefined();
  });
});

const pt = (value: number) => ({ value, unit: 'pt' as const });
// 72 dpi: 1 pt = 1 px.
const config = (family: string, extra: PostextConfig = {}): PostextConfig => ({
  page: { width: pt(190), height: pt(600), dpi: 72, margins: { top: pt(10), bottom: pt(10), left: pt(10), right: pt(10) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  ...extra,
  bodyText: { fontFamily: family, fontSize: pt(10), lineHeight: pt(14), firstLineIndent: pt(0), textAlign: 'left', hyphenation: { enabled: false }, ...extra.bodyText },
});
const NOTE = 'In bayts 12, 16 and 46. The mark stands between \u00AB \u00BB. He died (d. 1367) and the work (W3C, 2016). So it ends.';
const paragraph = (doc: VDTDocument): VDTBlock => doc.blocks.find((b) => b.type === 'paragraph')!;
const segmentsOf = (doc: VDTDocument): VDTLineSegment[] => paragraph(doc).lines.flatMap((l) => l.segments ?? []);
const layout = (doc: VDTDocument): unknown => JSON.parse(JSON.stringify(paragraph(doc).lines.map((l) => ({ text: l.text, width: l.bbox.width, segments: l.segments }))));
const build = (markdown: string, cfg: PostextConfig): VDTDocument => buildDocument({ markdown }, cfg);

describe('a Latin note set in a face that draws punctuation by script (#725)', () => {
  it('breaks its lines the same on Chrome 131 and on a current Chrome', () => {
    on(131);
    const old = build(NOTE, config('Amiri'));
    on(154);
    const current = build(NOTE, config('Amiri'));
    expect(layout(current)).toEqual(layout(old));
    expect(paragraph(current).lines.length).toBeGreaterThan(2);
    // Each word with no letter in its Latin forms, at their width.
    const words = Object.fromEntries(segmentsOf(current).filter((s) => s.scriptContext).map((s) => [s.text, [s.scriptContext, +s.width.toFixed(4)]]));
    expect(words).toEqual({
      '12,': ['Latn', 12],
      '16': ['Latn', 10],
      '46.': ['Latn', 12],
      '\u00AB': ['Latn', 4.7],
      '\u00BB.': ['Latn', 6.7],
      '1367)': ['Latn', 22.5],
      '2016).': ['Latn', 24.5],
    });
    // No other segment says anything.
    expect(segmentsOf(current).filter((s) => !s.scriptContext && s.kind === 'text').every((s) => /\p{L}/u.test(s.text))).toBe(true);
  });

  it('with the rule off, each browser measures them its own way and the lines differ', () => {
    const off = config('Amiri', { bodyText: { scriptContext: false } });
    on(131);
    const old = build(NOTE, off);
    on(154);
    const current = build(NOTE, off);
    expect(segmentsOf(old).some((s) => s.scriptContext)).toBe(false);
    expect(segmentsOf(current).some((s) => s.scriptContext)).toBe(false);
    const width = (doc: VDTDocument, text: string): number => segmentsOf(doc).find((s) => s.text === text)!.width;
    expect(width(old, '46.')).toBeCloseTo(13, 6);
    expect(width(current, '46.')).toBeCloseTo(12, 6);
    expect(width(old, '1367)')).toBeCloseTo(24.5, 6);
    expect(width(current, '1367)')).toBeCloseTo(22.5, 6);
    expect(layout(current)).not.toEqual(layout(old));
    // On a current Chrome the rule gives what that browser gave alone.
    const bare = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === 'scriptContext' ? undefined : v)));
    expect(bare(layout(build(NOTE, config('Amiri'))))).toEqual(layout(current));
  });

  it('a face that draws them one way under every script is laid out as before, with no field', () => {
    for (const version of [131, 154] as const) {
      on(version);
      const doc = build(NOTE, config('Plain'));
      expect(segmentsOf(doc).some((s) => 'scriptContext' in s)).toBe(false);
      expect(layout(doc)).toEqual(layout(build(NOTE, config('Plain', { bodyText: { scriptContext: false } }))));
    }
  });

  it('a paragraph with no formatting goes to the word-by-word breaker only when it holds such a word in such a face', () => {
    const opts = { textAlign: 'left' as const };
    // Pretext's lines carry no segments in this path; the breaker's do.
    const withWord = measureBlock('It ends in 46. Then.', AMIRI, 400, 14, opts);
    expect(withWord.lines[0]!.segments?.find((s) => s.text === '46.')?.scriptContext).toBe('Latn');
    const none = measureBlock('It ends in forty. Then.', AMIRI, 400, 14, opts);
    expect((none.lines[0]!.segments ?? []).some((s) => s.scriptContext)).toBe(false);
    const plain = measureBlock('It ends in 46. Then.', PLAIN, 400, 14, opts);
    expect((plain.lines[0]!.segments ?? []).some((s) => s.scriptContext)).toBe(false);
    setMeasureScriptContext({ enabled: false });
    const off = measureBlock('It ends in 46. Then.', AMIRI, 400, 14, opts);
    expect((off.lines[0]!.segments ?? []).some((s) => s.scriptContext)).toBe(false);
  });
});

const AR = '\u062A\u0648\u0641\u064A';
const RTL = (extra: PostextConfig = {}): PostextConfig => config('Amiri', { direction: 'rtl', locale: 'ar', ...extra });

describe('an Arabic sentence (#725)', () => {
  it('(1367) keeps its Arabic brackets: three pieces, each in the Arabic script', () => {
    for (const version of [131, 154] as const) {
      on(version);
      const doc = build(`${AR} (1367) ${AR}`, RTL());
      const pieces = segmentsOf(doc).filter((s) => s.scriptContext);
      expect(pieces.map((s) => [s.text, s.scriptContext, s.rtl ?? false, +s.width.toFixed(4)])).toEqual([
        ['(', 'Arab', true, 4.5],
        ['1367', 'Arab', false, 20],
        [')', 'Arab', true, 4.5],
      ]);
    }
  });

  it('a Latin phrase that ends the paragraph: its number Latin, its stop Arabic, the same on both browsers', () => {
    on(131);
    const old = build(`${AR} see 46.`, RTL());
    on(154);
    const current = build(`${AR} see 46.`, RTL());
    expect(layout(current)).toEqual(layout(old));
    expect(segmentsOf(current).filter((s) => s.scriptContext).map((s) => [s.text, s.scriptContext, s.rtl ?? false, +s.width.toFixed(4)])).toEqual([
      ['46', 'Latn', false, 10],
      ['.', 'Arab', true, 3],
    ]);
  });

  it('a paragraph with no letter takes the script of the document\'s language', () => {
    const arabic = build('1367).', RTL());
    expect(segmentsOf(arabic).filter((s) => s.kind === 'text').every((s) => s.scriptContext === 'Arab')).toBe(true);
    const english = build('1367).', config('Amiri'));
    expect(segmentsOf(english).map((s) => [s.text, s.scriptContext])).toEqual([['1367).', 'Latn']]);
  });
});

/** A context that records what is painted, and where its clip stands. */
type Painted = { text: string; x: number; y: number; direction: string; align: string; spacing: number; clip?: [number, number]; flip: number };
function paintingCtx(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; seen: Painted[] } {
  const seen: Painted[] = [];
  const measure = new BrowserCtx();
  const state: Record<string, unknown> = { font: '10px Body', textAlign: 'left', direction: 'ltr', textBaseline: 'alphabetic', letterSpacing: '0px', fillStyle: '' };
  // The transform as far as a mirror goes: x' = a·x + e.
  let a = 1;
  let e = 0;
  let clip: [number, number] | undefined;
  let pending: [number, number] | undefined;
  const stack: { a: number; e: number; clip: typeof clip; state: Record<string, unknown> }[] = [];
  const api: Record<string, unknown> = {
    save() { stack.push({ a, e, clip, state: { ...state } }); },
    restore() {
      const top = stack.pop();
      if (!top) return;
      ({ a, e, clip } = top);
      Object.assign(state, top.state);
    },
    transform(ta: number, _b: number, _c: number, _d: number, te: number) { e += a * te; a *= ta; },
    translate(x: number) { e += a * x; },
    scale(x: number) { a *= x; },
    beginPath() { pending = undefined; },
    rect(x: number, _y: number, w: number) { pending = [x, x + w]; },
    clip() {
      if (!pending) return;
      const [x0, x1] = [a * pending[0] + e, a * pending[1] + e];
      clip = [Math.min(x0, x1), Math.max(x0, x1)];
    },
    measureText(s: string) {
      measure.font = state.font as string;
      measure.direction = state.direction as string;
      return measure.measureText(s);
    },
    fillText(text: string, x: number, y: number) {
      seen.push({ text, x: a * x + e, y, direction: state.direction as string, align: state.textAlign as string, spacing: parseFloat(state.letterSpacing as string) || 0, ...(clip ? { clip } : {}), flip: a });
    },
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key === 'string' && key in api) return api[key];
      if (typeof key === 'string' && key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) {
      if (typeof key === 'string' && key in api) api[key] = value;
      else target[key as string] = value;
      return true;
    },
    has(target, key) { return typeof key === 'string' && (key in api || key in target); },
    deleteProperty() { return true; },
    getOwnPropertyDescriptor() { return undefined; },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx, seen };
}
/** The mirror a right-to-left page paints its flow through. */
const mirrorOf = (doc: VDTDocument): unknown => (doc.pages[0]!.flow as { mirror?: unknown } | undefined)?.mirror;
function painted(doc: VDTDocument): Painted[] {
  const { canvas, seen } = paintingCtx();
  renderPageToCanvas(doc.pages[0]!, doc, canvas);
  return seen;
}

describe('a word with no letter on canvas (#725)', () => {
  it('is painted beside its mark, the mark clipped away at the word\'s advance', () => {
    const { ctx, seen } = paintingCtx();
    ctx.font = AMIRI;
    fillScriptWord(ctx, '46.', 'Latn', false, 40, 50, (text, x, y) => ctx.fillText(text, x, y));
    expect(seen).toHaveLength(1);
    const [p] = seen as [Painted];
    expect(p.text).toBe(`46.${NBSP}n`);
    expect([p.x, p.y, p.direction]).toEqual([40, 50, 'ltr']);
    // The word is 12 px wide; the clip ends half a space past it, before
    // the mark's letter (a space further on).
    expect(p.clip![1]).toBeCloseTo(40 + 12 + 1.25, 6);
    expect(p.clip![0]).toBeLessThan(0);
  });

  it('a right-to-left word has its mark before it, which stands on its right', () => {
    const { ctx, seen } = paintingCtx();
    ctx.font = AMIRI;
    ctx.direction = 'rtl';
    fillScriptWord(ctx, ').', 'Arab', true, 40, 50, (text, x, y) => ctx.fillText(text, x, y));
    const [p] = seen as [Painted];
    expect(p.text).toBe(`${BEH}${NBSP}).`);
    expect([p.x, p.direction, p.align]).toEqual([40, 'rtl', 'left']);
    expect(p.clip![1]).toBeCloseTo(40 + 7.5 + 1.25, 6);
  });

  it('inside a mirrored frame the word is turned about its own box, not the box of the word and its mark', () => {
    const { ctx, seen } = paintingCtx();
    ctx.font = AMIRI;
    const end = beginMirroredFlow(ctx, 200);
    // A word with a letter beside it, turned by the frame as always.
    ctx.fillText('and', 20, 50);
    fillScriptWord(ctx, '46.', 'Latn', false, 40, 50, (text, x, y) => ctx.fillText(text, x, y));
    end();
    const [and, word] = seen as [Painted, Painted];
    // "and" is 15 px wide: its box [20, 35] of the flow is [165, 180] on the sheet.
    expect(and.x).toBeCloseTo(165, 6);
    // "46." is 12 px wide: its box [40, 52] is [148, 160] on the sheet, and
    // the text starts there, unmirrored.
    expect(word.text).toBe(`46.${NBSP}n`);
    expect(word.x).toBeCloseTo(148, 6);
    expect(word.flip).toBe(1);
    expect(word.clip![1]).toBeCloseTo(160 + 1.25, 6);
    // Turned about the box of the two it would start a mark's width off.
    expect(word.x).not.toBeCloseTo(200 - 40 - (12 + 7.5), 3);
  });

  it('a page paints each such word in its script, on both browsers', () => {
    for (const version of [131, 154] as const) {
      on(version);
      const doc = build(NOTE, config('Amiri'));
      const texts = painted(doc).map((p) => p.text);
      for (const word of ['12,', '16', '46.', '\u00AB', '\u00BB.', '1367)', '2016).']) {
        expect(texts).toContain(`${word}${NBSP}n`);
        expect(texts).not.toContain(word);
      }
      // Every marked text is clipped half a space past its word.
      const widths: Record<string, number> = { '12,': 12, '16': 10, '46.': 12, '\u00AB': 4.7, '\u00BB.': 6.7, '1367)': 22.5, '2016).': 24.5 };
      for (const p of painted(doc).filter((q) => q.text.endsWith(`${NBSP}n`))) {
        expect(p.clip![1] - p.x).toBeCloseTo(widths[p.text.slice(0, -2)]! + 1.25, 6);
      }
    }
  });

  it('a right-to-left page: the pieces of (1367) where the layout put them, each in the Arabic script', () => {
    const doc = build(`${AR} (1367) ${AR}`, RTL());
    expect(mirrorOf(doc)).toBeDefined();
    const seen = painted(doc);
    const open = seen.find((p) => p.text === `${BEH}${NBSP}(`)!;
    const close = seen.find((p) => p.text === `${BEH}${NBSP})`)!;
    const number = seen.find((p) => p.text === `1367${NBSP}${VERSE_SIGN}`)!;
    expect([open.direction, close.direction, number.direction]).toEqual(['rtl', 'rtl', 'ltr']);
    expect(seen.every((p) => p.flip === 1)).toBe(true);
    // On the sheet the sentence reads from the right: the opening bracket
    // right of the number, the closing one left of it, each 4.5 px wide
    // and the number 20.
    expect(open.x).toBeCloseTo(number.x + 20, 6);
    expect(close.x).toBeCloseTo(number.x - 4.5, 6);
    // And the Arabic words on either side, clear of them by a space.
    const words = seen.filter((p) => p.text === AR).sort((p, q) => p.x - q.x);
    expect(words).toHaveLength(2);
    expect(words[1]!.x).toBeCloseTo(open.x + 4.5 + 2.5, 6);
    expect(close.x).toBeCloseTo(words[0]!.x + 20 + 2.5, 6);
  });

  it('a left-to-right block of a right-to-left page, and a right-to-left one of a left-to-right page', () => {
    // The same Latin note: on a left-to-right page, and as a `dir=ltr`
    // block of a mirrored one. Each word stands the same distance from
    // the start of its line, the line running from the sheet's left.
    const plain = build('It ends in 46. Then.', config('Amiri'));
    const mirrored = build(':::paragraphs{dir=ltr}\nIt ends in 46. Then.\n:::', RTL());
    expect(mirrorOf(mirrored)).toBeDefined();
    // The mirrored page paints its line from the other end: read both
    // from the sheet's left.
    const a = painted(plain).sort((p, q) => p.x - q.x);
    const b = painted(mirrored).sort((p, q) => p.x - q.x);
    expect(b.map((p) => p.text)).toEqual(a.map((p) => p.text));
    expect(b.map((p) => p.text)).toContain(`46.${NBSP}n`);
    const fromStart = (list: Painted[]): number[] => list.map((p) => +(p.x - list[0]!.x).toFixed(6));
    expect(fromStart(b)).toEqual(fromStart(a));
    expect(b.every((p) => p.flip === 1)).toBe(true);
    // And an Arabic block of a left-to-right page: no mirror, the same pieces.
    const quoted = build(`:::paragraphs{dir=rtl}\n${AR} (1367) ${AR}\n:::`, config('Amiri'));
    expect(mirrorOf(quoted)).toBeUndefined();
    const c = painted(quoted);
    const open = c.find((p) => p.text === `${BEH}${NBSP}(`)!;
    const number = c.find((p) => p.text === `1367${NBSP}${VERSE_SIGN}`)!;
    const close = c.find((p) => p.text === `${BEH}${NBSP})`)!;
    expect(open.x).toBeCloseTo(number.x + 20, 6);
    expect(close.x).toBeCloseTo(number.x - 4.5, 6);
  });
});

describe('a word with no letter in HTML (#725)', () => {
  const MARK = (mark: string): string => `<span aria-hidden="true" style="font-size:0;-webkit-user-select:none;user-select:none;">${mark}</span>`;
  /** The text a reader selects and copies: the marks are no part of it. */
  const copied = (html: string): string => html.replace(/<span aria-hidden="true" style="font-size:0;[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '');

  it('holds the mark of its script in a box of no size, after it', () => {
    const html = renderToHtml(build('It ends in 46. Then.', config('Amiri')));
    expect(html).toContain(`>46.${MARK(`${NBSP}n`)}</span>`);
    expect(copied(html)).toContain('It ends in 46. Then.');
    expect(copied(html)).not.toContain(`${NBSP}n`);
  });

  it('a right-to-left word has it before it; the number between the brackets after it', () => {
    const html = renderToHtml(build(`${AR} (1367) ${AR}`, RTL()));
    expect(html).toContain(`>${MARK(`${BEH}${NBSP}`)}(</span>`);
    expect(html).toContain(`>1367${MARK(`${NBSP}${VERSE_SIGN}`)}</span>`);
    expect(html).toContain(`>${MARK(`${BEH}${NBSP}`)})</span>`);
    expect(copied(html)).toContain(`${AR} (1367) ${AR}`);
  });

  it('a face that draws them one way, and a document with the rule off, carry no mark', () => {
    expect(renderToHtml(build(NOTE, config('Plain')))).not.toContain('font-size:0');
    expect(renderToHtml(build(NOTE, config('Amiri', { bodyText: { scriptContext: false } })))).not.toContain('font-size:0');
  });
});

describe('a word with no letter on a tracked line (#725)', () => {
  // Level-2 headings tracked half a point after each letter.
  const tracked = (cfg: PostextConfig): PostextConfig => ({ ...cfg, page: { ...cfg.page!, width: pt(400) }, headings: { fontFamily: 'Amiri', levels: [{ level: 2, letterSpacing: pt(0.5), fontSize: pt(10) }] } });
  const heading = (doc: VDTDocument): VDTBlock => doc.blocks.find((b) => b.type === 'heading')!;
  const headingSegments = (doc: VDTDocument): VDTLineSegment[] => heading(doc).lines.flatMap((l) => l.segments ?? []);

  it('in a Latin context it is tracked as any word, the same on both browsers', () => {
    for (const version of [131, 154] as const) {
      on(version);
      const doc = build('## It ends in 46.', tracked(config('Amiri')));
      const seg = headingSegments(doc).find((s) => s.text === '46.')!;
      expect(seg.scriptContext).toBe('Latn');
      // 12 px in its Latin forms and half a point after each character.
      expect(seg.width).toBeCloseTo(12 + 3 * 0.5, 6);
      const word = painted(doc).find((p) => p.text === `46.${NBSP}n`)!;
      expect(word.spacing).toBe(0.5);
    }
  });

  it('in the Arabic script it takes no tracking, as the Arabic words around it take none', () => {
    for (const version of [131, 154] as const) {
      on(version);
      const doc = build(`## ${AR} (1367) ${AR}`, tracked(RTL()));
      expect(heading(doc).letterSpacing ?? heading(doc).lines[0]!.letterSpacing).toBeCloseTo(0.5, 6);
      const pieces = headingSegments(doc).filter((s) => s.scriptContext);
      // Measured with no tracking: a current browser spaces no run of a
      // cursive script, where Chrome 131 did.
      expect(pieces.map((s) => [s.text, s.scriptContext, +s.width.toFixed(4)])).toEqual([['(', 'Arab', 4.5], ['1367', 'Arab', 20], [')', 'Arab', 4.5]]);
      const seen = painted(doc);
      for (const text of [`${BEH}${NBSP}(`, `1367${NBSP}${VERSE_SIGN}`, `${BEH}${NBSP})`]) {
        expect(seen.find((p) => p.text === text)!.spacing, text).toBe(0);
      }
      // And the HTML says so on each of them.
      const html = renderToHtml(doc);
      expect(html.match(/letter-spacing:0;[^"]*"><span aria-hidden="true" style="font-size:0;/g) ?? []).toHaveLength(2);
      expect(html).toMatch(/letter-spacing:0;[^"]*">1367<span aria-hidden="true"/);
    }
  });
});
