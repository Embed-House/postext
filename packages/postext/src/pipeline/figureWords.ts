/**
 * The words a `:::figure` says in its own edition (#935): its `alt`,
 * `caption` and `note`, from the fence's attributes or from `::alt[…]`,
 * `::caption[…]` and `::note[…]` lines, take the place of the resource's
 * (`altText`, `caption`, `note`) for the pages of that chapter. The
 * resource keeps one picture and one list of anchors; each Markdown file
 * brings the words of its language.
 */

import type { ContentBlock } from '../parse/types';
import type { Resource } from '../types';

/** What a figure says, by the resource field it replaces. */
export type FigureWordOverride = Partial<Pick<Resource, 'altText' | 'caption' | 'note'>>;

/**
 * The words of the `:::figure` blocks of `blocks`, by resource id. A
 * resource set by two figures takes the words of the first.
 */
export function figureWordOverrides(blocks: readonly ContentBlock[]): Map<string, FigureWordOverride> {
  const out = new Map<string, FigureWordOverride>();
  for (const block of blocks) {
    const words = block.figure?.words;
    const id = block.resourceId;
    if (!words || !id || out.has(id)) continue;
    const override: FigureWordOverride = {};
    if (words.alt) override.altText = words.alt.text;
    if (words.caption) override.caption = words.caption.text;
    if (words.note) override.note = words.note.text;
    if (Object.keys(override).length > 0) out.set(id, override);
  }
  return out;
}

/** `resources` with the figures' own words applied; the same array when no
 *  figure gives any, and the resources a figure leaves alone as they are. */
export function withFigureWords(resources: readonly Resource[], blocks: readonly ContentBlock[]): Resource[] {
  const overrides = figureWordOverrides(blocks);
  if (overrides.size === 0) return resources as Resource[];
  return resources.map((r) => {
    const override = overrides.get(r.id);
    return override ? { ...r, ...override } : r;
  });
}
