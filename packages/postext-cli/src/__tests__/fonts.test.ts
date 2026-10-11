import { describe, expect, it } from 'bun:test';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { EMBEDDED_FACES, readEmbedded } from '../assets';
import { fontsourceFiles, nearestVariants, readFontMeta, restyleFace, type FamilyMeta } from '../fonts';

const regular = () => readEmbedded(EMBEDDED_FACES.find((f) => f.family === 'Open Sans' && f.weight === 400 && f.style === 'normal')!.path);

describe('nearestVariants', () => {
  const oneWeight: FamilyMeta = { available: true, weights: [400], styles: ['normal'], checkedAt: 0 };
  it('answers the regular, the bold and their italics of a one-weight family with one file', () => {
    const asked = [{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }, { weight: 400, style: 'italic' }, { weight: 700, style: 'italic' }] as const;
    expect(nearestVariants(asked, oneWeight)).toEqual([{ weight: 400, style: 'normal' }]);
  });
  it('keeps the nearest weight of each style a family ships', () => {
    const meta: FamilyMeta = { available: true, weights: [300, 400, 700], styles: ['normal', 'italic'], checkedAt: 0 };
    expect(nearestVariants([{ weight: 800, style: 'italic' }, { weight: 700, style: 'italic' }, { weight: 500, style: 'normal' }], meta))
      .toEqual([{ weight: 700, style: 'italic' }, { weight: 400, style: 'normal' }]);
  });
});

describe('fontsourceFiles (#689)', () => {
  it('lists the TrueType file of each weight and style of a family Google Fonts does not have', () => {
    const file = (w: number, s: string) => ({ latin: { url: { ttf: `https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-${w}-${s}.ttf` } } });
    expect(fontsourceFiles({ type: 'other', defSubset: 'latin', variants: { 400: { normal: file(400, 'normal'), italic: file(400, 'italic') }, 700: { normal: file(700, 'normal') } } })).toEqual({
      '400-normal': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-normal.ttf',
      '400-italic': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-italic.ttf',
      '700-normal': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-700-normal.ttf',
    });
    expect(fontsourceFiles({})).toEqual({});
  });
});

describe('restyleFace (#688)', () => {
  it('gives a copy the weight and the slant asked, and leaves the file as it was', async () => {
    const bytes = regular();
    const before = bytes.slice();
    const copy = restyleFace(bytes, 700, 'italic')!;
    expect(await readFontMeta(copy)).toMatchObject({ weight: 700, style: 'italic' });
    expect(await readFontMeta(restyleFace(bytes, 800, 'normal')!)).toMatchObject({ weight: 800, style: 'normal' });
    expect(bytes).toEqual(before);
    expect(copy.byteLength).toBe(bytes.byteLength);
  });

  it('answers nothing for bytes that are not a font', () => {
    expect(restyleFace(new Uint8Array(4), 700, 'normal')).toBeUndefined();
    expect(restyleFace(new Uint8Array(64), 700, 'normal')).toBeUndefined();
  });

  it('makes the canvas paint a bold and an italic the family lacks with its own letters', () => {
    const bytes = regular();
    const ink = (font: string): number => {
      const canvas = createCanvas(700, 140);
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 700, 140);
      c.fillStyle = '#000';
      c.font = font;
      c.fillText('Hamburg', 10, 100);
      const data = c.getImageData(0, 0, 700, 140).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 255 - data[i]!;
      return sum;
    };
    // A family with a regular alone: its bold is drawn heavier, its italic slanted.
    GlobalFonts.register(Buffer.from(bytes), 'One Weight Probe');
    const own = ink('400 80px "One Weight Probe"');
    expect(ink('700 80px "One Weight Probe"')).toBeGreaterThan(own * 1.05);
    expect(ink('italic 400 80px "One Weight Probe"')).not.toBe(own);
    for (const [weight, style] of [[700, 'normal'], [400, 'italic'], [700, 'italic']] as const) {
      GlobalFonts.register(Buffer.from(restyleFace(bytes, weight, style)!), 'One Weight Probe');
    }
    expect(ink('700 80px "One Weight Probe"')).toBe(own);
    expect(ink('italic 400 80px "One Weight Probe"')).toBe(own);
    expect(ink('italic 700 80px "One Weight Probe"')).toBe(own);
  });
});
