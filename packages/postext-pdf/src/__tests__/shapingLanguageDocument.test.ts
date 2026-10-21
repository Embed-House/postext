import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument, VDTLine } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';
import { loadComplexShaper, shapeRun } from '../complexShaping.js';

// #764, end to end: a document is laid out by a measurer that shapes in
// the language the engine sets on it (`ctx.lang`), as a browser's canvas
// does, and its PDF prints every word where the layout put it, as wide as
// it was measured. Noto Serif SC draws its digits, its dash and its ASCII
// quotes otherwise in Chinese; Alegreya its `l·l` in Catalan.

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const FACES: Record<string, Uint8Array> = {
  Song: fixture('cjk/noto-serif-sc-language.ttf'),
  Alegreya: fixture('latin/alegreya-language.ttf'),
};
const fontProvider = async (family: string) => FACES[family] ?? FACES.Song!;

/** The languages the engine set on the measuring contexts. */
const languagesSet = new Set<string>();

/**
 * Measures as Chrome 154's canvas does, with HarfBuzz. A string with no
 * character above U+00FF is Latin text, whatever it holds. Any other is
 * cut at its spaces and around each Han character, and each piece shaped
 * in the script of its first character that has one (the default script
 * for a piece with none). Every piece in the context's language.
 *
 * `font` and `lang` are accessors of the class, which is the global
 * context class, as in a browser: the engine finds the context its text
 * library measures plain paragraphs with by the `font` it sets, and gives
 * it the language too.
 */
class CanvasCtx {
  direction = 'ltr';
  letterSpacing = '0px';
  private fontString = '';
  private language = 'inherit';
  get font(): string {
    return this.fontString;
  }
  set font(value: string) {
    this.fontString = value;
  }
  get lang(): string {
    return this.language;
  }
  set lang(value: string) {
    this.language = value;
    languagesSet.add(value);
  }
  measureText(s: string): { width: number } {
    const parsed = parseFontString(this.fontString);
    const bytes = FACES[parsed?.family ?? ''] ?? FACES.Song!;
    const language = this.language === 'inherit' ? undefined : this.language;
    const latin = /^[\u0000-\u00FF]*$/.test(s);
    let advance = 0;
    for (const piece of latin ? [s] : s.split(/( |\p{Script=Han})/u)) {
      if (piece === '') continue;
      const run = shapeRun(bytes, piece, { direction: 'ltr', ...(language ? { language } : {}), ...(latin ? { script: 'Latn' } : {}) });
      advance += run ? run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) / run.upem : piece.length * 0.5;
    }
    return { width: advance * (parsed?.sizePx ?? 16) };
  }
}
const host = globalThis as unknown as { OffscreenCanvas: unknown; OffscreenCanvasRenderingContext2D: unknown };
host.OffscreenCanvasRenderingContext2D = CanvasCtx;
host.OffscreenCanvas = class {
  getContext(): CanvasCtx {
    return new CanvasCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const SIZE = 20;
const EM = SIZE / 1000;
function config(locale: string, fontFamily: string, shapingLanguage?: 'host'): PostextConfig {
  return {
    page: { width: pt(700), height: pt(300), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
    locale,
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    bodyText: { fontFamily, fontSize: pt(SIZE), lineHeight: pt(36), firstLineIndent: pt(0), textAlign: 'left', hyphenation: { enabled: false }, ...(shapingLanguage ? { shapingLanguage } : {}) },
  };
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
interface Box {
  text: string;
  left: number;
  right: number;
}
/** The words of the PDF's first page with their boxes, px at 72 dpi. */
function wordBoxes(bytes: Uint8Array): Box[] {
  const file = path.join(os.tmpdir(), `postext-document-language-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  const xml = execFileSync('pdftotext', ['-bbox', '-l', '1', file, '-'], { encoding: 'utf8' });
  fs.unlinkSync(file);
  return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
    .map((m) => ({ text: m[3]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'), left: Number(m[1]), right: Number(m[2]) }));
}
const firstLine = (doc: VDTDocument): VDTLine => doc.pages[0]!.columns[0]!.blocks[0]!.lines[0]!;
/** The words of a line as the layout placed them: what stands between
 *  two spaces is one word, as pdftotext reads it. */
function wordPlaces(line: VDTLine): Box[] {
  const places: Box[] = [];
  let x = line.bbox.x;
  let open: Box | undefined;
  for (const seg of line.segments!) {
    if (seg.kind === 'space') open = undefined;
    else if (open) {
      open.text += seg.text;
      open.right = x + seg.width;
    } else {
      open = { text: seg.text, left: x, right: x + seg.width };
      places.push(open);
    }
    x += seg.width;
  }
  return places;
}
/** The width the layout gave each text of a line, thousandths of the em. */
const widthsOf = (line: VDTLine): Record<string, number> => Object.fromEntries(line.segments!.filter((s) => s.kind !== 'space').map((s) => [s.text, Math.round(s.width / EM)]));
/** Each word of the PDF against its place: both ends, to a hundredth of a
 *  pixel and a half (pdftotext rounds to six decimals of a point). */
function expectInPlace(boxes: Box[], places: Box[]): void {
  expect(boxes.map((b) => b.text)).toEqual(places.map((p) => p.text));
  boxes.forEach((box, i) => {
    expect(box.left, `${box.text} left`).toBeCloseTo(places[i]!.left, 1);
    expect(box.right, `${box.text} right`).toBeCloseTo(places[i]!.right, 1);
  });
}

beforeAll(async () => {
  await loadComplexShaper();
});

const DASH = '\u2014';
const ELLIPSIS = '\u2026';
// A reference of a Chinese book: a year, a quoted letter, the Chinese
// dash, a DOI, a year after a dash of its word, the Chinese ellipsis.
const NOTE = `GDP 2026 "n" ${DASH}${DASH} 10.1006/ 2001 ${ELLIPSIS}${ELLIPSIS} (1) a${DASH}2001 n`;

describe('a Chinese document, measured and printed in Chinese (#764)', () => {
  it('the layout measures in the document\u2019s language: the Chinese digits, quotes and dash of the face', () => {
    languagesSet.clear();
    const widths = widthsOf(firstLine(buildDocument({ markdown: NOTE }, config('zh-Hans', 'Song'))));
    expect([...languagesSet]).toContain('zh-Hans');
    // Chrome's widths, in Chinese: 2026 is 223.1 px at 100 px (220 in
    // English), "n" 39.2 + 66.1 + 39.2 (37.6 for each quote in English,
    // kerned against the letter), 10.1006/ 385 (397.9), 2001 beside a
    // Latin letter 214.3 (220), and the dash after a Latin letter a full
    // em (0.89 em in English).
    expect(widths).toEqual({ GDP: 2126, 2026: 2231, '"n"': 1445, [`${DASH}${DASH}`]: 1692, '10.1006/': 3850, 2001: 2143, [`${ELLIPSIS}${ELLIPSIS}`]: 2000, '(1)': 1199, [`a${DASH}`]: 1557, n: 661 });
    // The same sentence in a document in a language the face has no forms
    // for.
    const english = widthsOf(firstLine(buildDocument({ markdown: NOTE }, config('en', 'Song'))));
    expect(english).toMatchObject({ 2026: 2200, '"n"': 1339, '10.1006/': 3979, 2001: 2200, '(1)': 1278, [`a${DASH}`]: 1439 });
  });

  it.skipIf(!hasPdftotext)('the PDF prints each word in its place, as wide as it was measured', async () => {
    for (const locale of ['zh-Hans', 'zh-CN', 'zh-Hant', 'en', 'ja']) {
      const doc = buildDocument({ markdown: NOTE }, config(locale, 'Song'));
      const places = wordPlaces(firstLine(doc));
      expect(places.map((p) => p.text), locale).toEqual(['GDP', '2026', '"n"', `${DASH}${DASH}`, '10.1006/', '2001', `${ELLIPSIS}${ELLIPSIS}`, '(1)', `a${DASH}2001`, 'n']);
      expectInPlace(wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false })), places);
    }
  }, 60_000);

  it.skipIf(!hasPdftotext)('a line of Han with a year, the dash and quotes ends where the layout ends it', async () => {
    const han = '\u4E2D\u65E5\u672C2026\u5E741\u6708\u2014\u2014"\u597D"\u2026\u2026\u4E00\u5E74';
    const doc = buildDocument({ markdown: han }, config('zh-Hans', 'Song'));
    const line = firstLine(doc);
    expect(line.cjkComposed).toBe(true);
    const widths = widthsOf(line);
    // The year and the quotes are Latin text in Chinese.
    expect(widths).toMatchObject({ 2026: 2231, 1: 471, '"': 392 });
    const boxes = wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false }));
    expect(boxes.map((b) => b.text)).toEqual([han]);
    expect(boxes[0]!.left).toBeCloseTo(line.bbox.x, 1);
    expect(boxes[0]!.right).toBeCloseTo(line.bbox.x + line.segments!.reduce((sum, s) => sum + s.width, 0), 1);
  }, 60_000);

  it.skipIf(!hasPdftotext)('a run in a language of its own is measured and printed in it', async () => {
    const doc = buildDocument({ markdown: 'GDP 2026 :ltr[2026 "n"]{lang=en} 2026' }, config('zh-Hans', 'Song'));
    const line = firstLine(doc);
    const words = line.segments!.filter((s) => s.kind !== 'space');
    expect(words.map((s) => [s.text, s.lang, Math.round(s.width / EM)])).toEqual([['GDP', undefined, 2126], ['2026', undefined, 2231], ['2026', 'en', 2200], ['"n"', 'en', 1339], ['2026', undefined, 2231]]);
    expectInPlace(wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false })), wordPlaces(line));
  }, 60_000);
});

describe('a document that keeps the host\u2019s language (#764)', () => {
  it.skipIf(!hasPdftotext)('is measured in no language and printed as before', async () => {
    languagesSet.clear();
    const doc = buildDocument({ markdown: NOTE }, config('zh-Hans', 'Song', 'host'));
    // The engine leaves the context its own language.
    expect([...languagesSet].filter((l) => l !== 'inherit')).toEqual([]);
    const line = firstLine(doc);
    // What a page in a language the face has no forms for, or a worker,
    // measures: the widths of the English document above.
    const widths = widthsOf(line);
    expect(widths).toEqual({ GDP: 2126, 2026: 2200, '"n"': 1339, [`${DASH}${DASH}`]: 1692, '10.1006/': 3979, 2001: 2200, [`${ELLIPSIS}${ELLIPSIS}`]: 2000, '(1)': 1278, [`a${DASH}`]: 1439, n: 661 });
    // The advances postext-pdf 1.28 gave this page, which it still gives:
    // no language, each word with no letter in its script.
    const boxes = wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false }));
    const advances = Object.fromEntries(boxes.map((b) => [b.text, Math.round((b.right - b.left) / EM)]));
    expect(advances).toEqual({ GDP: 2126, 2026: 2200, '"n"': 1339, [`${DASH}${DASH}`]: 1692, '10.1006/': 3979, 2001: 2200, [`${ELLIPSIS}${ELLIPSIS}`]: 2000, '(1)': 1278, [`a${DASH}2001`]: 3639, n: 661 });
    expectInPlace(boxes, wordPlaces(line));
  }, 60_000);
});

describe('a Catalan document (#764)', () => {
  // `l·l` is 0.576 em wide in Catalan and 0.726 em otherwise (Chrome).
  const WORDS = 'ale l\u00B7l fil';

  it.skipIf(!hasPdftotext)('sets l\u00B7l in the Catalan form of its face, where it was measured', async () => {
    const doc = buildDocument({ markdown: WORDS }, config('ca', 'Alegreya'));
    expect(widthsOf(firstLine(doc))).toEqual({ ale: 1158, 'l\u00B7l': 576, fil: 831 });
    expectInPlace(wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false })), wordPlaces(firstLine(doc)));
    const spanish = buildDocument({ markdown: WORDS }, config('es', 'Alegreya'));
    expect(widthsOf(firstLine(spanish))).toEqual({ ale: 1158, 'l\u00B7l': 726, fil: 831 });
    expectInPlace(wordBoxes(await renderToPdf(spanish, { fontProvider, accessible: false })), wordPlaces(firstLine(spanish)));
    // In Turkish f and i stay apart.
    const turkish = buildDocument({ markdown: WORDS }, config('tr', 'Alegreya'));
    expect(widthsOf(firstLine(turkish))).toEqual({ ale: 1158, 'l\u00B7l': 726, fil: 856 });
    expectInPlace(wordBoxes(await renderToPdf(turkish, { fontProvider, accessible: false })), wordPlaces(firstLine(turkish)));
  }, 60_000);

  it.skipIf(!hasPdftotext)('a Catalan name in a Spanish document, and one in a document that keeps the host\u2019s language', async () => {
    const doc = buildDocument({ markdown: 'ale :ltr[l\u00B7l]{lang=ca} l\u00B7l' }, config('es', 'Alegreya'));
    const line = firstLine(doc);
    expect(line.segments!.filter((s) => s.kind !== 'space').map((s) => [s.lang, Math.round(s.width / EM)])).toEqual([[undefined, 1158], ['ca', 576], [undefined, 726]]);
    expectInPlace(wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false })), wordPlaces(line));
    // The host's language: measured in none, printed in none.
    const host = buildDocument({ markdown: WORDS }, config('ca', 'Alegreya', 'host'));
    expect(widthsOf(firstLine(host))).toEqual({ ale: 1158, 'l\u00B7l': 726, fil: 831 });
    expectInPlace(wordBoxes(await renderToPdf(host, { fontProvider, accessible: false })), wordPlaces(firstLine(host)));
  }, 60_000);
});
