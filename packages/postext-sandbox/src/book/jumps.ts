// Stories that jump from one chapter into a page of a later one (#943),
// as the book layout hands them over. A chapter laid out returns the
// stories it sends on (`VDTDocument.pendingJumps`); the chapter that has
// the page is laid out with them (`LayoutContinuation.jumps`). The records
// keep them (`ChapterLayout.jumps`), so a chapter laid out on its own, or
// after a reload, still receives what the chapters before it sent.

import { hashStringWide, laterPageIdsOf, pageFenceIds, stableStringify } from 'postext';
import type { PostextConfig, PostextContent, StoryJump } from 'postext';
import type { ChapterPlan } from './types';

/** A chapter with a composed page fence. */
export const COMPOSED_PAGE_RE = /:::+page\b/;

const sendsToPages = new WeakMap<PostextConfig, boolean>();

/** Whether the configuration sends a story to a page by its id
 *  (`overflow.continueIn: 'page:<id>'`), the only way a story leaves its
 *  chapter. Cached per configuration object. */
export function configSendsToPages(config: PostextConfig): boolean {
  let uses = sendsToPages.get(config);
  if (uses === undefined) {
    uses = (stableStringify(config.pageTemplates ?? null)).includes('page:');
    sendsToPages.set(config, uses);
  }
  return uses;
}

/** A fingerprint of `value`. */
export function keyOf(value: unknown): string {
  return hashStringWide(stableStringify(value));
}

/** A fingerprint of `jumps`: what a chapter that receives them depends on. */
export function jumpsKeyOf(jumps: readonly StoryJump[] | undefined): string {
  return jumps && jumps.length > 0 ? keyOf(jumps) : '';
}

/** The page ids each chapter's later chapters have (`undefined` where it
 *  cannot send a story: no composed page, or nothing after it has an
 *  id). `idsOf` answers a chapter's own ids. */
export function laterIdsOfBook(
  chapters: readonly { markdown: string }[],
  config: PostextConfig,
  idsOf: (index: number) => readonly string[],
): (Record<string, number> | undefined)[] {
  if (!configSendsToPages(config)) return chapters.map(() => undefined);
  const later = laterPageIdsOf(chapters.map((_, i) => idsOf(i)));
  return later.map((ids, i) => (COMPOSED_PAGE_RE.test(chapters[i]!.markdown) && Object.keys(ids).length > 0 ? ids : undefined));
}

/** A cache of the page fence ids of chapters, by their text. */
export function createPageIdsCache(): (chapter: { id: string; markdown: string }, config: PostextConfig) => string[] {
  const cache = new Map<string, { markdown: string; config: PostextConfig; ids: string[] }>();
  return (chapter, config) => {
    const hit = cache.get(chapter.id);
    if (hit && hit.markdown === chapter.markdown && hit.config === config) return hit.ids;
    const ids = COMPOSED_PAGE_RE.test(chapter.markdown) ? pageFenceIds(chapter.markdown, config) : [];
    cache.set(chapter.id, { markdown: chapter.markdown, config, ids });
    return ids;
  };
}

/** Hand the stories chapter `from` sends to the chapters that have their
 *  pages (`into`, by chapter position), in the order they were sent. */
export function routeJumps(
  from: number,
  jumps: readonly StoryJump[] | undefined,
  later: Record<string, number> | undefined,
  into: Map<number, StoryJump[]>,
): void {
  if (!jumps || !later) return;
  for (const jump of jumps) {
    if (!Object.prototype.hasOwnProperty.call(later, jump.target)) continue;
    const to = later[jump.target]!;
    const list = into.get(to) ?? [];
    list.push({ ...jump, chapter: jump.chapter ?? from, fromChapter: from });
    into.set(to, list);
  }
}

/** What a plan hands the engine besides the text, the resources and the
 *  continuation: the book's outline, the chapter's citations and the page
 *  ids of the chapters after it. */
export function planContent(plan: Pick<ChapterPlan, 'outline' | 'citations' | 'laterPageIds'>): Pick<PostextContent, 'outline' | 'citations' | 'laterPageIds'> {
  return {
    outline: plan.outline,
    ...(plan.citations ? { citations: plan.citations } : {}),
    ...(plan.laterPageIds ? { laterPageIds: plan.laterPageIds } : {}),
  };
}
