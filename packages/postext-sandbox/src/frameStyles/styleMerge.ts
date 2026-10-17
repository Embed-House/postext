/**
 * Merging callout styles (#873): every reference to the styles merged —
 * the `style` of a template frame (the template's own frames and its
 * variants') and the `type` of a `:::callout` fence in any chapter — is
 * rewritten to the style kept, and the merged styles leave the list. The
 * kept style takes the place of the first of the group, so a fence that
 * names no style (it takes the first of the list) keeps the look it had
 * when the first style was one of the group.
 *
 * Renaming a style rewrites the same references. How the rewrite enters
 * the undo history: ./applyRewrite.
 */

import { calloutStyleChain, inheritCalloutStyles, type CalloutStyleConfig, type FrameConfig, type PageTemplate, type PageTemplatePatch, type PostextConfig, type ResolvedCalloutStyleConfig } from 'postext';
import { applyTextChanges, changesApply, type TextChange } from '../book/textChanges';
import { retypeCalloutChanges } from './calloutFences';
import { differingGroups, POSITION_FIELDS, type CompareOptions } from './styleCompare';
import type { StyleUsage, UsageChapter } from './styleUsage';

export interface ChapterRewrite {
  chapterId: string;
  chapterIndex: number;
  changes: TextChange[];
  /** Length of the chapter before the changes. */
  baseLength: number;
}

export interface FrameRewrite {
  templateId: string;
  frame: string;
  scope: 'base' | 'recto' | 'verso';
  from: string;
}

export interface StyleRewritePlan {
  /** The style every reference ends up naming. */
  to: string;
  /** The styles whose references are rewritten. */
  from: string[];
  calloutStyles: CalloutStyleConfig[];
  /** Unchanged (the same array) when no frame names a merged style. */
  pageTemplates: PageTemplate[] | undefined;
  chapters: ChapterRewrite[];
  frames: FrameRewrite[];
  /** Fences rewritten, all chapters together. */
  fenceCount: number;
  /** Styles kept for the place of their boxes (#905), based on the kept
   *  style: their fences are not rewritten. */
  stays: string[];
}

function retypeFrames(frames: FrameConfig[] | undefined, renames: ReadonlyMap<string, string>, found: (frame: string, style: string) => void): FrameConfig[] | undefined {
  if (!frames) return frames;
  let changed = false;
  const next = frames.map((f) => {
    if (typeof f.style !== 'string' || !renames.has(f.style)) return f;
    changed = true;
    found(f.name, f.style);
    return { ...f, style: renames.get(f.style)! };
  });
  return changed ? next : frames;
}

/** `templates` with every frame `style` that is a key of `renames`
 *  naming its value. */
export function retypeTemplates(
  templates: readonly PageTemplate[] | undefined,
  renames: ReadonlyMap<string, string>,
  rewrites: FrameRewrite[] = [],
): PageTemplate[] | undefined {
  if (!templates) return undefined;
  let changed = false;
  const next = templates.map((t) => {
    const note = (scope: FrameRewrite['scope']) => (frame: string, style: string) => rewrites.push({ templateId: t.id, frame, scope, from: style });
    const frames = retypeFrames(t.frames, renames, note('base'));
    const patch = (p: PageTemplatePatch | undefined, scope: 'recto' | 'verso'): PageTemplatePatch | undefined => {
      if (!p) return p;
      const f = retypeFrames(p.frames, renames, note(scope));
      return f === p.frames ? p : { ...p, frames: f };
    };
    const recto = patch(t.variants?.recto, 'recto');
    const verso = patch(t.variants?.verso, 'verso');
    if (frames === t.frames && recto === t.variants?.recto && verso === t.variants?.verso) return t;
    changed = true;
    const out: PageTemplate = { ...t, ...(frames ? { frames } : {}) };
    if (t.variants) out.variants = { ...t.variants, ...(recto ? { recto } : {}), ...(verso ? { verso } : {}) };
    return out;
  });
  return changed ? next : (templates as PageTemplate[]);
}

function chapterRewrites(chapters: readonly UsageChapter[], renames: ReadonlyMap<string, string>): ChapterRewrite[] {
  const out: ChapterRewrite[] = [];
  chapters.forEach((ch, chapterIndex) => {
    const changes = retypeCalloutChanges(ch.markdown, renames);
    if (changes.length > 0) out.push({ chapterId: ch.id, chapterIndex, changes, baseLength: ch.markdown.length });
  });
  return out;
}

export interface MergeGroup {
  keep: string;
  merge: readonly string[];
}

/** The styles of a merge whose `:::callout` boxes stand elsewhere than the
 *  kept style's (#905): a setting of where a box stands differs (see
 *  `POSITION_FIELDS`) and boxes of the text use them. Each maps to what it
 *  keeps of its own, those settings as the engine resolves them, so that
 *  based on the kept style it stands where it stood. */
export function placesToKeep(
  groups: readonly MergeGroup[],
  library: { styles: readonly CalloutStyleConfig[]; resolved: readonly ResolvedCalloutStyleConfig[]; usage: ReadonlyMap<string, StyleUsage> },
  compare: CompareOptions = {},
): Map<string, Partial<CalloutStyleConfig>> {
  const resolvedOf = new Map(library.styles.map((s, i) => [s.id, library.resolved[i]]));
  const out = new Map<string, Partial<CalloutStyleConfig>>();
  for (const g of groups) {
    const kept = resolvedOf.get(g.keep);
    if (!kept) continue;
    for (const id of g.merge) {
      const own = resolvedOf.get(id);
      if (!own || id === g.keep || (library.usage.get(id)?.fenceCount ?? 0) === 0) continue;
      const place = differingGroups(kept, own, compare).filter((f) => POSITION_FIELDS.has(f));
      if (place.length === 0) continue;
      out.set(id, Object.fromEntries(place.map((f) => [f, structuredClone((own as unknown as Record<string, unknown>)[f])])) as Partial<CalloutStyleConfig>);
    }
  }
  return out;
}

/** What merging each group's `merge` into its `keep` changes in the book,
 *  every group in one rewrite. A style of `places` (`placesToKeep`) is not
 *  merged away: it stays with only its place, based on the kept style
 *  (#905), so its boxes keep the look of the kept one and do not move. */
export function planMerges(
  config: Pick<PostextConfig, 'calloutStyles' | 'pageTemplates'>,
  styles: readonly CalloutStyleConfig[],
  chapters: readonly UsageChapter[],
  groups: readonly MergeGroup[],
  places: ReadonlyMap<string, Partial<CalloutStyleConfig>> = new Map(),
): StyleRewritePlan {
  const renames = new Map<string, string>();
  const thin = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.merge) {
      if (id === g.keep || renames.has(id) || thin.has(id)) continue;
      if (places.has(id)) thin.set(id, g.keep);
      else renames.set(id, g.keep);
    }
  }
  // A kept style is never itself merged away by another group.
  for (const g of groups) renames.delete(g.keep);
  const ids = styles.map((s) => s.id);
  const placeOf = new Map<number, CalloutStyleConfig>();
  for (const g of groups) {
    let kept = styles.find((s) => s.id === g.keep);
    if (!kept) continue;
    // A kept style based (however far up) on a style merged into it would
    // end up based on itself: it takes its inherited settings in and stands
    // on its own, its look unchanged (#964).
    const keptAt = ids.indexOf(g.keep);
    const above = calloutStyleChain(styles, keptAt).chain.slice(1).map((i) => ids[i]!);
    if (above.some((id) => renames.has(id) || thin.has(id))) kept = inheritCalloutStyles(styles)[keptAt] ?? kept;
    const at = ids.findIndex((id) => id === g.keep || renames.get(id) === g.keep);
    if (at >= 0) placeOf.set(at, kept);
  }
  const keptIds = new Set(groups.map((g) => g.keep));
  const calloutStyles: CalloutStyleConfig[] = [];
  styles.forEach((s, i) => {
    const kept = placeOf.get(i);
    const base = thin.get(s.id);
    if (kept) calloutStyles.push(kept);
    else if (base !== undefined) calloutStyles.push({ id: s.id, ...(s.name !== undefined ? { name: s.name } : {}), extends: base, ...places.get(s.id) });
    else if (!keptIds.has(s.id) && !renames.has(s.id)) calloutStyles.push(s);
  });
  // A style based on one merged away (#905) is based on the kept one.
  calloutStyles.forEach((s, i) => {
    if (s.extends !== undefined && renames.has(s.extends)) calloutStyles[i] = { ...s, extends: renames.get(s.extends)! };
  });
  const frames: FrameRewrite[] = [];
  const pageTemplates = retypeTemplates(config.pageTemplates, renames, frames);
  const rewrites = chapterRewrites(chapters, renames);
  return {
    to: groups.length === 1 ? groups[0]!.keep : '',
    from: [...renames.keys()],
    calloutStyles,
    pageTemplates,
    chapters: rewrites,
    frames,
    fenceCount: rewrites.reduce((n, c) => n + c.changes.length, 0),
    stays: [...thin.keys()],
  };
}

/** What merging `merge` into `keep` changes in the book. */
export function planMerge(
  config: Pick<PostextConfig, 'calloutStyles' | 'pageTemplates'>,
  styles: readonly CalloutStyleConfig[],
  chapters: readonly UsageChapter[],
  keep: string,
  merge: readonly string[],
): StyleRewritePlan {
  return planMerges(config, styles, chapters, [{ keep, merge }]);
}

/** What renaming style `from` to `to` changes in the book (the style
 *  keeps its place). */
export function planRename(
  config: Pick<PostextConfig, 'calloutStyles' | 'pageTemplates'>,
  styles: readonly CalloutStyleConfig[],
  chapters: readonly UsageChapter[],
  from: string,
  to: string,
): StyleRewritePlan {
  const renames = new Map([[from, to]]);
  const frames: FrameRewrite[] = [];
  const rewrites = chapterRewrites(chapters, renames);
  return {
    to,
    from: [from],
    // A style based on it (#905) names it by its new id.
    calloutStyles: styles.map((s) => {
      const next = s.id === from ? { ...s, id: to } : s;
      return next.extends === from ? { ...next, extends: to } : next;
    }),
    pageTemplates: retypeTemplates(config.pageTemplates, renames, frames),
    chapters: rewrites,
    frames,
    fenceCount: rewrites.reduce((n, c) => n + c.changes.length, 0),
    stays: [],
  };
}

/** The texts `plan` leaves, by chapter id (for tests and the agent tool). */
export function rewrittenTexts(chapters: readonly UsageChapter[], plan: StyleRewritePlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of plan.chapters) {
    const ch = chapters.find((c) => c.id === r.chapterId);
    if (ch && changesApply(ch.markdown, r.changes)) out.set(ch.id, applyTextChanges(ch.markdown, r.changes));
  }
  return out;
}
