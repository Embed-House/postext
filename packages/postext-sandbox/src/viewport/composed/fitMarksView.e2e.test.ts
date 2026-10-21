// The fit marks setting on a composed page (#1160), on P4's p. 8 stand-in (in Spanish)
// laid out by the engine: a first box whose text the ladder shrank, and the
// same box with shrinking off, so that it does not fit. The viewer's choice
// (All, Problems only, None) over the book's `debug.fitMarks`, the scale
// threshold, the choice kept across a reload, and the layout untouched.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource, VDTDocument, VDTFrame, VDTPage } from 'postext';
import { configKeyOf } from '../../book/layoutKeys';
import { fitMarksFor } from './fitMarks';
import { fitMarksChoiceNow, fitMarksViewOf, nextFitMarksMode, resetFitMarksView, setFitMarksChoice } from './fitMarksView';

(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return { font: '', measureText: (s: string) => ({ width: s.length * 7 }) };
  }
};

type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const FIXTURES = '../../../../postext/src/__tests__/composed/fixtures/';
let page8Fixture: Fixture;
beforeAll(async () => {
  page8Fixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}page8.ts`, import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
});

// A browser's storage, so the choice is kept as it is on a reader's machine.
const stored = new Map<string, string>();
const storage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
};
beforeEach(() => {
  stored.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
  resetFitMarksView();
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  resetFitMarksView();
});

const mm = (value: number) => ({ value, unit: 'mm' as const });
const LABELS = { overflow: '__mm__ mm short', scaled: 'text at __percent__ %', imageScaled: 'pictures at __percent__ %', lookUnknown: 'unknown look: __look__' };
const fixed = { height: mm(36), minHeight: undefined };

function standIn(dinero: Record<string, unknown>, more: string, debug?: PostextConfig['debug']): { markdown: string; config: PostextConfig; resources: Resource[] } {
  const { markdown, config, resources } = page8Fixture('es');
  const tpl = config.pageTemplates![0]!;
  return {
    markdown: markdown.replace(/(:::frame\{slot="dinero"[^\n]*\n)/, `$1${more}\n\n`),
    config: { ...config, pageTemplates: [{ ...tpl, frames: tpl.frames!.map((f) => (f.name === 'dinero' ? { ...f, ...dinero } : f)) }], ...(debug ? { debug } : {}) },
    resources,
  };
}
const build = (f: ReturnType<typeof standIn>): VDTDocument => buildDocument({ markdown: f.markdown, resources: f.resources }, f.config, createMeasurementCache());
const composedPage = (doc: VDTDocument): VDTPage => doc.pages.find((p) => p.composed)!;
const dinero = (doc: VDTDocument): VDTFrame => composedPage(doc).composed!.frames.find((f) => f.name === 'dinero')!;
/** `k` more words at the head of the first box (one short paragraph). */
const words = (k: number) => 'Más dinero '.repeat(k).trim();

/** The marks the canvas draws on the composed page, as it asks for them. */
const marksOn = (doc: VDTDocument, config: PostextConfig) =>
  fitMarksFor(doc, composedPage(doc), LABELS, { ...fitMarksViewOf(config.debug), locale: 'en' }).map((m) => `${m.frame.name} ${m.kind}`);

describe('the fit marks setting on a composed page (#1160)', () => {
  it('All, Problems only and None, chosen in turn on a scaled page and on one that does not fit', () => {
    const scaledIn = standIn(fixed, words(40));
    const scaled = build(scaledIn);
    expect(dinero(scaled).scale).toBeLessThan(1);
    expect(dinero(scaled).overflowPx).toBe(0);
    const overIn = standIn({ ...fixed, fit: { shrinkText: false } }, words(40));
    const over = build(overIn);
    expect(dinero(over).overflowPx).toBeGreaterThan(0);

    // A reader who never chose follows the book, which shows all.
    expect(fitMarksChoiceNow()).toBeNull();
    expect(marksOn(scaled, scaledIn.config)).toContain('dinero scaled');
    expect(marksOn(over, overIn.config)).toContain('dinero overflow');

    setFitMarksChoice(nextFitMarksMode('all'));
    expect(fitMarksChoiceNow()).toBe('problems');
    expect(marksOn(scaled, scaledIn.config).filter((m) => m.endsWith('scaled'))).toEqual([]);
    expect(marksOn(over, overIn.config)).toContain('dinero overflow');

    setFitMarksChoice(nextFitMarksMode('problems'));
    expect(fitMarksChoiceNow()).toBe('none');
    expect(marksOn(scaled, scaledIn.config)).toEqual([]);
    expect(marksOn(over, overIn.config)).toEqual([]);

    setFitMarksChoice(nextFitMarksMode('none'));
    expect(fitMarksChoiceNow()).toBe('all');
  });

  it('keeps the choice across a reload, and the book\'s default holds for a reader who never chose', () => {
    const f = standIn(fixed, words(40), { fitMarks: 'problems' });
    const doc = build(f);
    expect(fitMarksViewOf(f.config.debug)).toEqual({ mode: 'problems', minScale: 1, source: 'book' });
    expect(marksOn(doc, f.config).filter((m) => m.endsWith('scaled'))).toEqual([]);
    setFitMarksChoice('all');
    resetFitMarksView(); // a reload: read again from storage
    expect(fitMarksChoiceNow()).toBe('all');
    expect(fitMarksViewOf(f.config.debug).source).toBe('viewer');
    expect(marksOn(doc, f.config)).toContain('dinero scaled');
    // Back to the book.
    setFitMarksChoice(null);
    resetFitMarksView();
    expect(fitMarksChoiceNow()).toBeNull();
    expect(fitMarksViewOf(f.config.debug).mode).toBe('problems');
  });

  it('leaves out the scale badge of a frame set at debug.fitMarksMinScale or larger', () => {
    const plain = standIn(fixed, words(40));
    const scale = dinero(build(plain)).scale;
    const at = standIn(fixed, words(40), { fitMarksMinScale: scale });
    expect(marksOn(build(at), at.config)).not.toContain('dinero scaled');
    const above = standIn(fixed, words(40), { fitMarksMinScale: scale + 0.01 });
    expect(marksOn(build(above), above.config)).toContain('dinero scaled');
  });

  it('changes neither the layout nor its key', () => {
    const plain = standIn(fixed, words(40));
    const set = standIn(fixed, words(40), { fitMarks: 'none', fitMarksMinScale: 0.9 });
    expect(JSON.stringify(build(set).pages)).toBe(JSON.stringify(build(plain).pages));
    expect(configKeyOf(set.config)).toBe(configKeyOf(plain.config));
    // The rest of debug still counts, as before.
    const negative = standIn(fixed, words(40), { pageNegative: { enabled: true } });
    expect(configKeyOf(negative.config)).not.toBe(configKeyOf(plain.config));
  });
});
