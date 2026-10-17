// #903: a local project keeps every edition of an imported bundle in
// several languages, so the checks across editions, the switcher and the
// side-by-side view (#867) work on projects too. The bundle is written the
// way the Sandbox exports one, read back edition by edition the way the
// import does, and the record it makes is swapped, migrated and checked.

import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import { layOutEdition } from '../editions/editionLayout';
import { FIXTURE_LOCALES, threeEditionsBook, type FixtureLocale } from '../editions/threeEditions.fixture';
import { composedChecksOf } from '../warnings/composedChecks';
import { buildBundleFiles, parseBundle } from '../presets/bundle';
import { openBundleZip, zipBundle } from '../presets/zip';
import { bundleContentLocales } from '../presets/locale';
import type { LoadedPreset } from '../presets';
import { newChapter } from '../book/chapterOps';
import type { Chapter } from '../book/types';
import { contentOfLoaded, projectEditionFields } from './projectEditions';
import { migrateProjectRecord, PROJECT_RECORD_VERSION } from './projectMigration';
import { allEditionChapters, editionContentOf, toSummary, withActiveEdition, type ProjectRecord } from './projects';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: s.length * px * 0.42 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

function chaptersOf(locale: FixtureLocale): Chapter[] {
  return threeEditionsBook(locale).chapters.map((c, i) => newChapter(`${locale}-src${i + 1}`, c.title, c.markdown));
}

let record: ProjectRecord;
let counter = 0;

beforeAll(async () => {
  const es = threeEditionsBook('es');
  const built = await buildBundleFiles(
    { id: 'tres', name: 'Tres ediciones', locale: 'es' },
    {
      chapters: chaptersOf('es'),
      config: es.config,
      resources: es.resources,
      localized: Object.fromEntries((['en', 'ca'] as const).map((l) => {
        const book = threeEditionsBook(l);
        return [l, { chapters: chaptersOf(l), config: book.config, resources: book.resources }];
      })),
    },
    { readBlob: async () => PNG.buffer.slice(0) as ArrayBuffer, readFont: async () => null },
  );
  // The archive, read back the way the import reads it.
  const opened = openBundleZip(zipBundle(built.files));
  const read = (locale: string): Promise<LoadedPreset> => parseBundle(opened.manifest, opened.readFile, {
    locale,
    summary: { id: 'tres', name: 'tres', source: 'private', available: true },
    ids: { blob: (f) => `project:p1:${f}`, font: (f) => `project-font:p1:${f}` },
    chapterIds: () => `p1-ch${++counter}`,
    untitledChapter: (n) => `Chapter ${n}`,
  });
  const tags = bundleContentLocales(opened.manifest).locales;
  const picked = await read('es');
  const asides = [];
  for (const tag of tags) if (tag !== picked.locale) asides.push(await read(tag));
  const fields = projectEditionFields(picked, asides, tags);
  record = {
    version: PROJECT_RECORD_VERSION,
    id: 'p1',
    name: 'Tres ediciones',
    locale: picked.locale,
    ...contentOfLoaded(picked),
    ...fields,
    editionsRev: 1,
    createdAt: 1,
    updatedAt: 1,
  } as ProjectRecord;
}, 120_000);

describe('a project imported from a bundle in three languages (#903)', () => {
  it('keeps every edition: the one picked in the record, the others aside, in the bundle\'s order', () => {
    expect(record.locale).toBe('es');
    expect(record.editionLocales).toEqual(['es', 'en', 'ca']);
    expect(Object.keys(record.editions!)).toEqual(['en', 'ca']);
    for (const locale of FIXTURE_LOCALES) {
      const content = editionContentOf(record, locale)!;
      expect(content.chapters.map((c) => c.markdown)).toEqual(threeEditionsBook(locale).chapters.map((c) => c.markdown));
    }
    // Chapters of different editions never share an id (layouts are keyed by it).
    const ids = allEditionChapters(record).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('lists its languages in the summary', () => {
    expect(toSummary(record)).toMatchObject({ locale: 'es', locales: ['es', 'en', 'ca'], editionsRev: 1 });
    const single = { ...record };
    delete single.editions;
    delete single.editionLocales;
    expect(toSummary(single).locales).toBeUndefined();
  });

  it('swaps editions without losing either: the one on screen goes aside as it is', () => {
    const edited = { ...record, chapters: record.chapters.map((c) => ({ ...c, markdown: `${c.markdown}\nEdited.` })) };
    const ca = withActiveEdition(edited, 'ca');
    expect(ca.locale).toBe('ca');
    expect(ca.chapters.map((c) => c.markdown)).toEqual(threeEditionsBook('ca').chapters.map((c) => c.markdown));
    expect(Object.keys(ca.editions!).sort()).toEqual(['en', 'es']);
    expect(ca.editions!.es!.chapters[0]!.markdown.endsWith('Edited.')).toBe(true);
    expect(ca.editionLocales).toEqual(['es', 'en', 'ca']);
    // And back: the Spanish edition is the record's own again, edits kept.
    const es = withActiveEdition(ca, 'es');
    expect(es.locale).toBe('es');
    expect(es.chapters[0]!.markdown.endsWith('Edited.')).toBe(true);
    expect(Object.keys(es.editions!).sort()).toEqual(['ca', 'en']);
    expect(allEditionChapters(es)).toHaveLength(6);
    // The same edition, or one the book lacks: the record itself.
    expect(withActiveEdition(record, 'es')).toBe(record);
    expect(withActiveEdition(record, 'pt')).toBe(record);
    expect(withActiveEdition(record, 'EN').locale).toBe('en');
  });

  it('survives storage: a stored record reads back with its editions', () => {
    const stored = JSON.parse(JSON.stringify(record)) as unknown;
    const back = migrateProjectRecord(stored, { ids: () => 'x', untitled: (n) => `Chapter ${n}` })!;
    expect(back.editionLocales).toEqual(['es', 'en', 'ca']);
    expect(Object.keys(back.editions!)).toEqual(['en', 'ca']);
    expect(back.editions!.ca!.chapters).toHaveLength(2);
    expect(back.editionsRev).toBe(1);
    // A record of one language reads as before.
    const plain = migrateProjectRecord({ ...(stored as object), editions: undefined, editionLocales: undefined }, { ids: () => 'x', untitled: (n) => `Chapter ${n}` })!;
    expect(plain.editions).toBeUndefined();
  });

  it('is exported with every language again (the bundle round trip)', async () => {
    const built = await buildBundleFiles(
      { id: 'tres', name: 'Tres ediciones', locale: record.locale },
      {
        chapters: record.chapters,
        config: record.config,
        resources: record.resources,
        localized: Object.fromEntries(Object.entries(record.editions!).map(([l, e]) => [l, { chapters: e.chapters, config: e.config, resources: e.resources }])),
      },
      { readBlob: async () => PNG.buffer.slice(0) as ArrayBuffer, readFont: async () => null },
    );
    const manifest = built.manifest as { locales?: string[] };
    expect(manifest.locales).toEqual(['es', 'en', 'ca']);
    expect(bundleContentLocales(built.manifest).locales).toEqual(['es', 'en', 'ca']);
  });

  it('is checked in every edition, as a preset is: the same checks on the same frames', async () => {
    const found: string[] = [];
    for (const locale of record.editionLocales!) {
      const content = editionContentOf(record, locale)!;
      const layout = await layOutEdition(
        { locale, chapters: content.chapters, config: content.config, resources: content.resources },
        async (md, config) => buildDocument(md, config),
      );
      for (const c of composedChecksOf(locale, layout.chapters)) {
        found.push(`${c.locale}:${c.warning.payload.kind}:${c.chapterIndex}:${c.fenceIndex}:${c.frame ?? ''}`);
      }
    }
    expect(found.sort()).toEqual([
      'ca:frameOverflow:1:0:dinero',
      'en:slotEmpty:0:1:ahorro',
      'es:slotUnknown:0:1:texto',
    ]);
  }, 120_000);
});
