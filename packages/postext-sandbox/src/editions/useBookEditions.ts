'use client';

/**
 * The editions of the book on screen (#867): the locales a preset's bundle
 * carries, the one open, and their layouts behind the reader (see
 * `editionStore.ts`). A local project keeps every edition of the bundle
 * it was imported from (#903).
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onFontsChanged } from 'postext';
import { useSandboxPresetProvider, useSandboxSelector } from '../context/SandboxContext';
import { sameLocaleTag } from '../presets/locale';
import { activeEditionLocale, bookEditionLocales } from './bookLocales';
import { editionsOnDemand } from './onDemand';
import { useLayoutService } from '../worker/LayoutServiceContext';
import { onLateFonts } from '../worker/LayoutService';
import { askEditions, editionEntry, editionsAsked, editionsVersion, ensureEdition, loadPresetEdition, loadProjectEdition, subscribeEditions, type EditionEntry } from './editionStore';

export interface BookEditions {
  /** `preset:<id>` or `project:<id>`. */
  bookKey: string;
  /** The preset on screen, null for a local project. */
  presetId: string | null;
  /** The local project on screen, null for a preset. */
  projectId: string | null;
  /** Every edition, in the bundle's order (a project keeps the ones it was
   *  imported with, #903). */
  locales: string[];
  /** The edition on screen (`''` when the book names no language). */
  activeLocale: string;
  /** Their layouts, by locale. */
  entries: Record<string, EditionEntry | undefined>;
  /** The book is big enough to wait for the reader's word before its
   *  editions are laid out (`onDemand`, #952): nothing is, yet. */
  waiting: boolean;
  /** Lay every edition out now (what the Checks panel's button does). */
  layOutNow: () => void;
}

/** How long the book on screen rests before its other chapters are laid
 *  out again for the checks. */
const ACTIVE_EDITION_DEBOUNCE_MS = 1500;

/** The editions of the book on screen; with `enabled`, laid out behind the
 *  reader (the Checks panel, the side-by-side view). `only` limits the
 *  layouts to some locales. With `onDemand`, a book too big to lay out
 *  unasked (see `editionsOnDemand`) waits until `layOutNow` is called, once
 *  per book for the session. */
export function useBookEditions(enabledAsked: boolean, only?: readonly string[], options: { onDemand?: boolean } = {}): BookEditions {
  const activeProjectId = useSandboxSelector((s) => s.activeProjectId);
  const activePresetId = useSandboxSelector((s) => s.activePresetId);
  const appliedLocale = useSandboxSelector((s) => (s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale ?? null : null));
  const summary = useSandboxSelector((s) => s.presetSummaries.find((p) => p.id === s.activePresetId));
  const project = useSandboxSelector((s) => (s.activeProjectId === null ? undefined : s.projects.find((p) => p.id === s.activeProjectId)));
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
  const activeLocale = activeEditionLocale({ presetId, appliedLocale, projectLocale: project?.locale, configLocale: config.locale });
  const projectLocales = project?.locales;
  const locales = useMemo(
    () => bookEditionLocales({ presetId, summary, projectLocales, activeLocale }),
    [presetId, summary, projectLocales, activeLocale],
  );
  const waiting = enabledAsked && options.onDemand === true && editionsOnDemand(chapters.length, locales.length) && !editionsAsked(bookKey);
  // A book waiting for the reader's word lays nothing out.
  const enabled = enabledAsked && !waiting;
  const layOutNow = useCallback(() => askEditions(bookKey), [bookKey]);
  const editionsRev = project?.editionsRev;
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

  // The other editions of a local project: the content its record keeps
  // aside for them (#903).
  useEffect(() => {
    if (!enabled || presetId !== null || activeProjectId === null || locales.length < 2) return;
    const timer = setTimeout(() => {
      for (const locale of locales) {
        if (sameLocaleTag(locale, activeLocale)) continue;
        if (only && !only.some((l) => sameLocaleTag(l, locale))) continue;
        ensureEdition({
          bookKey,
          locale,
          // Moves when the editions swap places (an import, a switch), not
          // with every autosave of the edition on screen.
          identity: [editionsRev ?? 'original', fontsEpoch],
          other: true,
          service,
          load: () => loadProjectEdition(activeProjectId, locale),
        });
      }
    }, fontsEpoch === 0 ? 0 : ACTIVE_EDITION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `only` is read through its key
  }, [enabled, presetId, activeProjectId, bookKey, locales, activeLocale, editionsRev, service, onlyKey, fontsEpoch]);

  // The other editions of a preset: their draft, else the bundle's text.
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

  return { bookKey, presetId, projectId: activeProjectId, locales, activeLocale, entries, waiting, layOutNow };
}
