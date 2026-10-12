import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDocument, lineRuns, resolveParagraph } from 'postext';
import type { PostextConfig, VDTBlock, VDTDocument, VDTLine, VDTPage } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';
import { loadComplexShaper, shapeRun } from '../complexShaping';

// #764, end to end, in the faces the page review found off: an Arabic
// paragraph with quotations in guillemets, brackets and full stops in
// Markazi Text and in Amiri, and a justified Catalan paragraph with `l·l`
// words in Crimson Pro. The document is laid out by a measurer that
// shapes as Chrome 154's canvas does (see `shapingLanguageRuns.test.ts`,
// which holds Chrome's own widths of these files), in the language and
// the direction the engine sets on it, and its PDF prints every word
// where the layout put it.

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/fontsource/${name}`, import.meta.url)));
/** The files of each family, as Fontsource cuts it: `latin`, then
 *  `arabic`. */
const FACES: Record<string, Uint8Array[]> = {
  'Markazi Text': [fixture('markazi-text-latin.ttf'), fixture('markazi-text-arabic.ttf')],
  Amiri: [fixture('amiri-latin.ttf'), fixture('amiri-arabic.ttf')],
  'Crimson Pro': [fixture('crimson-pro-latin.ttf')],
};
const fontProvider = async (family: string) => FACES[family] ?? FACES.Amiri!;

/** The file the browser takes a character from: the `arabic` one for the
 *  Arabic blocks (its `unicode-range`), the `latin` one for the rest. */
const fileOf = (files: Uint8Array[], cp: number): Uint8Array => (files.length > 1 && cp >= 0x0600 && cp <= 0x08FF ? files[1]! : files[0]!);
const SCRIPTS: readonly [string, RegExp][] = [['Arab', /\p{Script=Arabic}/u], ['Latn', /\p{Script=Latin}/u], ['Grek', /\p{Script=Greek}/u], ['Cyrl', /\p{Script=Cyrillic}/u]];
const scriptOfLetter = (ch: string): string | undefined => SCRIPTS.find(([, re]) => re.test(ch))?.[0];

/** The advance (em) of one word of a run, as Chrome shapes it: each
 *  character in the script of the letter before it in the word, else of
 *  the first after it (none for a word with no letter; `latin`: the whole
 *  string had no character above U+00FF, and is Latin text), then cut by
 *  the file that draws it. */
function wordAdvance(files: Uint8Array[], word: string, rtl: boolean, language: string | undefined, latin: boolean): number {
  const chars = [...word];
  const own = chars.map((ch) => (latin ? 'Latn' : scriptOfLetter(ch)));
  const first = own.find((s) => s !== undefined);
  let before: string | undefined;
  const scripts = own.map((s) => (before = s ?? before) ?? first);
  let advance = 0;
  for (let a = 0; a < chars.length;) {
    const file = fileOf(files, chars[a]!.codePointAt(0)!);
    let b = a + 1;
    while (b < chars.length && scripts[b] === scripts[a] && fileOf(files, chars[b]!.codePointAt(0)!) === file) b++;
    const script = scripts[a];
    const run = shapeRun(file, chars.slice(a, b).join(''), { direction: rtl ? 'rtl' : 'ltr', ...(script ? { script } : {}), ...(language ? { language } : {}) });
    advance += run ? run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) / run.upem : (b - a) * 0.5;
    a = b;
  }
  return advance;
}

/** The strings the engine measured, each with the context's direction. */
const measured = new Set<string>();

/**
 * Measures as Chrome 154's canvas does, with HarfBuzz: the string cut
 * into runs of one direction (UAX #9, in the context's `direction`), each
 * run into words at its spaces, each word shaped in the script of its
 * letters and the context's language.
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
  }
  measureText(s: string): { width: number } {
    const parsed = parseFontString(this.fontString);
    const files = FACES[parsed?.family ?? ''] ?? FACES.Amiri!;
    const language = this.language === 'inherit' || this.language === '' ? undefined : this.language;
    const latin = /^[\u0000-\u00FF]*$/.test(s);
    measured.add(`${this.direction} ${s}`);
    let advance = 0;
    for (const run of lineRuns(resolveParagraph(s, this.direction === 'rtl' ? 'rtl' : 'ltr'))) {
      for (const word of s.slice(run.start, run.end).split(/( )/)) {
        if (word !== '') advance += wordAdvance(files, word, (run.level & 1) === 1, language, latin);
      }
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
const PAGE = 420;
const MARGIN = 20;
function config(locale: string, fontFamily: string, bodyText: Partial<PostextConfig['bodyText']> = {}): PostextConfig {
  return {
    page: { width: pt(PAGE), height: pt(400), dpi: 72, margins: { top: pt(MARGIN), bottom: pt(MARGIN), left: pt(MARGIN), right: pt(MARGIN) } },
    locale,
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    bodyText: { fontFamily, fontSize: pt(SIZE), lineHeight: pt(36), firstLineIndent: pt(0), textAlign: 'justify', hyphenation: { enabled: false }, shapingLanguage: 'document', ...bodyText },
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
  left: number;
  right: number;
}
/** What pdftotext reads as words on each line of the PDF's first page,
 *  px at 72 dpi. It cuts a word where its font changes, and at a letter
 *  that leaves air before the next: a word may come in several boxes. */
function wordBoxes(bytes: Uint8Array): Box[][] {
  const file = path.join(os.tmpdir(), `postext-language-runs-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  const xml = execFileSync('pdftotext', ['-bbox', '-l', '1', file, '-'], { encoding: 'utf8' });
  fs.unlinkSync(file);
  const lines = new Map<number, Box[]>();
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">/g)) {
    const y = Math.round(Number(m[2]));
    const key = [...lines.keys()].find((k) => Math.abs(k - y) < 8) ?? y;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push({ left: Number(m[1]), right: Number(m[3]) });
  }
  return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, boxes]) => boxes);
}
const firstBlock = (doc: VDTDocument): VDTBlock => doc.pages[0]!.columns[0]!.blocks[0]!;
/**
 * The words of a line as the layout placed them, on the sheet: its
 * segments in the order the line gives (flow order), from the line's
 * start, the spaces of a justified line that is not its paragraph's last
 * stretched to fill the measure; what stands between two spaces is one
 * word. A right-to-left page is the mirror of its flow.
 */
function wordPlaces(page: VDTPage, block: VDTBlock, line: VDTLine): Box[] {
  const segments = line.segments!;
  const measure = PAGE - 2 * MARGIN - (line.bbox.x - MARGIN);
  const spaces = segments.filter((s) => s.kind === 'space').length;
  const words = segments.reduce((sum, s) => sum + (s.kind === 'space' ? 0 : s.width), 0);
  const space = block.textAlign === 'justify' && !line.isLastLine && spaces > 0 ? (measure - words) / spaces : undefined;
  const places: Box[] = [];
  let x = line.bbox.x;
  let open: Box | undefined;
  for (const i of line.order ?? segments.map((_, k) => k)) {
    const seg = segments[i]!;
    const width = seg.kind === 'space' ? space ?? seg.width : seg.width;
    if (seg.kind === 'space') open = undefined;
    else if (open) open.right = x + width;
    else {
      open = { left: x, right: x + width };
      places.push(open);
    }
    x += width;
  }
  const flow = page.flow;
  const originX = flow && flow.writingMode === 'horizontal-tb' && flow.direction === 'rtl' ? flow.mirror.originX : undefined;
  return originX === undefined ? places : places.map((p) => ({ left: originX - p.right, right: originX - p.left }));
}
/** Every word of the PDF against its place: the boxes pdftotext read
 *  inside a place start where it starts and end where it ends, to a
 *  twentieth of a pixel, and no box lies outside every place. With
 *  `whole`, a place holds one box: pdftotext cuts no Latin word that has
 *  no hole in it. */
async function expectInPlace(doc: VDTDocument, what: string, whole = false): Promise<void> {
  const boxes = wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false }));
  const block = firstBlock(doc);
  expect(boxes.length, what).toBe(block.lines.length);
  block.lines.forEach((line, n) => {
    const places = wordPlaces(doc.pages[0]!, block, line);
    const inside = places.map((place) => boxes[n]!.filter((box) => (box.left + box.right) / 2 > place.left && (box.left + box.right) / 2 < place.right));
    expect(inside.reduce((sum, list) => sum + list.length, 0), `${what} line ${n + 1}: ${line.text}`).toBe(boxes[n]!.length);
    places.forEach((place, i) => {
      expect(inside[i]!.length, `${what} line ${n + 1} word ${i + 1}`).toBeGreaterThan(0);
      if (whole) expect(inside[i]!.length, `${what} line ${n + 1} word ${i + 1} in one piece`).toBe(1);
      expect(Math.min(...inside[i]!.map((box) => box.left)), `${what} line ${n + 1} word ${i + 1} left`).toBeCloseTo(place.left, 1);
      expect(Math.max(...inside[i]!.map((box) => box.right)), `${what} line ${n + 1} word ${i + 1} right`).toBeCloseTo(place.right, 1);
    });
  });
}
/** The width the layout gave each text, thousandths of the em. */
const widthsOf = (doc: VDTDocument): Record<string, number> =>
  Object.fromEntries(firstBlock(doc).lines.flatMap((line) => line.segments!.filter((s) => s.kind !== 'space').map((s) => [s.text, Math.round((s.width / EM) * 10) / 10])));

beforeAll(async () => {
  await loadComplexShaper();
});

// An Arabic paragraph: «…» quotations, a bracketed aside, full stops, a
// question mark inside a quotation.
const ARABIC = '\u0642\u0644\u062A: \u00AB\u0623\u0646\u0627 \u064A\u0627 \u062E\u0627\u0644\u0629.\u00BB \u062B\u0645 \u0645\u0634\u064A\u062A (\u0648\u064A\u0642\u0627\u0644 \u0633\u0627\u0641\u0631\u062A) \u0625\u0644\u0649 \u0627\u0644\u0628\u064A\u0648\u062A. \u00AB\u064A\u0648\u0633\u0641\u061F\u00BB \u0643\u062A\u0627\u0628.';
// Set from its start side: a justified Arabic line takes kashidas.
const fromStart = { textAlign: 'left' } as const;

describe('an Arabic paragraph with quotations, brackets and full stops (#764)', () => {
  it('Markazi Text: the layout measures the guillemets and the stops of Arabic text in Arabic', () => {
    measured.clear();
    const widths = widthsOf(buildDocument({ markdown: ARABIC }, config('ar', 'Markazi Text', fromStart)));
    // Each word as a right-to-left run, as it is painted.
    expect([...measured]).toContain('rtl \u00AB\u0623\u0646\u0627');
    // Chrome's widths of these words in Arabic.
    expect(widths).toMatchObject({ '\u00AB\u0623\u0646\u0627': 939.5, '\u062E\u0627\u0644\u0629.\u00BB': 1892.1, '\u0643\u062A\u0627\u0628.': 1708 });
    // In Persian the face has no forms of its own, and the word is still
    // measured as the right-to-left run every output paints (#770): the
    // stop is kerned to the guillemet there (0.582 em; 0.587 when the two
    // were measured as a left-to-right run of their own, up to 1.29.2).
    measured.clear();
    const persian = widthsOf(buildDocument({ markdown: ARABIC }, config('fa', 'Markazi Text', fromStart)));
    expect([...measured]).toContain('rtl \u00AB\u0623\u0646\u0627');
    expect([...measured]).not.toContain('ltr \u00AB\u0623\u0646\u0627');
    expect(persian).toMatchObject({ '\u00AB\u0623\u0646\u0627': 1043.5, '\u062E\u0627\u0644\u0629.\u00BB': 1988.3, '\u0643\u062A\u0627\u0628.': 1714.8 });
  });

  it('Amiri: the stop, the brackets and the guillemets of an Arabic word are the Arabic ones', () => {
    const widths = widthsOf(buildDocument({ markdown: ARABIC }, config('ar', 'Amiri', fromStart)));
    expect(widths).toMatchObject({ '\u00AB\u0623\u0646\u0627': 1068, '\u062E\u0627\u0644\u0629.\u00BB': 2112, '(\u0648\u064A\u0642\u0627\u0644': 2380, '\u0643\u062A\u0627\u0628.': 2040 });
  });

  it.skipIf(!hasPdftotext)('the PDF prints every word where the layout put it, in both faces', async () => {
    for (const family of ['Markazi Text', 'Amiri']) {
      // Not Markazi Text in Persian: its words were measured left to
      // right (see above), five thousandths of the em wider than any
      // output sets `.»`.
      for (const locale of family === 'Amiri' ? ['ar', 'ar-EG', 'fa'] : ['ar', 'ar-EG']) {
        const doc = buildDocument({ markdown: ARABIC }, config(locale, family, fromStart));
        expect(firstBlock(doc).lines.length, `${family} ${locale}`).toBeGreaterThan(1);
        await expectInPlace(doc, `${family} ${locale}`);
      }
    }
  }, 120_000);

  it.skipIf(!hasPdftotext)('and in a document that keeps the host\u2019s language, measured in none', async () => {
    const doc = buildDocument({ markdown: ARABIC }, config('ar', 'Amiri', { ...fromStart, shapingLanguage: 'host' }));
    expect(widthsOf(doc)).toMatchObject({ '\u00AB\u0623\u0646\u0627': 1068, '\u062E\u0627\u0644\u0629.\u00BB': 2112, '\u0643\u062A\u0627\u0628.': 2040 });
    await expectInPlace(doc, 'Amiri host');
    // Markazi Text has no forms of its own in no language.
    expect(widthsOf(buildDocument({ markdown: ARABIC }, config('ar', 'Markazi Text', { ...fromStart, shapingLanguage: 'host' })))['\u00AB\u0623\u0646\u0627']).toBe(1043.5);
  }, 120_000);
});

describe('a justified Catalan paragraph in Crimson Pro (#764)', () => {
  // A paragraph with a word in italics is cut word by word: the pieces of
  // a word are as wide as the word grew by each. A plain one goes to the
  // text library, which measures each piece alone.
  const STYLED = 'La instal\u00B7laci\u00F3 de la il\u00B7luminaci\u00F3 col\u00B7lectiva *fou* una il\u00B7lusi\u00F3 paral\u00B7lela del col\u00B7legi.';
  const PLAIN = STYLED.replace(/\*/g, '');
  const hyphenated = (locale: string): Partial<PostextConfig['bodyText']> => ({ hyphenation: { enabled: true, locale } });
  /** The words of a paragraph: the pieces of each joined, with the width
   *  the layout gave them together. */
  const wordWidths = (doc: VDTDocument): Record<string, number> => {
    const words: Record<string, number> = {};
    for (const line of firstBlock(doc).lines) {
      let text = '';
      let width = 0;
      for (const seg of [...line.segments!, { kind: 'space' as const, text: ' ', width: 0 }]) {
        if (seg.kind !== 'space') {
          text += seg.text;
          width += seg.width;
        } else if (text !== '') {
          words[text] = Math.round((width / EM) * 10) / 10;
          text = '';
          width = 0;
        }
      }
    }
    return words;
  };
  /** Each line ends between two words: the piece that opens a line after
   *  a break inside a word keeps the width the word had beyond the break,
   *  whatever stood before it. */
  const expectNoWordBroken = (doc: VDTDocument): void => {
    for (const line of firstBlock(doc).lines) expect(line.text).not.toMatch(/-$/);
  };

  it('a word cut at its syllables is measured whole in a styled paragraph: the Catalan dot is in the piece after it', () => {
    const doc = buildDocument({ markdown: STYLED }, config('ca', 'Crimson Pro', hyphenated('ca')));
    expectNoWordBroken(doc);
    // Chrome's widths in Catalan (4381.8, 2708 and 2856.4 in any other
    // language).
    expect(wordWidths(doc)).toMatchObject({ 'instal\u00B7laci\u00F3': 4727.5, 'il\u00B7lusi\u00F3': 3053.7, 'col\u00B7legi.': 3430.7 });
    // `tal·` alone has the narrow dot (1292); the 354 units of 1024 the
    // Catalan one adds went to the piece after it, 725.6 wide alone.
    const pieces = firstBlock(doc).lines[0]!.segments!.filter((s) => s.kind !== 'space').map((s) => [s.text, Math.round((s.width / EM) * 10) / 10]);
    expect(pieces.slice(1, 5)).toEqual([['ins', 1191.4], ['tal\u00B7', 1292], ['la', 1071.3], ['ci\u00F3', 1172.9]]);
    const spanish = buildDocument({ markdown: STYLED }, config('es', 'Crimson Pro', hyphenated('es')));
    expect(wordWidths(spanish)).toMatchObject({ 'instal\u00B7laci\u00F3': 4381.8, 'il\u00B7lusi\u00F3': 2708, 'col\u00B7legi.': 3085 });
  });

  it('and piece by piece in a plain paragraph: each as wide as it is alone', () => {
    const doc = buildDocument({ markdown: PLAIN }, config('ca', 'Crimson Pro', hyphenated('ca')));
    expectNoWordBroken(doc);
    const pieces = firstBlock(doc).lines[0]!.segments!.filter((s) => s.kind !== 'space').map((s) => [s.text, Math.round((s.width / EM) * 10) / 10]);
    expect(pieces.slice(1, 5)).toEqual([['ins', 1191.4], ['tal\u00B7', 1292], ['la', 725.6], ['ci\u00F3', 1172.9]]);
  });

  it.skipIf(!hasPdftotext)('the PDF prints each word where the layout put it, as wide as measured: no hole after the dot', async () => {
    for (const markdown of [STYLED, PLAIN]) {
      for (const locale of ['ca', 'es']) {
        const doc = buildDocument({ markdown }, config(locale, 'Crimson Pro', hyphenated(locale)));
        expect(firstBlock(doc).lines.length, locale).toBeGreaterThan(1);
        expectNoWordBroken(doc);
        await expectInPlace(doc, `justified ${locale} ${markdown === STYLED ? 'styled' : 'plain'}`, true);
      }
      // Set ragged, and with no syllables: the words come whole.
      await expectInPlace(buildDocument({ markdown }, config('ca', 'Crimson Pro', { textAlign: 'left' })), 'ragged ca', true);
      await expectInPlace(buildDocument({ markdown }, config('ca', 'Crimson Pro')), 'whole words ca', true);
    }
  }, 120_000);

  it.skipIf(!hasPdftotext)('a document that keeps the host\u2019s language is measured with the plain dot and printed piece by piece', async () => {
    const doc = buildDocument({ markdown: STYLED }, config('ca', 'Crimson Pro', { ...hyphenated('ca'), shapingLanguage: 'host' }));
    expectNoWordBroken(doc);
    expect(wordWidths(doc)).toMatchObject({ 'instal\u00B7laci\u00F3': 4381.8, 'il\u00B7lusi\u00F3': 2708 });
    await expectInPlace(doc, 'host ca', true);
  }, 120_000);
});
