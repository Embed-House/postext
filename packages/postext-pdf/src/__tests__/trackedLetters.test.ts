import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { shapeInCurrentLanguage, withDocumentLanguage } from '../shapingLanguage.js';
import { letterTrackingTj, measuredTextShows, showTextShaped, textAdvancePx, textShows } from '../pdf-backend/primitives.js';

// #770: the layout counts the tracking of a tracked word once a letter, and
// `Tc` follows every glyph: a ligature, one glyph for two or three letters,
// advanced by one tracking, so the letters after it stood a tracking early
// for each letter joined and the word ended that much short of its width.
// In a document shaped in its own language the pen moves on after a
// ligature by the tracking of its other letters; one that keeps its host's
// language prints as it did.

// Cormorant Garamond sets fi, ffi and fl as one glyph each.
const cormorant = new Uint8Array(fs.readFileSync(new URL('../../../../apps/web/public/fonts/CormorantGaramond.ttf', import.meta.url)));
let font: PDFFont;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  font = await pdf.embedFont(cormorant, { subset: true });
  shapeInCurrentLanguage(font);
});
const inDocument = <T,>(fn: () => T): T => withDocumentLanguage('en', 'en', fn);
const inHost = <T,>(fn: () => T): T => withDocumentLanguage(undefined, 'en', fn);
const SIZE = 20;
const T = 0.4;
/** The numbers of a `TJ` operator (thousandths of the font size). */
const numbers = (op: { toString(): string }): number[] => (/\[(.*)\]\s*TJ/s.exec(op.toString())?.[1] ?? '').replace(/<[0-9A-Fa-f]*>/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number);

describe('the tracking of a ligature in the PDF (#770)', () => {
  it('a word advances by the tracking of each of its letters', () => {
    for (const [word, glyphs, letters] of [['first', 4, 5], ['office', 4, 6], ['fly', 2, 3], ['stood', 5, 5]] as const) {
      const natural = inDocument(() => textAdvancePx(font, word, SIZE).advance);
      const shown = inDocument(() => textAdvancePx(font, word, SIZE, T));
      expect(shown.glyphs, word).toBe(glyphs);
      expect(shown.advance, word).toBeCloseTo(natural + letters * T, 9);
      // Keeping the host's language: once a glyph, as up to 1.29.
      expect(inHost(() => textAdvancePx(font, word, SIZE, T).advance), word).toBeCloseTo(inHost(() => textAdvancePx(font, word, SIZE).advance) + glyphs * T, 9);
    }
  });

  it('the pen moves on after the ligature by the tracking of its other letters', () => {
    const tj = (T / SIZE) * 1000;
    expect(inDocument(() => letterTrackingTj(T, SIZE))).toBeCloseTo(tj, 9);
    expect(inHost(() => letterTrackingTj(T, SIZE))).toBe(0);
    expect(inDocument(() => letterTrackingTj(0, SIZE))).toBe(0);
    const plain = inDocument(() => numbers(showTextShaped(font, 'office')));
    const tracked = inDocument(() => numbers(showTextShaped(font, 'office', tj)));
    // One number more in the array, or one of its own changed: the pen
    // moves two trackings further (o, ffi, c, e: the ligature joins three).
    const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
    expect(sum(plain) - sum(tracked)).toBeCloseTo(2 * tj, 2);
    // A word with no ligature is the same show.
    expect(inDocument(() => showTextShaped(font, 'stood', tj).toString())).toBe(inDocument(() => showTextShaped(font, 'stood').toString()));
  });

  it('a line set piece by piece and a text set whole carry the same movement', () => {
    const tj = (T / SIZE) * 1000;
    const sum = (shows: readonly { op: { toString(): string } }[]): number => shows.flatMap((s) => numbers(s.op)).reduce((a, b) => a + b, 0);
    const whole = inDocument(() => sum(textShows(font, 'first', true, false, 0)) - sum(textShows(font, 'first', true, false, tj)));
    expect(whole).toBeCloseTo(tj, 2);
    // Measured pieces: `first` at the width the layout gave it, natural
    // plus five trackings; the space after it starts where the layout put
    // it, with no correction left to make.
    const natural = inDocument(() => textAdvancePx(font, 'first', SIZE).advance);
    const space = inDocument(() => textAdvancePx(font, ' ', SIZE).advance);
    const pieces = [{ text: 'first', width: natural + 5 * T }, { text: ' ', width: space + T }, { text: 'stood', width: 0 }];
    const own = inDocument(() => sum(measuredTextShows(font, pieces, SIZE, T)!));
    const untracked = inDocument(() => sum(measuredTextShows(font, [{ text: 'first', width: natural }, { text: ' ', width: space }, { text: 'stood', width: 0 }], SIZE, 0)!));
    expect(untracked - own).toBeCloseTo(tj, 1);
    // Keeping the host's language the ligature takes one tracking and the
    // correction after the word makes up the other: the same total, the
    // letters `rst` a tracking early.
    const host = inHost(() => measuredTextShows(font, pieces, SIZE, T)!);
    const ownShows = inDocument(() => measuredTextShows(font, pieces, SIZE, T)!);
    expect(sum(host)).toBeCloseTo(own, 1);
    expect(host.map((s) => s.op.toString()).join('')).not.toBe(ownShows.map((s) => s.op.toString()).join(''));
  });
});
