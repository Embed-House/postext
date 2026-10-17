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

import type { CalloutStyleConfig, FrameConfig, PageTemplate, PageTemplatePatch, PostextConfig } from 'postext';
import { applyTextChanges, changesApply, type TextChange } from '../book/textChanges';
import { retypeCalloutChanges } from './calloutFences';
import type { UsageChapter } from './styleUsage';

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

/** What merging each group's `merge` into its `keep` changes in the book,
 *  every group in one rewrite. */
export function planMerges(
  config: Pick<PostextConfig, 'calloutStyles' | 'pageTemplates'>,
  styles: readonly CalloutStyleConfig[],
  chapters: readonly UsageChapter[],
  groups: readonly MergeGroup[],
): StyleRewritePlan {
  const renames = new Map<string, string>();
  for (const g of groups) for (const id of g.merge) if (id !== g.keep && !renames.has(id)) renames.set(id, g.keep);
  // A kept style is never itself merged away by another group.
  for (const g of groups) renames.delete(g.keep);
  const ids = styles.map((s) => s.id);
  const placeOf = new Map<number, CalloutStyleConfig>();
  for (const g of groups) {
    const kept = styles.find((s) => s.id === g.keep);
    if (!kept) continue;
    const at = ids.findIndex((id) => id === g.keep || renames.get(id) === g.keep);
    if (at >= 0) placeOf.set(at, kept);
  }
  const keptIds = new Set(groups.map((g) => g.keep));
  const calloutStyles: CalloutStyleConfig[] = [];
  styles.forEach((s, i) => {
    const kept = placeOf.get(i);
    if (kept) calloutStyles.push(kept);
    else if (!keptIds.has(s.id) && !renames.has(s.id)) calloutStyles.push(s);
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
    calloutStyles: styles.map((s) => (s.id === from ? { ...s, id: to } : s)),
    pageTemplates: retypeTemplates(config.pageTemplates, renames, frames),
    chapters: rewrites,
    frames,
    fenceCount: rewrites.reduce((n, c) => n + c.changes.length, 0),
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
