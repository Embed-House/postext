import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument, VDTLineSegment } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';
import { loadComplexShaper, shapeRun } from '../complexShaping.js';
import { shapeInCurrentLanguage, shapingKey, shapingScript, withShapingLanguage, withShapingScript } from '../shapingLanguage.js';
import { textAdvancePx } from '../pdf-backend/primitives.js';

// #725, in a Chinese face. Noto Serif SC draws its digits and its ellipsis
// by script: proportional digits (0.55 em) and three dots on the baseline
// (0.9 em) under `latn`, half-width digits (0.47 em) and three centred
// dots in a full em otherwise. Two cases of the rule meet it:
// - a piece with no letter of a word that has one (`2001` of `GDP—2001`)
//   is painted in the script of its word, where its place was measured;
// - a doubled ellipsis cited in a Latin sentence of a Chinese document is
//   the Chinese mark, set as Han text (`'Hani'`).

const SONG = new Uint8Array(fs.readFileSync(new URL('./fixtures/cjk/noto-serif-sc-vertical.ttf', import.meta.url)));
const fontProvider = async () => SONG;
const ELLIPSIS = '\u2026';
const EM_DASH = '\u2014';

/** Measures as a browser does: each word of the text shaped in one run,
 *  in the script of its first character that has one; a word with no
 *  letter beside its mark is then shaped in the mark's script, and alone
 *  in the font's default forms (as Chrome 131's canvas). The language the
 *  engine sets on the context (`lang`, #764) is the one it shapes in, and
 *  a Han character is shaped apart from what stands beside it, as Chrome
 *  154's canvas does: in Chinese, `——` beside 一 keeps its default form
 *  (1.69 em), which the Chinese one of a Han run (2 em) would replace. */
class HarfBuzzCtx {
  font = '';
  direction = 'ltr';
  letterSpacing = '0px';
  lang = 'inherit';
  measureText(s: string): { width: number } {
    const size = parseFontString(this.font)?.sizePx ?? 16;
    const language = this.lang === 'inherit' ? undefined : this.lang;
    let advance = 0;
    for (const word of s.split(/( |\p{Script=Han})/u)) {
      if (word === '') continue;
      const run = shapeRun(SONG, word, { direction: 'ltr', ...(language ? { language } : {}) });
      advance += run ? run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) / run.upem : word.length * 0.5;
    }
    return { width: advance * size };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): HarfBuzzCtx {
    return new HarfBuzzCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const SIZE = 20;
function config(overrides: Partial<PostextConfig> = {}): PostextConfig {
  return {
    page: { width: pt(560), height: pt(300), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
    locale: 'zh-Hans',
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    // Shaped in its own language, the default (#764, #770): the measure
    // and the PDF take the Chinese forms of the face.
    bodyText: { fontFamily: 'Song', fontSize: pt(SIZE), lineHeight: pt(36), firstLineIndent: pt(0), textAlign: 'left', hyphenation: { enabled: false } },
    ...overrides,
  };
}
const segmentsOf = (doc: VDTDocument): VDTLineSegment[] =>
  doc.pages.flatMap((p) => p.columns.flatMap((c) => c.blocks.flatMap((b) => b.lines.flatMap((l) => l.segments ?? []))));

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
/** The words of the PDF's first page with their boxes, px at 72 dpi. */
function wordBoxes(bytes: Uint8Array): { text: string; left: number; right: number }[] {
  const file = path.join(os.tmpdir(), `postext-script-context-han-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  const xml = execFileSync('pdftotext', ['-bbox', '-l', '1', file, '-'], { encoding: 'utf8' });
  fs.unlinkSync(file);
  return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
    .map((m) => ({ text: m[3]!.replace(/&amp;/g, '&'), left: Number(m[1]), right: Number(m[2]) }));
}

let song: PDFFont;
beforeAll(async () => {
  await loadComplexShaper();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  song = await pdf.embedFont(SONG, { subset: true });
  shapeInCurrentLanguage(song);
});
const advance = (text: string, script?: string): number => withShapingScript(script, () => Math.round(textAdvancePx(song, text, 1000).advance));

describe('the Han script in force (#725)', () => {
  it('is a script the PDF shapes in, with its own entries in every cache', () => {
    expect(withShapingScript('Hani', () => shapingScript())).toBe('Hani');
    expect(withShapingScript('Hani', () => shapingKey('\u2026\u2026'))).not.toBe(withShapingScript('Latn', () => shapingKey('\u2026\u2026')));
    expect(shapingScript()).toBeUndefined();
  });

  it('a doubled ellipsis: two full ems of centred dots as Han text, 1.8 em of baseline dots as Latin', () => {
    const pair = `${ELLIPSIS}${ELLIPSIS}`;
    expect(advance(pair, 'Hani')).toBe(2000);
    expect(advance(pair, 'Latn')).toBe(1800);
    // Other glyphs, not the same ones set closer.
    const face = (song as unknown as { embedder: { font: { layout: (text: string) => { glyphs: { id: number }[] } } } }).embedder.font;
    const ids = (script: string): string => withShapingScript(script, () => face.layout(pair).glyphs.map((g) => g.id).join(','));
    expect(ids('Hani')).not.toBe(ids('Latn'));
    // HarfBuzz agrees.
    const hb = (script: string): number => {
      const run = shapeRun(SONG, pair, { direction: 'ltr', script })!;
      return Math.round((run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) * 1000) / run.upem);
    };
    expect(hb('Hani')).toBe(2000);
    expect(hb('Latn')).toBe(1800);
  });

  it('digits: proportional under Latin, half an em as Han text', () => {
    expect(advance('2001', 'Latn')).toBe(2200);
    expect(advance('2001', 'Hani')).toBe(2143);
    expect(advance('2001')).toBe(2143);
  });
});

describe('a Latin sentence of a Chinese document (#725)', () => {
  // The marks a colophon cites, and a year after a dash of its word.
  const NOTE = `one ${ELLIPSIS}${ELLIPSIS} none GDP${EM_DASH}2001 in ${EM_DASH}${EM_DASH} one`;
  const marked = (doc: VDTDocument): [string, string | undefined][] => segmentsOf(doc).filter((s) => s.scriptContext).map((s) => [s.text, s.scriptContext]);

  it('the layout gives the doubled marks the Han script and the year the script of its word', () => {
    const doc = buildDocument({ markdown: NOTE }, config());
    expect(marked(doc)).toEqual([[`${ELLIPSIS}${ELLIPSIS}`, 'Hani'], ['2001', 'Latn'], [`${EM_DASH}${EM_DASH}`, 'Hani']]);
    const em = SIZE / 1000;
    const widths = Object.fromEntries(segmentsOf(doc).filter((s) => s.scriptContext).map((s) => [s.text, Math.round(s.width / em)]));
    expect(widths[`${ELLIPSIS}${ELLIPSIS}`]).toBe(2000);
    // The year is Latin text in Chinese (#764): the face keeps its own
    // digits there, and sets the proportional ones in any other language.
    expect(widths['2001']).toBe(2143);
    // The PDF's advance in the segment's script and the document's
    // language is the measured width.
    for (const seg of segmentsOf(doc).filter((s) => s.scriptContext)) {
      expect(withShapingLanguage('zh-Hans', () => withShapingScript(seg.scriptContext, () => textAdvancePx(song, seg.text, SIZE).advance)), seg.text).toBeCloseTo(seg.width, 3);
    }
    const english = segmentsOf(buildDocument({ markdown: NOTE }, config({ locale: 'en' }))).find((s) => s.text === '2001')!;
    expect(Math.round(english.width / em)).toBe(2200);
    expect(withShapingLanguage('en', () => withShapingScript('Latn', () => textAdvancePx(song, '2001', SIZE).advance))).toBeCloseTo(english.width, 3);
    // In an English document the ellipsis is the sentence's: Latin.
    expect(marked(buildDocument({ markdown: NOTE }, config({ locale: 'en' })))).toEqual([[`${ELLIPSIS}${ELLIPSIS}`, 'Latn'], ['2001', 'Latn'], [`${EM_DASH}${EM_DASH}`, 'Latn']]);
  });

  it.skipIf(!hasPdftotext)('the PDF prints each where its segment stands, as wide as it was measured', async () => {
    const doc = buildDocument({ markdown: NOTE }, config());
    const boxes = wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false }));
    const line = doc.pages[0]!.columns[0]!.blocks[0]!.lines[0]!;
    let x = line.bbox.x;
    const places: { text: string; left: number; right: number }[] = [];
    for (const seg of line.segments!) {
      if (seg.kind !== 'space') places.push({ text: seg.text, left: x, right: x + seg.width });
      x += seg.width;
    }
    // pdftotext reads a word between two spaces: `GDP—2001` is one.
    const year = places.find((p) => p.text === '2001')!;
    const word = boxes.find((b) => b.text.endsWith('2001'))!;
    expect(word.right).toBeCloseTo(year.right, 0);
    const pair = places.find((p) => p.text === `${ELLIPSIS}${ELLIPSIS}`)!;
    const dots = boxes.find((b) => b.text === `${ELLIPSIS}${ELLIPSIS}`)!;
    expect(dots.left).toBeCloseTo(pair.left, 0);
    expect(dots.right).toBeCloseTo(pair.right, 0);
    expect(pair.right - pair.left).toBeCloseTo(2 * SIZE, 3);
    // Every word after them starts where the layout put it.
    const last = boxes[boxes.length - 1]!;
    expect(last.text).toBe('one');
    expect(last.left).toBeCloseTo(places[places.length - 1]!.left, 0);
  });
});
