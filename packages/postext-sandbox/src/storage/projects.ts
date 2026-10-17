// Local projects: user-owned documents kept in the 'projects' object store of
// the shared `postext-sandbox` IndexedDB database. A record carries the three
// working slices (markdown, config, resource records); the binary payloads it
// references (resource blobs, font files) stay in their own stores, keyed by
// `fileId`, and are reference-counted across every project by the GC in the
// provider (see `referencedFileIds`).

import type { PostextConfig, Resource } from 'postext';
import { stripConfigDefaults } from 'postext';
import type { BookContent } from '../book/types';
import { PROJECTS_STORE, hasIndexedDB, runInStore, withTransaction } from './blobStore';
import { generateId } from './ids';
import { PROJECT_RECORD_VERSION, migrateProjectRecord, type MigrationDeps } from './projectMigration';

/** The three working slices a project owns: its chapters (with the active
 *  one), the configuration and the resource records. */
export interface ProjectContent extends BookContent {
  config: PostextConfig;
  resources: Resource[];
}

/** A project's cover picture: the image shown beside its name in the
 *  projects panel, kept as a blob of its own (never a resource of the
 *  book). Cloning a showcase preset adopts the bundle's `thumbnail`; an
 *  export writes it back under that name. */
export interface ProjectThumbnail {
  fileId: string;
  /** Media type of the stored bytes (`image/jpeg`, `image/svg+xml`…). */
  mime: string;
}

/** One edition of a project imported from a bundle in several languages
 *  (#903): what a record holds of the book (chapters, configuration,
 *  resources). The record's own content is the edition on screen
 *  (`ProjectRecord.locale`); the others are kept aside in `editions`, by
 *  locale tag, and swap places with it when the reader switches. */
export type ProjectEditionContent = ProjectContent;

export interface ProjectRecord extends ProjectContent {
  /** Record shape; legacy records (single `markdown`) are migrated on read. */
  version: typeof PROJECT_RECORD_VERSION;
  /** Storage key; a random UUID, never shown to the user. */
  id: string;
  name: string;
  description?: string;
  locale?: string;
  /** Manifest id written on export. Kept from an imported bundle (or the
   *  preset the project was duplicated from); otherwise derived from the name
   *  at export time. */
  bundleId?: string;
  /** Preset the project descends from, when any; Reset restores it. */
  sourcePresetId?: string;
  /** Cover picture, when the project has one (see {@link ProjectThumbnail}). */
  thumbnail?: ProjectThumbnail;
  /** Where an imported book came from, when a link opened it: the host's
   *  hash key, the id and the locale (`recipe:<slug>:<lang>`, see
   *  `hashBundles`). The same link opens this project again instead of
   *  importing a second copy. */
  origin?: string;
  /** The editions other than the one in the record's own content, by
   *  locale tag (a bundle imported with several languages keeps them all,
   *  #903). Absent for a book in one language. */
  editions?: Record<string, ProjectEditionContent>;
  /** Every edition's tag, in the bundle's order, the record's own
   *  included. Present with `editions`. */
  editionLocales?: string[];
  /** When the set of other editions last changed (an import, a switch):
   *  the checks and the side-by-side view lay an edition out again when it
   *  moves, not at every autosave. */
  editionsRev?: number;
  createdAt: number;
  updatedAt: number;
}

export type ProjectSummary = Pick<
  ProjectRecord,
  'id' | 'name' | 'description' | 'locale' | 'bundleId' | 'sourcePresetId' | 'thumbnail' | 'origin' | 'createdAt' | 'updatedAt'
> & {
  chapterCount: number;
  /** The editions of a book in several languages (two or more). */
  locales?: string[];
  editionsRev?: number;
};

export function toSummary(r: ProjectRecord): ProjectSummary {
  const { id, name, description, locale, bundleId, sourcePresetId, thumbnail, origin, createdAt, updatedAt } = r;
  const locales = r.editions && r.editionLocales && r.editionLocales.length > 1 ? r.editionLocales : undefined;
  return {
    id, name, description, locale, bundleId, sourcePresetId, thumbnail, ...(origin ? { origin } : {}), createdAt, updatedAt, chapterCount: r.chapters.length,
    ...(locales ? { locales, ...(r.editionsRev !== undefined ? { editionsRev: r.editionsRev } : {}) } : {}),
  };
}

const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The record with the edition `locale` on screen: its content moves to
 *  the record's own fields and the edition that was there goes aside, so
 *  nothing is lost either way. The same record when `locale` is already
 *  the record's, or no edition has it. Pure. */
export function withActiveEdition(record: ProjectRecord, locale: string): ProjectRecord {
  const editions = record.editions;
  if (!editions || (record.locale !== undefined && sameTag(record.locale, locale))) return record;
  const key = Object.keys(editions).find((k) => sameTag(k, locale));
  if (key === undefined) return record;
  const target = editions[key]!;
  const { [key]: _taken, ...rest } = editions;
  void _taken;
  const aside: ProjectEditionContent = {
    chapters: record.chapters,
    activeChapterId: record.activeChapterId,
    ...(record.canvasScope ? { canvasScope: record.canvasScope } : {}),
    ...(record.start ? { start: record.start } : {}),
    config: record.config,
    resources: record.resources,
  };
  const nextEditions = record.locale !== undefined ? { ...rest, [record.locale]: aside } : rest;
  const next: ProjectRecord = {
    ...record,
    chapters: target.chapters,
    activeChapterId: target.activeChapterId,
    config: target.config,
    resources: target.resources,
    locale: key,
    editions: nextEditions,
    editionsRev: Date.now(),
  };
  if (target.canvasScope) next.canvasScope = target.canvasScope;
  else delete next.canvasScope;
  if (target.start) next.start = target.start;
  else delete next.start;
  return next;
}

/** The content of an edition of a record: its own when `locale` is the
 *  record's, else the one aside. */
export function editionContentOf(record: ProjectRecord, locale: string): ProjectEditionContent | null {
  if (record.locale === undefined || sameTag(record.locale, locale)) return record;
  const key = Object.keys(record.editions ?? {}).find((k) => sameTag(k, locale));
  return key === undefined ? null : record.editions![key]!;
}

/** The chapters of every edition of a record (the active one first). */
export function allEditionChapters(record: Pick<ProjectRecord, 'chapters' | 'editions'>): ProjectContent['chapters'] {
  return [...record.chapters, ...Object.values(record.editions ?? {}).flatMap((e) => e.chapters)];
}

function strippedEditions(editions: Record<string, ProjectEditionContent> | undefined): Record<string, ProjectEditionContent> | undefined {
  if (!editions) return undefined;
  return Object.fromEntries(Object.entries(editions).map(([k, e]) => [k, { ...e, config: stripConfigDefaults(e.config) }]));
}

export function generateProjectId(): string {
  return generateId('project');
}

export function generateChapterId(): string {
  return generateId('chapter');
}

const DEFAULT_MIGRATION: MigrationDeps = { ids: generateChapterId, untitled: (n) => `Chapter ${n}` };

/** Every stored project, oldest first, migrated to the current record
 *  shape. Empty (not rejected) without IndexedDB so the sandbox still works
 *  in preset-only mode. */
export function listProjects(migration: MigrationDeps = DEFAULT_MIGRATION): Promise<ProjectRecord[]> {
  if (!hasIndexedDB()) return Promise.resolve([]);
  return runInStore(PROJECTS_STORE, 'readonly', (store) =>
    store.getAll() as IDBRequest<unknown[]>,
  )
    .then((v) => (v ?? [])
      .map((raw) => migrateProjectRecord(raw, migration))
      .filter((r): r is ProjectRecord => r !== null)
      .sort((a, b) => a.createdAt - b.createdAt))
    .catch(() => []);
}

export function getProject(id: string, migration: MigrationDeps = DEFAULT_MIGRATION): Promise<ProjectRecord | null> {
  return runInStore(PROJECTS_STORE, 'readonly', (store) =>
    store.get(id) as IDBRequest<unknown>,
  ).then((v) => (v === undefined ? null : migrateProjectRecord(v, migration)));
}

/** Write a record as-is (config stored stripped of defaults, like
 *  localStorage, so records stay small and survive default changes). */
export function putProject(record: ProjectRecord): Promise<void> {
  const editions = strippedEditions(record.editions);
  const stored: ProjectRecord = { ...record, version: PROJECT_RECORD_VERSION, config: stripConfigDefaults(record.config), ...(editions ? { editions } : {}) };
  return runInStore(PROJECTS_STORE, 'readwrite', (store) =>
    store.put(stored) as IDBRequest<IDBValidKey>,
  ).then(() => undefined);
}

export type ProjectPatch = Partial<Omit<ProjectRecord, 'id' | 'createdAt'>>;

/** Merge `patch` into a stored record and bump `updatedAt`, in one
 *  transaction: the autosave and a background write (a cover captured
 *  from the first page) may update the same record at once, and neither
 *  may drop what the other wrote. `patch` may be a function of the stored
 *  record; returning null leaves it untouched (and resolves to it). */
export function updateProject(
  id: string,
  patch: ProjectPatch | ((existing: ProjectRecord) => ProjectPatch | null),
): Promise<ProjectRecord | null> {
  return withTransaction(PROJECTS_STORE, 'readwrite', async (store) => {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
    const existing = raw === undefined ? null : migrateProjectRecord(raw, DEFAULT_MIGRATION);
    if (!existing) return null;
    const changes = typeof patch === 'function' ? patch(existing) : patch;
    if (!changes) return existing;
    const next: ProjectRecord = { ...existing, ...changes, id, createdAt: existing.createdAt, updatedAt: Date.now() };
    const editions = strippedEditions(next.editions);
    store.put({ ...next, version: PROJECT_RECORD_VERSION, config: stripConfigDefaults(next.config), ...(editions ? { editions } : {}) });
    return next;
  });
}

export function deleteProject(id: string): Promise<void> {
  return runInStore(PROJECTS_STORE, 'readwrite', (store) =>
    store.delete(id) as IDBRequest<undefined>,
  ).then(() => undefined);
}

export interface ReferencedFileIds {
  blobIds: Set<string>;
  fontIds: Set<string>;
}

/** File ids a content slice points at: bitmap/SVG blobs and custom-font
 *  variants. Pure. */
export function referencedFileIds(content: { resources: Resource[]; config: PostextConfig; thumbnail?: ProjectThumbnail }): ReferencedFileIds {
  const blobIds = new Set<string>();
  const fontIds = new Set<string>();
  for (const r of content.resources) {
    const fileId = r.bitmap?.fileId ?? r.svg?.fileId;
    if (fileId) blobIds.add(fileId);
    // An SVG's vector print master is a blob of its own.
    if (r.svg?.pdfFileId) blobIds.add(r.svg.pdfFileId);
    // A video's file and its poster (#454).
    if (r.video?.fileId) blobIds.add(r.video.fileId);
    if (r.video?.poster?.fileId) blobIds.add(r.video.poster.fileId);
  }
  // The cover picture is a blob of the project, referenced by no resource.
  if (content.thumbnail) blobIds.add(content.thumbnail.fileId);
  // An uploaded output profile (`print.customProfile`).
  if (content.config.print?.customProfile) blobIds.add(content.config.print.customProfile.fileId);
  for (const family of content.config.customFonts ?? []) {
    for (const v of family.variants) fontIds.add(v.fileId);
  }
  return { blobIds, fontIds };
}

/** Union of `referencedFileIds` over every stored project. */
export async function collectProjectFileIds(): Promise<ReferencedFileIds> {
  const out: ReferencedFileIds = { blobIds: new Set(), fontIds: new Set() };
  for (const p of await listProjects()) {
    // The editions aside keep their pictures and faces too (#903).
    for (const part of [p, ...Object.values(p.editions ?? {})]) {
      const refs = referencedFileIds(part);
      for (const id of refs.blobIds) out.blobIds.add(id);
      for (const id of refs.fontIds) out.fontIds.add(id);
    }
  }
  return out;
}
