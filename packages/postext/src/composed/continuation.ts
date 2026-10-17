/**
 * Continuation on other pages (#859, DESIGN §5.6): a frame whose content
 * the reflow ladder (#858) cannot make fit and whose
 * `overflow.continueIn` is `'next-page'` or `'template:<id>'` is cut at its
 * foot with its mark, and the rest goes on on a page added after the
 * composed page, built from a template:
 *
 * - `'next-page'`: the page's `overflowTemplate`, or, unset, the same
 *   template with only the frames that go on filled (the others take no
 *   room: their heights follow their empty content and they leave their
 *   groups);
 * - `'template:<id>'`: that template.
 *
 * On the added page the content goes on in the frame of the same name,
 * else the template's flow frame, else its first frame free. The frames of
 * one page that go on to the same template share one added page; a frame
 * whose content still does not fit there goes on again (with its own
 * `overflow.continueIn`, else the rule that brought it), up to
 * {@link MAX_CONTINUATION_PAGES} pages after the fence's own.
 *
 * Pure helpers: `build.ts` adds the pages, `composedLayout.ts` lays them.
 */
import type { CalloutCut } from '../pipeline/frameLayout';
import type { PlannedCallout } from '../pipeline/calloutLayout';
import { nextFrameOf } from './geometry';
import { continueInTemplate } from './templates';
import type { ResolvedFrame, ResolvedPageTemplate } from './types';

/** How many pages, one after another, the content of one composed page may
 *  go on to: the generation of added pages after which what still does not
 *  fit is cut (`frameContinuationLimit`). */
export const MAX_CONTINUATION_PAGES = 16;

/** A story of a composed page (`composedLayout.ts`'s `ComposedStory`). */
interface Story {
  startIdx: number;
  plan: PlannedCallout;
}

/** Content a frame sends on to another page. */
export interface ComposedContinuation {
  /** The frame that cut it, on the page it comes from, and that frame's
   *  id (`VDTFrame.id`). */
  frame: string;
  fromFrameId: string;
  /** Where it goes on: `'next-page'` or `'template:<id>'`. */
  rule: string;
  /** The template of the page it comes from (`'next-page'` reads its
   *  `overflowTemplate`). */
  template: string;
  /** Whether that page was itself an added page laid with the template's
   *  frames collapsed (a `'next-page'` with no `overflowTemplate`): the
   *  next one is laid alike. */
  collapsed: boolean;
  /** The story, where it stands, the pieces laid so far (its blocks go on
   *  as `<headBlockId>-cont-<n>`) and its head box's id. */
  story: Story;
  cut: CalloutCut;
  pieces: number;
  headBlockId: string;
  /** The frame of the fence's own page that first sent it on: the pieces
   *  on later pages are `cp<fence>:<slot>~<k>`. */
  slot: string;
}

/** What a page added by continuation receives. */
export interface ComposedContinuationInput {
  /** By the frame of this page that takes each one. */
  receivers: ReadonlyMap<string, ComposedContinuation>;
  /** `<k>` of `~<k>`: 1 on the pages the fence's own page adds, 2 on the
   *  pages those add, and so on. */
  generation: number;
  /** The template laid again for its continuations only (`'next-page'`
   *  with no `overflowTemplate`): frames that receive nothing take no
   *  room. */
  collapse: boolean;
  /** The last page continuation may add: what still does not fit stays
   *  here, cut at the frame's foot. */
  last: boolean;
}

/** `continueIn` sends content to another page. */
export function continuesOffPage(continueIn: string | undefined): boolean {
  return continueIn === 'next-page' || continueInTemplate(continueIn) !== undefined;
}

/** The page an added page is built from for `c`: its template id, and
 *  whether the template's frames that receive nothing collapse. */
export function continuationTarget(
  c: Pick<ComposedContinuation, 'rule' | 'template' | 'collapsed'>,
  overflowTemplateOf: (id: string) => string | undefined,
): { template: string; collapse: boolean } {
  const named = continueInTemplate(c.rule);
  if (named !== undefined) return { template: named, collapse: false };
  // 'next-page': the template's overflow template, or the template again.
  const over = overflowTemplateOf(c.template);
  if (over !== undefined && over !== c.template) return { template: over, collapse: false };
  return { template: c.template, collapse: over === undefined || c.collapsed };
}

/**
 * The frames of `template` that take `list`, in order: each goes on in
 * the frame of its name, else the flow frame, else the first frame no
 * other continuation took. Those that find no free frame are `left` for
 * another page.
 */
export function assignReceivers(
  template: Pick<ResolvedPageTemplate, 'frames'>,
  list: readonly ComposedContinuation[],
): { receivers: Map<string, ComposedContinuation>; left: ComposedContinuation[] } {
  const receivers = new Map<string, ComposedContinuation>();
  const left: ComposedContinuation[] = [];
  const names = new Set(template.frames.map((f) => f.name));
  const flow = template.frames.find((f) => f.flow)?.name;
  for (const c of list) {
    const take = [c.frame, flow, ...template.frames.map((f) => f.name)].find((n) => n !== undefined && names.has(n) && !receivers.has(n));
    if (take === undefined) left.push(c);
    else receivers.set(take, c);
  }
  return { receivers, left };
}

/**
 * The template an added page is laid with: the receivers (and the frames
 * their chains go on in on that page) continue as the rule that brought
 * the content, unless they send content off the page themselves; on the
 * last page allowed nothing goes on; with `collapse`, every other frame
 * takes no room and leaves its group.
 */
export function continuationTemplate(template: ResolvedPageTemplate, input: ComposedContinuationInput): ResolvedPageTemplate {
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  /** Frames the received content fills, with the rule it came by. */
  const filled = new Map<string, string>();
  for (const [name, c] of input.receivers) {
    const seen = new Set<string>();
    for (let n: string | undefined = name; n !== undefined && byName.has(n) && !seen.has(n); n = nextFrameOf(byName.get(n)!)) {
      seen.add(n);
      if (!filled.has(n)) filled.set(n, c.rule);
    }
  }
  const frames = template.frames.map((f): ResolvedFrame => {
    const rule = filled.get(f.name);
    if (rule !== undefined) {
      const own = f.overflow.continueIn;
      if (input.last && continuesOffPage(own)) {
        const overflow = { ...f.overflow };
        delete overflow.continueIn;
        return { ...f, overflow };
      }
      // The last frame of the chain goes on as the content came, unless
      // it says where itself.
      if (!input.last && nextFrameOf(f) === undefined && !continuesOffPage(own)) return { ...f, overflow: { ...f.overflow, continueIn: rule } };
      return f;
    }
    if (!input.collapse) return f;
    const out: ResolvedFrame = { ...f, height: 'auto', grow: 0 };
    delete out.minHeight;
    delete out.maxHeight;
    return out;
  });
  const groups = input.collapse ? template.groups.map((g) => ({ ...g, frames: g.frames.filter((n) => filled.has(n)) })) : template.groups;
  return { ...template, frames, groups };
}
