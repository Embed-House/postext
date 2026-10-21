/**
 * Which editions the book on screen has and which one is open (#867,
 * #903): shared by the Checks panel's hook and the WebMCP checks (#952), so
 * both lay out the same editions.
 */

import type { SandboxState } from '../context/SandboxContext.js';
import { presetLocales, sameLocaleTag } from '../presets/locale.js';
import type { PresetSummary } from '../presets/types.js';

/** The edition on screen (`''` when the book names no language). A preset's
 *  is the language it was applied in, a project's its record's. */
export function activeEditionLocale(book: {
  presetId: string | null;
  appliedLocale: string | null;
  projectLocale: string | undefined;
  configLocale: string | undefined;
}): string {
  return book.presetId === null ? book.projectLocale ?? book.configLocale ?? '' : book.appliedLocale ?? book.configLocale ?? '';
}

/** Every edition, in the bundle's order; the one on screen is always in the
 *  list, first when the bundle does not name it. */
export function bookEditionLocales(book: {
  presetId: string | null;
  summary: PresetSummary | undefined;
  projectLocales: readonly string[] | undefined;
  activeLocale: string;
}): string[] {
  const listed = book.presetId !== null && book.summary ? presetLocales(book.summary) : [...(book.projectLocales ?? [])];
  if (listed.length === 0) return [book.activeLocale];
  return listed.some((l) => sameLocaleTag(l, book.activeLocale)) || book.activeLocale === '' ? listed : [book.activeLocale, ...listed];
}

/** The editions of the book a store state holds, read as the hook reads
 *  them. */
export function bookEditionsOf(s: SandboxState): {
  bookKey: string;
  presetId: string | null;
  projectId: string | null;
  locales: string[];
  activeLocale: string;
} {
  const presetId = s.activeProjectId === null ? s.activePresetId : null;
  const project = s.activeProjectId === null ? undefined : s.projects.find((p) => p.id === s.activeProjectId);
  const appliedLocale = s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale ?? null : null;
  const activeLocale = activeEditionLocale({ presetId, appliedLocale, projectLocale: project?.locale, configLocale: s.config.locale });
  const summary = s.presetSummaries.find((p) => p.id === s.activePresetId);
  return {
    bookKey: presetId !== null ? `preset:${presetId}` : `project:${s.activeProjectId}`,
    presetId,
    projectId: s.activeProjectId,
    locales: bookEditionLocales({ presetId, summary, projectLocales: project?.locales, activeLocale }),
    activeLocale,
  };
}
