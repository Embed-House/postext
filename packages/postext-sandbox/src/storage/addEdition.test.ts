// #989: a language added to a book from the Sandbox. The record of a book
// in one language gains an edition made from the open one; nothing is
// written by the pure functions, the Books panel stores the result.

import { describe, expect, it } from 'vitest';
import { defaultResourceTypes } from 'postext';
import type { Resource } from 'postext';
import { newChapter } from '../book/chapterOps.js';
import { PROJECT_RECORD_VERSION } from './projectMigration.js';
import { editionTitleOf, renameEditionPatch, renamePatch, toSummary, withActiveEdition, type ProjectRecord } from './projects.js';
import { recordEditionTags, recordHasEdition, recordLocaleOf, withNewEdition } from './projectEditions.js';

const PICTURE: Resource = { id: 'fig', kind: 'bitmap', type: 'figure', bitmap: { fileId: 'blob-1' } } as unknown as Resource;

function record(patch: Partial<ProjectRecord> = {}): ProjectRecord {
  const first = newChapter('c1', 'Uno', '# Uno\n\nTexto.');
  const second = newChapter('c2', 'Dos', '# Dos\n\nOtro texto.');
  return {
    version: PROJECT_RECORD_VERSION,
    id: 'p1',
    name: 'Mi libro',
    locale: 'es',
    chapters: [first, second],
    activeChapterId: 'c2',
    config: { locale: 'es', resourceTypes: defaultResourceTypes('es'), bodyText: { hyphenation: { locale: 'es' } } },
    resources: [PICTURE],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

let n = 0;
const deps = { ids: () => `new-${++n}`, fallbackLocale: 'en' };
const addTo = (r: ProjectRecord, locale: string) => withNewEdition(r, locale, deps)?.record ?? null;

describe('withNewEdition (#989)', () => {
  it('makes an edition from the open one: same text, its own chapter ids, the new document language', () => {
    const base = record();
    const next = addTo(base, 'en-us')!;
    const added = next.editions!['en-us']!;
    expect(added.chapters.map((c) => c.markdown)).toEqual(base.chapters.map((c) => c.markdown));
    expect(added.chapters.map((c) => c.id)).not.toContain('c1');
    expect(added.chapters.map((c) => c.id)).not.toContain('c2');
    // The chapter that was open stays the open one.
    expect(added.chapters.find((c) => c.id === added.activeChapterId)!.markdown).toContain('Otro texto');
    expect(added.config.locale).toBe('en-us');
    // The language of the hyphenation was the old one's: it follows the document now.
    expect(added.config.bodyText?.hyphenation?.locale).toBeUndefined();
    // Built-in figure and table names follow the language.
    expect(added.config.resourceTypes).toEqual(defaultResourceTypes('en-us'));
    expect(added.resources).toEqual(base.resources);
    // The edition on screen is untouched.
    expect(next.chapters).toBe(base.chapters);
    expect(next.config).toBe(base.config);
    expect(next.locale).toBe('es');
    expect(next.editionLocales).toEqual(['es', 'en-us']);
  });

  it('keeps renamed resource types and the pictures', () => {
    const types = [{ ...defaultResourceTypes('es')[0]!, name: 'Lámina' }, ...defaultResourceTypes('es').slice(1)];
    const base = record({ config: { locale: 'es', resourceTypes: types } });
    const added = addTo(base, 'fr')!.editions!.fr!;
    expect(added.config.resourceTypes).toEqual(types);
    expect(added.resources[0]).toMatchObject({ id: 'fig', bitmap: { fileId: 'blob-1' } });
    // A copy, not the same objects: editing one edition never edits the other.
    expect(added.resources).not.toBe(base.resources);
    expect(added.config).not.toBe(base.config);
  });

  it('adds to a book that already has editions, in order, and refuses a language it has', () => {
    const base = record({
      editions: { ca: { chapters: [newChapter('k1', 'Un', '# Un')], activeChapterId: 'k1', config: { locale: 'ca' }, resources: [] } },
      editionLocales: ['es', 'ca'],
    });
    expect(recordEditionTags(base, 'en')).toEqual(['es', 'ca']);
    expect(recordHasEdition(base, 'CA', 'en')).toBe(true);
    expect(recordHasEdition(base, 'es', 'en')).toBe(true);
    expect(addTo(base, 'ca')).toBeNull();
    expect(addTo(base, 'es')).toBeNull();
    const next = addTo(base, 'de')!;
    expect(next.editionLocales).toEqual(['es', 'ca', 'de']);
    expect(Object.keys(next.editions!)).toEqual(['ca', 'de']);
    expect(toSummary(next).locales).toEqual(['es', 'ca', 'de']);
  });

  it('reads a record that names no language from its configuration, else the interface', () => {
    expect(recordLocaleOf({ locale: undefined, config: { locale: 'fr' } }, 'en')).toBe('fr');
    expect(recordLocaleOf({ locale: undefined, config: {} }, 'ja')).toBe('ja');
    const next = addTo(record({ locale: undefined, config: { locale: 'fr' } }), 'it')!;
    expect(next.locale).toBe('fr');
    expect(next.editionLocales).toEqual(['fr', 'it']);
  });

  it('opens the new edition with withActiveEdition and leaves the first aside, keeping the name', () => {
    const next = addTo(record(), 'en-us')!;
    const shown = withActiveEdition(next, 'en-us');
    expect(shown.locale).toBe('en-us');
    expect(shown.name).toBe('Mi libro');
    expect(shown.config.locale).toBe('en-us');
    expect(Object.keys(shown.editions!)).toEqual(['es']);
    expect(shown.editions!.es!.config.locale).toBe('es');
    expect(editionTitleOf(shown, 'es')).toBeUndefined();
  });
});

describe('renameEditionPatch (#999)', () => {
  const two = (patch: Partial<ProjectRecord> = {}): ProjectRecord => ({ ...addTo(record(), 'en-us')!, ...patch });

  it('gives the edition on screen a title of its own and the others the one they show', () => {
    const base = two({ description: 'Descripción' });
    const patch = renameEditionPatch(base, 'My book', 'About it');
    expect(patch).toMatchObject({ name: 'My book', description: 'About it', titleEdited: false });
    expect(patch.editionTitles).toEqual({
      es: { name: 'My book', description: 'About it' },
      'en-us': { name: 'Mi libro', description: 'Descripción' },
    });
  });

  it('is what an export and a switch read: each edition keeps its own title', () => {
    const base = two();
    const edited = { ...base, ...renameEditionPatch(base, 'Mi libro de texto') };
    const other = withActiveEdition(edited, 'en-us');
    expect(other.name).toBe('Mi libro');
    expect(withActiveEdition(other, 'es').name).toBe('Mi libro de texto');
    expect(editionTitleOf(edited, 'en-us')?.name).toBe('Mi libro');
  });

  it('undoes the title the reader gave every language, freezing what each showed', () => {
    const base = two({ name: 'Libro del lector', titleEdited: true, editionTitles: { es: { name: 'Viejo' }, 'en-us': { name: 'Old' } } });
    const patch = renameEditionPatch(base, 'Libro', undefined);
    expect(patch.titleEdited).toBe(false);
    expect(patch.editionTitles).toEqual({ es: { name: 'Libro' }, 'en-us': { name: 'Libro del lector' } });
  });

  it('keeps the description of the edition when none is given, and writes under the key the bundle used', () => {
    const base = two({ description: 'Texto', editionTitles: { ES: { name: 'Mi libro', description: 'Texto' } } });
    const patch = renameEditionPatch(base, 'Otro', undefined);
    expect(patch.description).toBe('Texto');
    expect(Object.keys(patch.editionTitles!).sort()).toEqual(['ES', 'en-us']);
    expect(patch.editionTitles!.ES).toEqual({ name: 'Otro', description: 'Texto' });
  });

  it('renames a book in one language as a whole, like the project rename', () => {
    const base = record();
    expect(renameEditionPatch(base, 'Nuevo')).toEqual(renamePatch(base, 'Nuevo'));
  });
});

describe('the defaults of the language an edition is added in (#989)', () => {
  const add = (patch: Partial<ProjectRecord>, locale: string) => withNewEdition(record(patch), locale, deps)!;

  it('gives an Arabic edition the Arabic defaults: typefaces, captions, a right-to-left reading', () => {
    const { record: next, applied } = add({ config: { locale: 'en', resourceTypes: defaultResourceTypes('en') } }, 'ar');
    const config = next.editions!.ar!.config;
    expect(applied).toMatchObject({ script: 'arabic' });
    expect(applied!.count).toBeGreaterThan(3);
    expect(config.locale).toBe('ar');
    expect(config.bodyText?.fontFamily).toBe('Amiri');
    expect(config.resourceTypes).toEqual(defaultResourceTypes('ar'));
    // The edition it was copied from keeps its settings.
    expect(next.config.bodyText?.fontFamily).toBeUndefined();
  });

  it('returns a left-to-right book to Auto for an Arabic edition, and keeps a typeface the book chose', () => {
    const { record: next } = add({ config: { locale: 'en', direction: 'ltr', bodyText: { fontFamily: 'Lora' } } }, 'ar');
    const config = next.editions!.ar!.config;
    expect(config.direction).toBeUndefined();
    expect(config.bodyText?.fontFamily).toBe('Lora');
  });

  it('gives a Japanese edition the defaults of a horizontal book unless the book is vertical', () => {
    const horizontal = add({ config: { locale: 'en' } }, 'ja');
    expect(horizontal.applied).toMatchObject({ script: 'japanese' });
    expect(horizontal.record.editions!.ja!.config.layout?.writingMode).toBeUndefined();
    expect(horizontal.record.editions!.ja!.config.bodyText?.fontFamily).toBe('Noto Serif JP');
    const vertical = add({ config: { locale: 'en', layout: { writingMode: 'vertical-rl' } } }, 'ja');
    expect(vertical.record.editions!.ja!.config.layout?.writingMode).toBe('vertical-rl');
  });

  it('gives a Chinese edition its script, typefaces and captions', () => {
    const { record: next, applied } = add({ config: { locale: 'en' } }, 'zh-Hant');
    expect(applied).toMatchObject({ script: 'chinese' });
    const config = next.editions!['zh-Hant']!.config;
    expect(config.locale).toBe('zh-Hant');
    expect(config.bodyText?.fontFamily).toMatch(/Noto (Serif|Sans) (TC|HK)/);
  });

  it('applies nothing to a language without defaults', () => {
    const made = add({}, 'fr');
    expect(made.applied).toBeNull();
  });
});
