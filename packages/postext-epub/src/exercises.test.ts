import { describe, it, expect } from 'vitest';
import { EXERCISE_SCRIPT, type ExerciseData } from 'postext';
import { renderToEpub, readEpub } from './index.js';
import type { ReadEpubResult, RenderToEpubOptions } from './types.js';
import { exerciseSampleBook, layOutBook, sampleBook } from './__tests__/sampleBook.js';
import { EXERCISE_SCRIPT_HREF } from './shared/exerciseScript.js';

// Exercises in both renditions (#1231): the documents that hold them carry
// their records and link the exercise script; the answers never show in
// the text; the key is there for a reader with no script.

const options = (layout: RenderToEpubOptions['layout']): RenderToEpubOptions => ({
  layout,
  metadata: { title: 'Plants', creators: ['Ada Lovelace'], language: 'en-US', identifier: 'urn:isbn:9780000000002', modified: new Date(Date.UTC(2026, 9, 24)) },
});

const text = (book: ReadEpubResult, path: string): string => new TextDecoder().decode(book.files.get(path)!);

const dataOf = (xhtml: string): { data: ExerciseData; key: string } => {
  const m = /<script type="application\/json" class="pt-exercises" data-storage-key="([^"]*)">([\s\S]*?)<\/script>/.exec(xhtml);
  expect(m).not.toBeNull();
  return { key: m![1]!, data: JSON.parse(m![2]!) as ExerciseData };
};

describe.each(['fixed', 'reflowable'] as const)('exercises in a %s EPUB', (layout) => {
  it('carries the records and the script, and keeps the answers out of the text', async () => {
    const book = readEpub(await renderToEpub(exerciseSampleBook(), options(layout)));
    const docs = book.spine.map((s) => s.path).filter((p) => text(book, p).includes('class="pt-exercises"'));
    expect(docs.length).toBeGreaterThan(0);
    const script = [...book.manifest.values()].find((i) => i.path.endsWith(EXERCISE_SCRIPT_HREF));
    expect(script?.mediaType).toBe('application/javascript');
    expect(text(book, script!.path)).toBe(EXERCISE_SCRIPT);
    const kinds = new Set<string>();
    for (const path of docs) {
      const xhtml = text(book, path);
      expect(xhtml).toContain(`src="../${EXERCISE_SCRIPT_HREF}"`);
      const item = [...book.manifest.values()].find((i) => i.path === path);
      expect(item?.properties).toContain('scripted');
      const { data, key } = dataOf(xhtml);
      expect(key).toMatch(/^pt-ex:urn:isbn:9780000000002:/);
      for (const r of data.exercises) {
        kinds.add(r.kind);
        expect(xhtml).toContain(`data-pt-exercise="${r.id}"`);
      }
      // The answers are in the data block and the key only: a blank
      // holds no text (the word bank lists its words, as it prints them).
      const page = xhtml.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<details[\s\S]*?<\/details>/g, '');
      expect(page).not.toMatch(/pt-ex-blank"[^>]*>[^<]/);
      expect(page).not.toContain('Plants need water');
    }
    expect([...kinds].sort()).toEqual(['arithmetic', 'choice', 'crossword', 'gaps', 'mark', 'match', 'open', 'order', 'scramble', 'sort', 'truefalse', 'wordsearch']);
    // The key, for a reader with no script.
    const all = docs.map((p) => text(book, p)).join('\n');
    expect(all).toContain('<details class="pt-ex-static"');
    expect(all).toContain('pt-ex-blank');
    expect(all).toContain('To make their food.');
  });

  it('leaves a book without exercises unscripted', async () => {
    const book = readEpub(await renderToEpub(sampleBook(), options(layout)));
    expect([...book.manifest.values()].some((i) => i.path.endsWith(EXERCISE_SCRIPT_HREF))).toBe(false);
  });
});

describe('exercises in a reflowable EPUB', () => {
  it('sets blanks as inputs and draws the grids', async () => {
    const book = readEpub(await renderToEpub(exerciseSampleBook(), options('reflowable')));
    const xhtml = book.spine.map((s) => text(book, s.path)).find((t) => t.includes('class="pt-exercises"'))!;
    expect(xhtml).toMatch(/<span class="pt-chip [^"]* pt-ex-slot pt-ex-blank" data-pt-ex="\d+" data-pt-slot="g1" style="width:[\d.]+em"><input type="text" class="pt-ex-input"/);
    // A grid set in ems of the text, so a reader's larger text draws it
    // larger (#1244); the script lays its controls over its printed size.
    expect(xhtml).toMatch(/<div class="pt-ex-box pt-ex-drawn" data-pt-box="\d+" data-pt-ex="\d+" data-pt-w="[\d.]+" data-pt-h="[\d.]+" style="width:[\d.]+em"><svg /);
    // The flow's units: grids at their printed size in CSS pixels.
    const { data } = dataOf(xhtml);
    expect(data.flow).toBe(true);
    expect(data.pxPerPt).toBeCloseTo(96 / 72);
  });

  it('styles the boxes an exercise is set in: its frame, a word bank, a solution (#1244)', async () => {
    const book = readEpub(await renderToEpub(exerciseSampleBook(), options('reflowable')));
    const css = [...book.files.keys()].filter((p) => p.endsWith('.css')).map((p) => text(book, p)).join('\n');
    expect(css).toMatch(/aside\.pt-callout-__postext-ex-exercise-bank, div\.pt-exercise\.pt-callout-__postext-ex-exercise-bank \{[^}]*border: [\d.]+px solid/);
    expect(css).toContain('div.pt-exercise.pt-callout-__postext-ex-exercise-frame');
  });

  it('sets a reading over a blank as the blank\'s ruby (#1244)', async () => {
    const docs = layOutBook([':::exercise\n看拼音写词语。\n\n[[{春天|chūn tiān}]]\n:::\n'], { locale: 'zh-Hans', layout: { layoutType: 'single' } });
    const book = readEpub(await renderToEpub(docs, { ...options('reflowable'), metadata: { ...options('reflowable').metadata, language: 'zh-Hans' } }));
    const xhtml = book.spine.map((s) => text(book, s.path)).find((t) => t.includes('class="pt-exercises"'))!;
    expect(xhtml).toMatch(/<ruby><span class="pt-chip [^"]* pt-ex-blank"[^>]*><input [^>]*\/><\/span><rt>chūn tiān<\/rt><\/ruby>/);
  });
});
