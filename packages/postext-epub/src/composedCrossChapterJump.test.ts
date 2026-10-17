// A story that jumps from one chapter to a page of a later one (#943) in
// the reflowable EPUB: the rest is read where it stands, in the section of
// the chapter that has the page, and every word of the article is there
// once.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildBundle } from 'postext/bundle';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToEpub, readEpub } from './index';
import type { ReadEpubResult } from './types';
import { checkXml } from './reflowable/__tests__/xml';
// The measuring stub the engine's layout needs in node.
import './__tests__/page8';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const top = { anchor: { to: 'container' as const, edge: 'top-left' as const } };
const para = (word: string, n: number): string => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

let book: ReadEpubResult;
let docs: VDTDocument[];

beforeAll(async () => {
  const fixtures = new URL('../../postext/src/__tests__/composed/fixtures/page8.ts', import.meta.url).href;
  const { page8Fixture } = (await import(/* @vite-ignore */ fixtures)) as { page8Fixture: (l: 'es') => { config: PostextConfig } };
  const base = page8Fixture('es').config;
  const config: PostextConfig = {
    ...base,
    pageTemplates: [
      { id: 'articulo', header: false, frames: [{ name: 'cuerpo', style: 'caja-azul', flow: true, width: mm(186), height: mm(90), placement: top, overflow: { continueIn: 'page:{attr.sigue}' }, fit: { shrinkText: false } }] },
      { id: 'salto', header: false, frames: [{ name: 'breve', flow: true, width: mm(186), height: mm(40), placement: top }, { name: 'resto', style: 'caja-azul', width: mm(186), placement: { anchor: { to: '#breve', edge: 'below' }, offset: { y: mm(10) } } }] },
    ],
  };
  const chapters = [
    `::::page{template="articulo" sigue="p-salto"}\n${para('art', 900)}\n::::\n`,
    '# Otro capítulo\n\nTexto del otro capítulo.\n',
    `::::page{template="salto" id="p-salto"}\n${para('breve', 60)}\n::::\n`,
  ];
  docs = buildBundle({ chapters: chapters.map((markdown) => ({ markdown })), config, resources: [] });
  book = readEpub(await renderToEpub(docs, { layout: 'reflowable', metadata: { title: 'Revista', language: 'es', modified: new Date(Date.UTC(2026, 9, 16)) } }));
}, 60_000);

const text = (path: string): string => new TextDecoder().decode(book.files.get(path)!);
const chapterFiles = (): string[] => book.spine.map((s) => s.path).filter((p) => p.includes('chapter-'));
const words = (xml: string): string[] => xml.split(/[^A-Za-z0-9]+/).filter((w) => /^art\d+$/.test(w));

describe('a story that jumps to a page of a later chapter, in the reflowable EPUB (#943)', () => {
  it('reads the start in its chapter and the rest in the chapter that has the page, every word once', () => {
    const files = chapterFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    const all = files.flatMap((f) => words(text(f)));
    expect(all).toEqual(Array.from({ length: 900 }, (_, i) => `art${i}`));
    const first = words(text(files[0]!));
    const last = words(text(files[files.length - 1]!));
    expect(first.length).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
    expect(last[0]).toBe(`art${first.length}`);
    for (const f of files) expect(checkXml(text(f)).errors).toEqual([]);
  });

  it('keeps the page\'s own words before the rest', () => {
    const xhtml = text(chapterFiles()[2]!);
    expect(xhtml.indexOf('breve0')).toBeGreaterThan(-1);
    expect(xhtml.indexOf('breve0')).toBeLessThan(xhtml.indexOf(`art${words(text(chapterFiles()[0]!)).length}`));
  });
});
