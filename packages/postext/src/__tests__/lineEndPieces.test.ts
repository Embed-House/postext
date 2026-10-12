import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearMeasurementCache } from '../measure';
import { setMeasureLanguage } from '../measure/canvas';
import { measureRichBlock } from '../measure/rich';
import { setHyphenationLocale } from '../hyphenate';
import type { MeasureBlockOptions } from '../measure/types';
import type { VDTLine, VDTLineSegment } from '../vdt';

// #770, round 2: the two halves of a word broken at a line end. In a
// paragraph cut word by word a piece of a word was as wide as the word
// grew by it, so the rest that opens the next line was the whole word
// less what stayed above: whatever the face draws across the break (the
// wide dot of a Catalan `l·l`, a ligature, a kerned pair) stayed in a box
// nothing paints it in. A document shaped in its own language measures
// each half as the text painted; one that keeps the host's language keeps
// the widths it had.

const SHY = '­';
const DOT = '·';
const sizeOf = (font: string): number => parseFloat(/(\d*\.?\d+)px/.exec(font)?.[1] ?? '10');

/**
 * The advance of `text` in a face that draws across its letters, px at
 * 10 px: every letter 5; a space 2.5; a hyphen 3; a full stop 2. `Punt`
 * (as Crimson Pro) sets the middle dot 6 between two `l` in Catalan and
 * 2.5 anywhere else. `Lliga` (as Lora) sets it 2.5 and ligates `l·`,
 * 1.3 narrower. Both: `ff` a ligature 2 narrower, `fi` one 1 narrower,
 * `yo` kerned 1, `o.` kerned 0.5, `-y` kerned 0.4.
 */
function faceWidth(text: string, font: string, lang: string): number {
  const catalan = lang.toLowerCase().split('-')[0] === 'ca';
  const lliga = font.includes('Lliga');
  const chars = Array.from(text);
  let px = 0;
  chars.forEach((ch, i) => {
    const prev = chars[i - 1];
    const next = chars[i + 1];
    if (ch === ' ' || ch === ' ') px += 2.5;
    else if (ch === '-') px += 3;
    else if (ch === '.') px += 2;
    else if (ch === DOT) px += !lliga && catalan && prev === 'l' && next === 'l' ? 6 : 2.5;
    else if (ch.codePointAt(0)! >= 0x2E80) px += 10;
    else px += 5;
    const pair = `${prev ?? ''}${ch}`;
    if (pair === 'ff') px -= 2;
    if (pair === 'fi') px -= 1;
    if (pair === 'yo') px -= 1;
    if (pair === 'o.') px -= 0.5;
    if (pair === '-y') px -= 0.4;
    if (lliga && pair === `l${DOT}`) px -= 1.3;
  });
  return (px * sizeOf(font)) / 10;
}

/** The language of the page the layout runs on: what a context left at
 *  `inherit` measures in. */
let host = 'en';
class MeasureContext {
  font = '10px Punt';
  lang = 'inherit';
  direction = 'ltr';
  measureText(s: string): { width: number } {
    return { width: faceWidth(s, this.font, this.lang === 'inherit' ? host : this.lang) };
  }
}
const globals = globalThis as unknown as { OffscreenCanvas: unknown; OffscreenCanvasRenderingContext2D: unknown };
globals.OffscreenCanvasRenderingContext2D = MeasureContext;
globals.OffscreenCanvas = class {
  getContext(): MeasureContext {
    return new MeasureContext();
  }
};

const PUNT = '10px Punt';
const LLIGA = '10px Lliga';
const HYPHEN = 3;
/** The width of `text` painted alone in `lang`, to a thousandth. */
const ink = (text: string, lang: string, font = PUNT): number => faceWidth(text, font, lang);
const round = (n: number): number => Math.round(n * 1000) / 1000;

type Mode = { language: string | undefined; locale: string };
const DOCUMENT_CA: Mode = { language: 'ca', locale: 'ca' };
const HOST_CA: Mode = { language: undefined, locale: 'ca' };
const DOCUMENT_EN: Mode = { language: 'en', locale: 'en-us' };
const HOST_EN: Mode = { language: undefined, locale: 'en-us' };

/** The two breakers: line by line, and Knuth–Plass on a justified text. */
const GREEDY: MeasureBlockOptions = { textAlign: 'left', hyphenate: true };
const OPTIMAL: MeasureBlockOptions = { textAlign: 'justify', hyphenate: true, optimal: true };

function lay(text: string, width: number, mode: Mode, options: MeasureBlockOptions, font = PUNT): VDTLine[] {
  setHyphenationLocale(mode.locale as never);
  setMeasureLanguage(mode.language);
  return measureRichBlock([{ text, bold: false, italic: false }], font, font, font, font, width, 14, options).lines;
}
const words = (line: VDTLine): VDTLineSegment[] => (line.segments ?? []).filter((s) => s.kind === 'text');
/** The text pieces a line carries, each with its width to a thousandth. */
const pieces = (line: VDTLine): [string, number][] => words(line).map((s) => [s.text, round(s.width)]);
/** The pieces a line opens with up to its first space, joined: the rest
 *  of the word broken at the line before, and its width. */
function opening(line: VDTLine): [string, number] {
  let text = '';
  let width = 0;
  for (const s of line.segments ?? []) {
    if (s.kind === 'space') break;
    text += s.text;
    width += s.width;
  }
  return [text, round(width)];
}
/** The pieces a line ends on, back to its last space, joined. */
function closing(line: VDTLine): [string, number] {
  const segs = line.segments ?? [];
  let text = '';
  let width = 0;
  for (let i = segs.length - 1; i >= 0 && segs[i]!.kind !== 'space'; i--) {
    text = segs[i]!.text + text;
    width += segs[i]!.width;
  }
  return [text, round(width)];
}

beforeEach(() => {
  host = 'en';
  clearMeasurementCache();
});
afterEach(() => {
  setMeasureLanguage(undefined);
  setHyphenationLocale('en-us');
});

describe.each([['line by line', GREEDY], ['Knuth–Plass', OPTIMAL]])('a word broken at a line end, %s', (_name, options) => {
  it('the rest of a Catalan word broken inside its l·l is as wide as the text painted', () => {
    // `instal·lar` is 51 px whole in Catalan (the dot 6 px between its two
    // `l`) and `instal·` 32.5 px: the rest was 18.5 px for `lar`, 15 px.
    const text = `aa instal${DOT}lar bb cc`;
    const own = lay(text, 47, DOCUMENT_CA, options);
    expect(own.map((l) => l.text)).toEqual(['aa instal-', 'lar bb cc']);
    expect(opening(own[1]!)).toEqual(['lar', ink('lar', 'ca')]);
    expect(opening(own[1]!)[1]).toBe(15);
    // On a Catalan page a document that keeps the host's language is
    // measured in Catalan too, and keeps the rest it had: what the word
    // grew by, the wide dot in it.
    host = 'ca';
    clearMeasurementCache();
    const kept = lay(text, 47, HOST_CA, options);
    expect(kept.map((l) => l.text)).toEqual(['aa instal-', 'lar bb cc']);
    expect(opening(kept[1]!)).toEqual(['lar', 18.5]);
  });

  it('the breaker counts the rest at the width painted: a line it fits is set', () => {
    // `lar bb cc dd` is 52.5 px as painted and fits a measure of 54; with
    // the rest at 18.5 px it was 56 px, and `dd` went down.
    const text = `aa instal${DOT}lar bb cc dd`;
    host = 'ca';
    clearMeasurementCache();
    expect(lay(text, 54, DOCUMENT_CA, options).map((l) => l.text)).toEqual(['aa instal-', 'lar bb cc dd']);
    expect(lay(text, 54, HOST_CA, options).length).toBeGreaterThan(2);
  });

  it('a ligature undone by the break is not kept in the rest', () => {
    // `office` 27 px (ffi), `of` 10: the rest was 17 px for `fice`, 19 px.
    const text = `aa of${SHY}fice bb`;
    const own = lay(text, 27, DOCUMENT_EN, options);
    expect(own.map((l) => l.text)).toEqual(['aa of-', 'fice', 'bb']);
    expect(opening(own[1]!)).toEqual(['fice', 19]);
    expect(closing(own[0]!)).toEqual(['of-', ink('of', 'en') + HYPHEN]);
    const host = lay(text, 27, HOST_EN, options);
    expect(host.map((l) => l.text)).toEqual(['aa of-', 'fice', 'bb']);
    expect(opening(host[1]!)).toEqual(['fice', 17]);
    expect(closing(host[0]!)).toEqual(['of-', 13]);
  });

  it('the head of a break inside an l·l is the text before the dot and its hyphen', () => {
    // Lliga ligates `l·`: `col·` is 16.2 px and the dot alone 2.5, so the
    // head was 13.7 px and its hyphen for `col`, 15 px.
    const text = `aa col${DOT}lecció bb`;
    const own = lay(text, 32, DOCUMENT_CA, options, LLIGA);
    expect(own[0]!.text).toBe('aa col-');
    expect(closing(own[0]!)).toEqual(['col-', ink('col', 'ca', LLIGA) + HYPHEN]);
    expect(closing(own[0]!)[1]).toBe(18);
    const host = lay(text, 32, HOST_CA, options, LLIGA);
    expect(host[0]!.text).toBe('aa col-');
    expect(closing(host[0]!)[1]).toBe(16.7);
  });

  it('the pieces of the rest are as wide as that rest grows by them', () => {
    // `official` broken after `of`: the next line opens with `ficial`,
    // 29 px, whose `fi` is 9 px (7 px as a piece of `offi`).
    const text = `aa of${SHY}fi${SHY}cial bb`;
    const own = lay(text, 31, DOCUMENT_EN, options);
    expect(own.map((l) => l.text)).toEqual(['aa of-', 'ficial', 'bb']);
    expect(opening(own[1]!)).toEqual(['ficial', ink('ficial', 'en')]);
    if (options.optimal) expect(pieces(own[1]!)).toEqual([['fi', 9], ['cial', 20]]);
    const host = lay(text, 31, HOST_EN, options);
    expect(opening(host[1]!)).toEqual(['ficial', 27]);
    if (options.optimal) expect(pieces(host[1]!)).toEqual([['fi', 7], ['cial', 20]]);
  });

  it('a rest that breaks again: the line it leaves is its own text and a hyphen', () => {
    // `efficient` over three lines: `ef-`, `fi-`, `cient`. The middle one
    // was 7 px and a hyphen (what `effi` grew by after `ef`), for `fi`, 9.
    const text = `aa ef${SHY}fi${SHY}cient bb`;
    const own = lay(text, 26, DOCUMENT_EN, options);
    expect(own.map((l) => l.text)).toEqual(['aa ef-', 'fi-', 'cient', 'bb']);
    expect(closing(own[1]!)).toEqual(['fi-', ink('fi', 'en') + HYPHEN]);
    expect(opening(own[2]!)).toEqual(['cient', 25]);
    const host = lay(text, 26, HOST_EN, options);
    expect(host.map((l) => l.text)).toEqual(['aa ef-', 'fi-', 'cient', 'bb']);
    expect(closing(host[1]!)).toEqual(['fi-', 10]);
  });

  it('the rest of an address divided at a joint', () => {
    // `www.oo.oo.oo` cut before its second dot: the pair `o.` is kerned
    // 0.5 px, and the rest was that much narrower than `.oo.oo` alone.
    const text = 'aa www.oo.oo.oo';
    const own = lay(text, 40, DOCUMENT_EN, options);
    expect(own.map((l) => l.text)).toEqual(['aa www.oo', '.oo.oo']);
    expect(opening(own[1]!)).toEqual(['.oo.oo', ink('.oo.oo', 'en')]);
    expect(opening(own[1]!)[1]).toBe(23.5);
    const host = lay(text, 40, HOST_EN, options);
    expect(opening(host[1]!)).toEqual(['.oo.oo', 23]);
  });

  it('a compound that repeats its hyphen: the rest is measured with it', () => {
    const text = 'aa yoyo-yoyo bb';
    const repeat = { ...options, repeatHyphen: true };
    const own = lay(text, 36, DOCUMENT_EN, repeat);
    expect(own.map((l) => l.text)).toEqual(['aa yoyo-', '-yoyo bb']);
    expect(opening(own[1]!)).toEqual(['-yoyo', round(ink('-yoyo', 'en'))]);
    expect(closing(own[0]!)).toEqual(['yoyo-', ink('yoyo-', 'en')]);
  });

  it('a word that stays on its line keeps the pieces it had: they add up to the word', () => {
    const text = `An of${SHY}fice and an of${SHY}fi${SHY}cial`;
    for (const mode of [DOCUMENT_EN, HOST_EN]) {
      const lines = lay(text, 400, mode, options);
      expect(lines).toHaveLength(1);
      const all = pieces(lines[0]!);
      if (options.optimal) expect(all).toEqual([['An', 10], ['of', 10], ['fice', 17], ['and', 15], ['an', 10], ['of', 10], ['fi', 7], ['cial', 20]]);
      else expect(all).toEqual([['An', 10], ['office', 27], ['and', 15], ['an', 10], ['official', 37]]);
    }
  });
});

describe('a word wider than its line', () => {
  it('is divided, and what is left is measured from the cut on', () => {
    // No syllable here: the word is cut at the last character that fits,
    // between a `y` and the `o` it is kerned to.
    const lines = lay('oyoyoyoyoy', 22.5, DOCUMENT_EN, { textAlign: 'left', hyphenate: false });
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 0; i < lines.length; i++) {
      const [text, width] = closing(lines[i]!);
      const body = lines[i]!.hyphenated && text.endsWith('-') ? text.slice(0, -1) : text;
      expect([text, width]).toEqual([text, round(ink(body, 'en') + (body === text ? 0 : HYPHEN))]);
    }
    expect(lines.map((l) => closing(l))).toEqual([['oyoy-', 22], ['oy-', 13], ['oyoy', 19]]);
    // In the host's language the rest is the word less its head: the pair
    // kerned across each cut stays in it, and the last line is 1 px short
    // of the text it paints for each of the two cuts.
    const host = lay('oyoyoyoyoy', 22.5, HOST_EN, { textAlign: 'left', hyphenate: false });
    expect(host.map((l) => closing(l))).toEqual([['oyoy-', 22], ['oy-', 13], ['oyoy', 17]]);
  });

  it('an address in a Chinese paragraph, cut at a joint by the composer', () => {
    const text = '中文 www.oo.oo.oo 中文';
    const own = lay(text, 52, { language: 'zh-Hans', locale: 'en-us' }, { textAlign: 'left' });
    const at = own.findIndex((l) => l.text.startsWith('.oo'));
    expect(at).toBeGreaterThan(0);
    const rest = words(own[at]!)[0]!;
    expect(rest.text.startsWith('.oo')).toBe(true);
    expect(round(rest.width)).toBe(round(ink(rest.text, 'zh-Hans')));
    const host = lay(text, 52, { language: undefined, locale: 'en-us' }, { textAlign: 'left' });
    expect(host.map((l) => l.text)).toEqual(own.map((l) => l.text));
    expect(round(words(host[at]!)[0]!.width)).toBe(round(ink(rest.text, 'en') - 0.5));
  });
});
