// The editions of a local project imported from a bundle in several
// languages (#903). Pure: `projectActions.ts` reads and stores, this decides
// what the record holds.

import { isBundleManifest, pickBundleMeta } from 'postext/bundle';
import type { LoadedPreset } from '../presets';
import { sameLocaleTag } from '../presets/locale';
import type { PostextConfig } from 'postext';
import type { BookContent } from '../book/types';
import { cloneBook } from '../book/chapterOps';
import { relocalizedResourceTypes } from '../context/defaultConfig';
import type { ProjectContent, ProjectEditionTitle, ProjectRecord } from './projects';

/** What a loaded edition gives a record: its chapters (the first active),
 *  canvas scope and start, configuration and resources. */
export function contentOfLoaded(loaded: LoadedPreset): ProjectContent {
  const book: BookContent = {
    chapters: loaded.chapters,
    activeChapterId: loaded.chapters[0]!.id,
    ...(loaded.canvasScope ? { canvasScope: loaded.canvasScope } : {}),
    ...(loaded.start ? { start: loaded.start } : {}),
  };
  return { ...book, config: loaded.config, resources: loaded.resources };
}

export interface ProjectEditionFields {
  /** The editions other than the one the record opens with, by locale. */
  editions: Record<string, ProjectContent>;
  /** Every edition's tag in the bundle's order, the opening one included. */
  editionLocales: string[];
}

/** The edition fields of a record opened on `picked`, with the bundle's
 *  other editions read beside it (`asides`) and the order its manifest
 *  lists them in (`tags`). Undefined for a book in one language. */
export function projectEditionFields(
  picked: Pick<LoadedPreset, 'locale'>,
  asides: readonly LoadedPreset[],
  tags: readonly string[],
): ProjectEditionFields | undefined {
  if (asides.length === 0) return undefined;
  const all = [picked.locale, ...asides.map((l) => l.locale)];
  const editions: Record<string, ProjectContent> = {};
  for (const l of asides) editions[l.locale] = contentOfLoaded(l);
  const listed = tags.map((t) => all.find((l) => sameLocaleTag(l, t)) ?? t);
  const editionLocales = [...new Set([...listed, ...all])];
  return { editions, editionLocales };
}

/** What a bundle's manifest calls each of its editions (`localized.<lang>.name`
 *  and `description`, else the manifest's own, #968), by tag. Undefined for
 *  a manifest that is not valid. */
export function editionTitlesOf(manifest: unknown, tags: readonly string[]): Record<string, ProjectEditionTitle> | undefined {
  if (!isBundleManifest(manifest)) return undefined;
  const out: Record<string, ProjectEditionTitle> = {};
  for (const tag of tags) {
    const meta = pickBundleMeta(manifest, tag);
    if (meta.name) out[tag] = { name: meta.name, ...(meta.description !== undefined ? { description: meta.description } : {}) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The language tag a record is in: the edition it opens with, else the
 *  document language its configuration names, else `fallback`. */
export function recordLocaleOf(record: Pick<ProjectRecord, 'locale' | 'config'>, fallback: string): string {
  return record.locale || record.config.locale || record.config.bodyText?.hyphenation?.locale || fallback;
}

/** Every language tag a record holds an edition in, the one on screen first. */
export function recordEditionTags(record: Pick<ProjectRecord, 'locale' | 'config' | 'editions' | 'editionLocales'>, fallback: string): string[] {
  const own = recordLocaleOf(record, fallback);
  return [...new Set([own, ...(record.editionLocales ?? []), ...Object.keys(record.editions ?? {})])];
}

/** Whether `locale` is one of the languages a record already has (tags
 *  compared without case). */
export function recordHasEdition(record: Pick<ProjectRecord, 'locale' | 'config' | 'editions' | 'editionLocales'>, locale: string, fallback: string): boolean {
  return recordEditionTags(record, fallback).some((t) => sameLocaleTag(t, locale));
}

export interface NewEditionDeps {
  /** A fresh chapter id each call. */
  ids: () => string;
  /** The language to read a record as when it names none (the
   *  interface's). */
  fallbackLocale: string;
}

/** What a new edition in `locale` starts from: the chapters, the
 *  configuration and the resources of `source`, an edition in `from`. The
 *  chapters take ids of their own; the pictures and faces stay the same
 *  files (every edition of a record may point at one, the sweep counts
 *  them all). The document language is `locale`; the built-in figure and
 *  table names that were still those of the old language follow it, and an
 *  explicit hyphenation language, which was the old one's, is dropped so
 *  hyphenation follows the document. */
export function contentForNewEdition(source: ProjectContent, from: string, locale: string, ids: () => string): ProjectContent {
  const book = cloneBook(source, ids);
  const config: PostextConfig = structuredClone(source.config);
  config.locale = locale;
  const types = relocalizedResourceTypes(config.resourceTypes, [from, source.config.locale ?? from], locale);
  if (types) config.resourceTypes = types;
  const hyphenation = config.bodyText?.hyphenation;
  if (hyphenation && hyphenation.locale !== undefined) {
    const { locale: _old, ...rest } = hyphenation;
    void _old;
    config.bodyText = { ...config.bodyText, hyphenation: rest };
  }
  return {
    ...book,
    ...(source.canvasScope ? { canvasScope: source.canvasScope } : {}),
    config,
    resources: structuredClone(source.resources),
  };
}

/** The record with an edition in `locale` added, made from the edition on
 *  screen (copy the chapters, set the document language), and left on
 *  screen as it was: `withActiveEdition` opens the new one. Null when the
 *  record already has that language. */
export function withNewEdition(record: ProjectRecord, locale: string, deps: NewEditionDeps): ProjectRecord | null {
  if (recordHasEdition(record, locale, deps.fallbackLocale)) return null;
  const own = recordLocaleOf(record, deps.fallbackLocale);
  const edition = contentForNewEdition(record, own, locale, deps.ids);
  return {
    ...record,
    locale: own,
    editions: { ...(record.editions ?? {}), [locale]: edition },
    editionLocales: [...recordEditionTags(record, deps.fallbackLocale), locale],
    editionsRev: Date.now(),
  };
}
