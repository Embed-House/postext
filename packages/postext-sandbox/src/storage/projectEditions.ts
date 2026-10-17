// The editions of a local project imported from a bundle in several
// languages (#903). Pure: `projectActions.ts` reads and stores, this decides
// what the record holds.

import type { LoadedPreset } from '../presets';
import { sameLocaleTag } from '../presets/locale';
import type { BookContent } from '../book/types';
import type { ProjectContent } from './projects';

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
