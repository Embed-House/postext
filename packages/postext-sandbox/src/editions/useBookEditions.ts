'use client';

/**
 * The editions of the book on screen (#867): the locales a preset's bundle
 * carries, the one open, and their layouts behind the reader (see
 * `editionStore.ts`). A local project holds the one edition it was
 * imported in.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onFontsChanged } from 'postext';
import { useSandboxPresetProvider, useSandboxSelector } from '../context/SandboxContext';
import { presetLocales, sameLocaleTag } from '../presets/locale';
import { useLayoutService } from '../worker/LayoutServiceContext';
import { onLateFonts } from '../worker/LayoutService';
import { editionEntry, editionsVersion, ensureEdition, loadPresetEdition, subscribeEditions, type EditionEntry } from './editionStore';

export interface BookEditions {
  /** `preset:<id>` or `project:<id>`. */
  bookKey: string;
  /** The preset on screen, null for a local project. */
  presetId: string | null;
  /** Every edition, in the bundle's order (the one on screen alone for a
   *  project). */
  locales: string[];
  /** The edition on screen (`''` when the book names no language). */
  activeLocale: string;
  /** Their layouts, by locale. */
  entries: Record<string, EditionEntry | undefined>;
}

/** How long the book on screen rests before its other chapters are laid
 *  out again for the checks. */
const ACTIVE_EDITION_DEBOUNCE_MS = 1500;

/** The editions of the book on screen; with `enabled`, laid out behind the
 *  reader (the Checks panel, the side-by-side view). `only` limits the
 *  layouts to some locales. */
export function useBookEditions(enabled: boolean, only?: readonly string[]): BookEditions {
  const activeProjectId = useSandboxSelector((s) => s.activeProjectId);
  const activePresetId = useSandboxSelector((s) => s.activePresetId);
  const appliedLocale = useSandboxSelector((s) => (s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale ?? null : null));
  const summary = useSandboxSelector((s) => s.presetSummaries.find((p) => p.id === s.activePresetId));
  const drafts = useSandboxSelector((s) => s.presetDrafts);
  const chapters = useSandboxSelector((s) => s.chapters);
  const config = useSandboxSelector((s) => s.config);
  const resources = useSandboxSelector((s) => s.resources);
  const chapterLayouts = useSandboxSelector((s) => s.chapterLayouts);
  const bookStart = useSandboxSelector((s) => s.bookStart);
  const presetProvider = useSandboxPresetProvider();
  const service = useLayoutService();
  const version = useSyncExternalStore(subscribeEditions, editionsVersion, editionsVersion);

  const presetId = activeProjectId === null ? activePresetId : null;
  const bookKey = presetId !== null ? `preset:${presetId}` : `project:${activeProjectId}`;
  const activeLocale = appliedLocale ?? config.locale ?? '';
  const locales = useMemo(() => {
    const listed = presetId !== null && summary ? presetLocales(summary) : [];
    if (listed.length === 0) return [activeLocale];
    return listed.some((l) => sameLocaleTag(l, activeLocale)) || activeLocale === '' ? listed : [activeLocale, ...listed];
  }, [presetId, summary, activeLocale]);
  const onlyKey = only?.join('|') ?? '';
  // Faces that land after a layout measured it without them: the editions
  // are laid out again, as the previews are.
  const [fontsEpoch, setFontsEpoch] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setFontsEpoch((e) => e + 1);
    const off = onFontsChanged(bump);
    const offLate = onLateFonts(bump);
    return () => {
      off();
      offLate();
    };
  }, [enabled]);

  // The book on screen: its live chapters, laid out a moment after the
  // last edit.
  useEffect(() => {
    if (!enabled) return;
    if (only && !only.some((l) => sameLocaleTag(l, activeLocale))) return;
    const timer = setTimeout(() => {
      ensureEdition({
        bookKey,
        locale: activeLocale,
        identity: [chapters, config, resources, chapterLayouts, bookStart, fontsEpoch],
        other: false,
        service,
        load: async () => ({
          source: {
            locale: activeLocale,
            chapters,
            config,
            resources,
            layouts: chapterLayouts,
            ...(bookStart ? { start: bookStart } : {}),
          },
        }),
      });
    }, ACTIVE_EDITION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `only` is read through its key
  }, [enabled, bookKey, activeLocale, chapters, config, resources, chapterLayouts, bookStart, service, onlyKey, fontsEpoch]);

  // The other editions: their draft, else the bundle's text.
  useEffect(() => {
    if (!enabled || presetId === null) return;
    const provider = presetProvider(presetId);
    if (!provider) return;
    // A moment after the faces settle (they land in bursts on a first visit).
    const timer = setTimeout(() => {
      for (const locale of locales) {
        if (sameLocaleTag(locale, activeLocale)) continue;
        if (only && !only.some((l) => sameLocaleTag(l, locale))) continue;
        const draft = drafts.find((d) => d.presetId === presetId && sameLocaleTag(d.locale, locale));
        ensureEdition({
          bookKey,
          locale,
          identity: [draft?.updatedAt ?? 'original', fontsEpoch],
          other: true,
          service,
          load: () => loadPresetEdition(provider, locale, drafts),
        });
      }
    }, fontsEpoch === 0 ? 0 : ACTIVE_EDITION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `only` is read through its key
  }, [enabled, presetId, bookKey, locales, activeLocale, drafts, presetProvider, service, onlyKey, fontsEpoch]);

  const entries = useMemo(() => {
    const out: Record<string, EditionEntry | undefined> = {};
    for (const l of locales) out[l] = editionEntry(bookKey, l);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` changes with every entry
  }, [bookKey, locales, version]);

  return { bookKey, presetId, locales, activeLocale, entries };
}
