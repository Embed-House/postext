/**
 * The editions of a book a host links to (#1011): a Cookbook recipe is
 * published as one bundle per language (`#recipe=<slug>&lang=<tag>`), and
 * the book opened from one of them is a project in that language alone.
 * The host says which languages there are (`hashBundleEditions`); the
 * language switcher opens the same link in another one, and the Checks
 * panel and the side-by-side view read another one straight from its
 * bundle, as importing it would read it, without importing it.
 */

import { slugify } from '../panels/resources/slugify.js';
import { openBundleZip, parseBundle } from '../presets/index.js';
import type { LoadedPresetBlob } from '../presets/types.js';
import { generateChapterId } from '../storage/projects.js';
import { putFontFile } from '../storage/fontStorage.js';
import type { HashBundleRef } from '../storage/viewHash.js';
import type { HashBundleResolver } from '../types/props.js';
import { fetchBundleBytes, isSameOriginUrl } from '../context/hashBundle.js';
import { sameLocaleTag } from '../presets/locale.js';
import type { EditionSource } from './editionLayout.js';

/** The primary language subtag (`zh-Hans` → `zh`). */
function primary(tag: string): string {
  return tag.split(/[-_]/)[0]!.toLowerCase();
}

/** The editions of a linked book as the switcher lists them: the host's
 *  languages, the one on screen named by its own tag (a project in
 *  `zh-Hans` opened from the `zh` bundle). Null when there is only one. */
export function linkedEditionLocales(published: readonly string[] | null, activeLocale: string): string[] | null {
  if (!published || published.length < 2) return null;
  const own = primary(activeLocale);
  const list = published.map((l) => (activeLocale !== '' && (sameLocaleTag(l, activeLocale) || primary(l) === own) ? activeLocale : l));
  if (activeLocale !== '' && !list.some((l) => sameLocaleTag(l, activeLocale))) list.unshift(activeLocale);
  return list;
}

/** Read the edition `locale` of linked book `ref` from its bundle: its
 *  chapters, configuration and resources, its pictures (stored by the
 *  edition store before its pages are painted) and its fonts (stored
 *  here, under ids of their own). */
export async function loadLinkedEdition(
  ref: HashBundleRef,
  locale: string,
  resolve: HashBundleResolver,
  pageOrigin: string,
): Promise<{ source: EditionSource; blobs?: readonly LoadedPresetBlob[] }> {
  const resolved = resolve(ref.id, locale);
  const urls = (resolved === null ? [] : typeof resolved === 'string' ? [resolved] : [...resolved])
    .filter((url) => isSameOriginUrl(url, pageOrigin));
  let bytes: ArrayBuffer | null = null;
  for (const url of urls) {
    bytes = await fetchBundleBytes(url).catch(() => null);
    if (bytes) break;
  }
  if (!bytes) throw new Error(`Edition "${locale}" not found`);
  const opened = openBundleZip(new Uint8Array(bytes));
  const scope = slugify(`${ref.key}-${ref.id}-${locale}`);
  const loaded = await parseBundle(opened.manifest, opened.readFile, {
    locale,
    summary: { id: scope, name: ref.id, source: 'private', available: true },
    ids: { blob: (f) => `linked:${scope}:${slugify(f)}`, font: (f) => `linked-font:${scope}:${slugify(f)}` },
    chapterIds: generateChapterId,
    untitledChapter: (n) => `${n}`,
  });
  await Promise.all(loaded.fonts.map((f) => putFontFile(f).catch(() => undefined)));
  return {
    source: {
      locale: loaded.locale,
      chapters: loaded.chapters,
      config: loaded.config,
      resources: loaded.resources,
      ...(loaded.layouts ? { layouts: loaded.layouts } : {}),
      ...(loaded.start ? { start: loaded.start } : {}),
    },
    blobs: loaded.blobs,
  };
}
