/**
 * Renaming a frame of a page template together with the page fences that
 * fill it (#979). A frame name is the slot name the Markdown writes
 * (`:::frame{slot="…"}`), so renaming one alone leaves every page that
 * used it with a `slotUnknown`. This is the rename for a whole edition: its
 * templates and its chapters. The Design panel does it for the edition on
 * screen; a local project that keeps other editions does it for each of
 * them (`renameFrameInEditions` in the project actions).
 */

import type { PageTemplate } from 'postext';
import { applyTextChanges } from '../book/textChanges';
import { ancestorsOf, frameFamily, namesInUse, renameFrame, templateAt } from './templateEdits';
import { renameSlotChanges } from './templateUsage';

/** What an edition holds that a frame rename touches. */
export interface EditionText {
  config: { pageTemplates?: PageTemplate[] };
  chapters: { markdown: string }[];
}

function hasFrame(templates: readonly PageTemplate[], id: string, name: string): boolean {
  if (!templateAt(templates, id)) return false;
  return [id, ...ancestorsOf(templates, id)].some((tid) => {
    const t = templateAt(templates, tid)?.template;
    return !!t && [t, t.variants?.recto, t.variants?.verso].some((p) => p?.frames?.some((f) => f.name === name));
  });
}

/**
 * `edition` with frame `from` of template `templateId` renamed `to` in its
 * templates and in the page fences of its chapters that use a template
 * sharing the frame; null when the edition has no such template or frame,
 * or already uses `to` there (it is left as it is).
 */
export function renameFrameInEdition<E extends EditionText>(edition: E, templateId: string, from: string, to: string): E | null {
  const templates = edition.config.pageTemplates ?? [];
  if (!hasFrame(templates, templateId, from) || namesInUse(templates, templateId).has(to)) return null;
  const family = new Set(frameFamily(templates, templateId, from));
  const pageTemplates = renameFrame(templates, templateId, from, to);
  const chapters = edition.chapters.map((ch) => {
    const changes = renameSlotChanges(ch.markdown, family, from, to);
    if (changes.length === 0) return ch;
    return { ...ch, markdown: applyTextChanges(ch.markdown, changes) };
  });
  return { ...edition, config: { ...edition.config, pageTemplates }, chapters } as E;
}
