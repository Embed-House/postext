import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { breakLigatures, buildDocument, ligatureBreaksOf, ligatureParts } from 'postext';
import type { PostextConfig, VDTDocument, VDTLine } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';
import { loadComplexShaper, shapeRun } from '../complexShaping.js';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const ALEGREYA = fixture('latin/alegreya-language.ttf');
const fontProvider = async () => ALEGREYA;

const ZWNJ = '\u200C';
const FI = '\uFB01';

function harfBuzzWidth(text: string, language?: string): number {
  const run = shapeRun(ALEGREYA, text, { direction: 'ltr', ...(language ? { language } : {}) });
  return run ? run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) / run.upem : text.length * 0.5;
}

class CanvasCtx {
  direction = 'ltr';
  letterSpacing = '0px';
  font = '';
  lang = 'inherit';
  measureText(s: string): { width: number } {
    const parsed = parseFontString(this.font);
    const language = this.lang === 'inherit' ? undefined : this.lang;
    let advance = 0;
    for (const piece of s.split(/( )/)) if (piece !== '') advance += harfBuzzWidth(piece, language);
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
const WORDS = 'fil fiil naif';

function config(locale: string, turkishLigatures?: 'break' | 'keep'): PostextConfig {
  return {
    page: { width: pt(700), height: pt(300), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
    locale,
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    bodyText: {
      fontFamily: 'Alegreya', fontSize: pt(SIZE), lineHeight: pt(36), firstLineIndent: pt(0), textAlign: 'left',
      hyphenation: { enabled: false }, shapingLanguage: 'host', ...(turkishLigatures ? { turkishLigatures } : {}),
    },
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

function pdfFile(bytes: Uint8Array): string {
  const file = path.join(os.tmpdir(), `postext-turkish-ligatures-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  return file;
}

function pdfText(bytes: Uint8Array): string {
  const file = pdfFile(bytes);
  try {
    return execFileSync('pdftotext', ['-l', '1', file, '-'], { encoding: 'utf8' });
  } finally {
    fs.unlinkSync(file);
  }
}

interface Box {
  text: string;
  left: number;
  right: number;
}
function wordBoxes(bytes: Uint8Array): Box[] {
  const file = pdfFile(bytes);
  try {
    const xml = execFileSync('pdftotext', ['-bbox', '-l', '1', file, '-'], { encoding: 'utf8' });
    return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
      .map((m) => ({ text: m[3]!, left: Number(m[1]), right: Number(m[2]) }));
  } finally {
    fs.unlinkSync(file);
  }
}

const firstLine = (doc: VDTDocument): VDTLine => doc.pages[0]!.columns[0]!.blocks[0]!.lines[0]!;
function wordPlaces(line: VDTLine): Box[] {
  const places: Box[] = [];
  let x = line.bbox.x;
  for (const seg of line.segments!) {
    if (seg.kind !== 'space') places.push({ text: seg.text, left: x, right: x + seg.width });
    x += seg.width;
  }
  return places;
}
const widthsOf = (line: VDTLine): Record<string, number> => Object.fromEntries(line.segments!.filter((s) => s.kind !== 'space').map((s) => [s.text, Math.round(s.width / EM)]));

beforeAll(async () => {
  await loadComplexShaper();
});

describe('Turkish f + i ligatures', () => {
  it('breaks f before i, ı and î in Turkish and Azerbaijani unless kept', () => {
    expect(breakLigatures('fikir fıkıh Hanefî fiil Afife')).toBe(`f${ZWNJ}ikir f${ZWNJ}ıkıh Hanef${ZWNJ}î f${ZWNJ}iil Af${ZWNJ}ife`);
    expect(breakLigatures('effi effı')).toBe(`eff${ZWNJ}i eff${ZWNJ}ı`);
    expect(breakLigatures('flor fe')).toBe('flor fe');
    expect(ligatureParts('fiil')).toEqual(['f', 'iil']);
    expect(ligatureBreaksOf({ locale: 'tr' })).toBe(true);
    expect(ligatureBreaksOf({ locale: 'tr-TR' })).toBe(true);
    expect(ligatureBreaksOf({ locale: 'az' })).toBe(true);
    expect(ligatureBreaksOf({ locale: 'tr', bodyText: { turkishLigatures: 'keep' } })).toBe(false);
    expect(ligatureBreaksOf({ locale: 'en' })).toBe(false);
    expect(ligatureBreaksOf({ locale: 'en', bodyText: { turkishLigatures: 'break' } })).toBe(false);
  });

  it('measures a Turkish word without the ligature, and keeps the text as written', () => {
    const tr = firstLine(buildDocument({ markdown: WORDS }, config('tr')));
    const en = firstLine(buildDocument({ markdown: WORDS }, config('en')));
    expect(tr.text).toBe(WORDS);
    for (const seg of tr.segments!) expect(seg.text).not.toContain(ZWNJ);
    expect(widthsOf(tr).fil).toBe(Math.round(harfBuzzWidth(`f${ZWNJ}il`) * 1000));
    expect(widthsOf(en).fil).toBe(Math.round(harfBuzzWidth('fil') * 1000));
    expect(widthsOf(tr).fil).not.toBe(widthsOf(en).fil);
    expect(widthsOf(tr).naif).toBe(widthsOf(en).naif);
  });

  it('measures as before with turkishLigatures: keep', () => {
    const keep = firstLine(buildDocument({ markdown: WORDS }, config('tr', 'keep')));
    const en = firstLine(buildDocument({ markdown: WORDS }, config('en')));
    expect(widthsOf(keep)).toEqual(widthsOf(en));
  });

  it.skipIf(!hasPdftotext)('prints each Turkish word as wide as it was measured, with no ligature and no ZWNJ in its text', async () => {
    const doc = buildDocument({ markdown: WORDS }, config('tr'));
    const bytes = await renderToPdf(doc, { fontProvider, accessible: false });
    const text = pdfText(bytes);
    expect(text).toContain('fil fiil naif');
    expect(text).not.toContain(FI);
    expect(text).not.toContain(ZWNJ);
    const boxes = wordBoxes(bytes);
    const places = wordPlaces(firstLine(doc));
    expect(boxes.map((b) => b.text)).toEqual(places.map((p) => p.text));
    boxes.forEach((box, i) => {
      expect(box.left, `${box.text} left`).toBeCloseTo(places[i]!.left, 1);
      expect(box.right, `${box.text} right`).toBeCloseTo(places[i]!.right, 1);
    });
  }, 60_000);

  it.skipIf(!hasPdftotext)('leaves an English document as it was', async () => {
    const doc = buildDocument({ markdown: WORDS }, config('en'));
    const boxes = wordBoxes(await renderToPdf(doc, { fontProvider, accessible: false }));
    const places = wordPlaces(firstLine(doc));
    boxes.forEach((box, i) => expect(box.right, `${box.text} right`).toBeCloseTo(places[i]!.right, 1));
  }, 60_000);
});
