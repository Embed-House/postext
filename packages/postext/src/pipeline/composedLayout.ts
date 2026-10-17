/**
 * Lay out one composed page (#855, DESIGN §5.1–5.2): place the frames of
 * its template, pour each story (`composed/wrap.ts`) into its frames with
 * the box typesetter (`frameLayout.ts`), and hand back the blocks for the
 * page's floats with the page's `VDTComposedPage`.
 *
 * Per frame, in {@link frameOrder}: its box ({@link placeBox}, an `'auto'`
 * height measured with the content the frame will hold), then its content:
 * the story from where the frame before it in the chain stopped, cut at the
 * frame's foot when a `next` frame takes the rest, else laid whole and
 * clipped at the foot. Text runs round the frames that push it (`exclude:
 * 'push'`) already placed; groups negotiate their frames' space (#856).
 *
 * A frame whose content still does not fit climbs the reflow ladder (#858,
 * DESIGN §5.4), frame by frame in template order, each step on top of the
 * ones before it, stopping at the first that makes it fit: free space (a
 * fixed height grows to its `maxHeight`), its group pushing and yielding
 * (already part of every layout), smaller pictures in the frame and its
 * group (`fit.imageMinScale`), the group's other frames down to their
 * minimum or their content, smaller text (`fit.minScale`), continuation on
 * another page (#859). Each step lays the whole page again, so a change
 * stays on the page. What still does not fit is clipped and reported
 * (`frameOverflow`) with the steps tried and proposals worked out on the
 * page.
 *
 * A frame whose `overflow.continueIn` sends content to another page
 * (`'next-page'`, `'template:<id>'`, #859) takes the ladder's last step
 * before the warning: it is cut at its foot, with its mark, its text and
 * pictures back at full size, and the rest is handed back
 * (`ComposedPageLayout.continuations`) for `build.ts` to lay on pages it
 * adds after this one, with this function (`ComposedPageInput.continuing`).
 */
import type { ComposedPageFence, ContentBlock } from '../parse/types';
import type { Dimension, ResolvedCalloutStyleConfig } from '../types';
import { pageIsMirrored, type ContentWarning, type FrameFitStep, type FrameOverflowProposal, type ReflowEvent, type VDTBlock, type VDTComposedPage, type VDTExclusionContour, type VDTFrame, type VDTPage } from '../vdt';
import { contourBounds, scaleContourAbout, shiftContour } from '../contour';
import { frameContour } from '../composed/contour';
import { dimensionToPx } from '../units';
import { frameBounds } from '../composed/paint';
import { FRAME_ATTR } from '../composed/wrap';
import { framePlaceable, nextFrameOf, groupPlaceable, placeBox, unionRect, type FrameAreas, type Rect } from '../composed/geometry';
import { composedOrder, groupOfFrames, layoutGroup, type GroupItem } from '../composed/groups';
import { reflowEvents, type FrameMotion } from '../composed/reflowLog';
import { anchorTarget, resolveContinueIn } from '../composed/templates';
import { collapsedOnAddedPage, collapseFrames, continuationTemplate, continuesCollapsed, continuesOffPage, trailingFrames, type ComposedContinuation, type ComposedContinuationInput } from '../composed/continuation';
import type { ResolvedFrame, ResolvedFrameGroup, ResolvedPageTemplate } from '../composed/types';
import { resolvePageTemplate, type PageTemplateSource } from '../composed/templates';
import { frameElementId } from '../composed/ids';
import { offsetCalloutToAbsolute, type BoxExclusion, type CalloutLayoutResult, type PlannedCallout } from './calloutLayout';
import { isMarkerBlock } from './buildHelpers';
import { CUT_START, fragmentRange, frameCutRules, makeCalloutLayouter, splitCalloutFragment, type CalloutCut, type CalloutLayouter, type FrameBoxOptions, type FrameLayoutPass } from './frameLayout';

/** A story of the page: the box `composed/wrap.ts` made of a chain's
 *  content, by the name of the chain's first frame. */
export interface ComposedStory {
  startIdx: number;
  plan: PlannedCallout;
}

export interface ComposedPageInput {
  pass: FrameLayoutPass;
  page: VDTPage;
  template: ResolvedPageTemplate;
  fence: ComposedPageFence;
  /** Content index of the page's opening and closing markers. */
  startIdx: number;
  endIdx: number;
  /** The page's stories by head frame name. */
  stories: ReadonlyMap<string, ComposedStory>;
  /** The style a frame is drawn with: its `style`, or frameless. */
  styleOf(frame: ResolvedFrame): ResolvedCalloutStyleConfig;
  areas: FrameAreas;
  dpi: number;
  emPx: number;
  /** Source offset of the body in the chapter file. */
  bodyOffset: number;
  /** The page swaps its mirrored margins (an `'outer'` corner icon). */
  mirrored: boolean;
  /** The gap text keeps from a frame that pushes it. */
  pushGapPx: number;
  /** The box a frame takes given the one its placement gives: on a spread
   *  (#861, `composed/spread.ts`), off the spine band unless the frame
   *  crosses the gutter. An `'auto'` height is measured at the width it
   *  returns. */
  fitBox?: (frame: ResolvedFrame, rect: Rect) => Rect;
  /** The document's locale (`config.locale`), named by `frameOverflow`. */
  locale?: string;
  /** The book's other templates, resolved for this page's side, in
   *  `pageTemplates` order: a `useTemplate` proposal (#858) lays the page
   *  with each that has the overflowing frame's name. */
  alternatives?: () => readonly ResolvedPageTemplate[];
  /** A page added by continuation (#859): what its frames receive from
   *  the page before it. */
  continuing?: ComposedContinuationInput;
}

export interface ComposedPageLayout {
  composed: VDTComposedPage;
  /** Frame boxes and their content, in paint-independent page order (each
   *  frame's box first): for `page.floats` and `doc.blocks`. */
  blocks: VDTBlock[];
  warnings: ContentWarning[];
  /** Story heads laid in a frame of this page. A story left out (its frame
   *  is missing on this side) is set in the flow after the page. */
  laid: Set<string>;
  /** The frames `fitBox` moved or narrowed in the layout kept (a spread's
   *  gutter, #861): the box placed and the box it took. Only the
   *  composition the reflow ladder (#858) settles on counts, not the ones
   *  it tried. Not kept by the page memo (spreads are laid afresh). */
  fitted?: Map<string, { placed: Rect; kept: Rect }>;
  /** Content the page's frames send on to other pages (#859), in template
   *  order. */
  continuations?: ComposedContinuation[];
}

const MM_PER_IN = 25.4;

/** Where each story stands while its frames are filled. */
interface StoryState {
  story: ComposedStory;
  /** The story as the frame being filled sets it (its style). */
  L: CalloutLayouter;
  cut: CalloutCut;
  /** Pieces laid so far (the head is piece 0). */
  pieces: number;
  headBlockId: string;
  headFrameId: string;
  lastFrameId?: string;
}

/** What the reflow ladder (#858) changed from the template as written, for
 *  one composition of the page. */
interface FitState {
  /** Frames whose fields the ladder (or a proposal tried) replaces:
   *  `free` lets a fixed height grow to `maxHeight`. */
  patches: ReadonlyMap<string, Partial<ResolvedFrame>>;
  /** Text scale per story (by its head frame), below 1. */
  text: ReadonlyMap<string, number>;
  /** Picture scale per story (by its head frame), below 1, with the frame
   *  whose ladder set it. */
  pictures: ReadonlyMap<string, { scale: number; by: string }>;
  /** Groups whose frames give space back down to their minimum or their
   *  content, whether they `shrink` or not (`redistribute`). */
  yieldAll: ReadonlySet<string>;
  /** Frames cut at their foot whose rest goes on on another page (#859). */
  goOn: ReadonlySet<string>;
}

const NO_FIT: FitState = { patches: new Map(), text: new Map(), pictures: new Map(), yieldAll: new Set(), goOn: new Set() };

/** Where a frame that goes on to another page left its story (#859). */
interface Spill {
  head: string;
  cut: CalloutCut;
  /** The frame took some of the story. */
  advanced: boolean;
  pieces: number;
  headBlockId: string;
  frameId: string;
}

/** One laying out of the page's frames. */
interface Composition {
  frames: VDTFrame[];
  blocks: VDTBlock[];
  log: ReflowEvent[];
  laid: Set<string>;
  /** Each frame's content height at its final width (page px), for the
   *  frames that hold content, measured when asked. */
  needs: Map<string, () => number>;
  /** What `fitBox` did to each frame. */
  fitted: Map<string, { placed: Rect; kept: Rect }>;
  /** The template laid (with the ladder's patches). */
  template: ResolvedPageTemplate;
  /** `textWrap` notes of the contour pushes (#883, `noContour`). */
  notes?: ContentWarning[];
  /** Frames cut for another page, and where they left their story. */
  spills: Map<string, Spill>;
}

/** Step of the text and picture scales the ladder tries (DESIGN §5.4). */
const FIT_STEP = 0.025;
/** Lowest text scale an `allowShrink` proposal goes to. */
const PROPOSAL_MIN_SCALE = 0.5;
/** Most compositions of one page the ladder and its proposals may run. */
const COMPOSE_BUDGET = 96;

/** The scales from just under 1 (or under `from`) down to `min`, in
 *  {@link FIT_STEP} steps, `min` last. */
function scaleSteps(min: number, from = 1): number[] {
  const out: number[] = [];
  for (let k = 1; ; k++) {
    const s = Math.round((from - k * FIT_STEP) * 1e4) / 1e4;
    if (s <= min + 1e-6) break;
    out.push(s);
  }
  if (min < from - 1e-6) out.push(Math.round(min * 1e4) / 1e4);
  return out;
}

/** The template with the ladder's patches on its frames. */
function patchTemplate(template: ResolvedPageTemplate, patches: ReadonlyMap<string, Partial<ResolvedFrame>>): ResolvedPageTemplate {
  if (patches.size === 0) return template;
  return { ...template, frames: template.frames.map((f) => (patches.has(f.name) ? { ...f, ...patches.get(f.name)! } : f)) };
}

/** A fixed height (a length, not a percentage). */
const fixedHeight = (f: ResolvedFrame): Dimension | undefined => {
  const h = f.height as unknown;
  return h !== null && typeof h === 'object' && 'value' in (h as object) && 'unit' in (h as object) ? (f.height as Dimension) : undefined;
};

/** The frame before each frame of a chain on the page. On a page added by
 *  continuation (#859) a frame that receives content starts its chain. */
function chainPrev(template: ResolvedPageTemplate, receivers: ReadonlyMap<string, unknown> | undefined): Map<string, string> {
  const names = new Set(template.frames.map((f) => f.name));
  const prev = new Map<string, string>();
  for (const f of template.frames) {
    const n = nextFrameOf(f);
    if (n && names.has(n) && !prev.has(n) && !receivers?.has(n)) prev.set(n, f.name);
  }
  return prev;
}

const sameCut = (a: CalloutCut, b: CalloutCut): boolean =>
  a.child === b.child && a.line === b.line && JSON.stringify(a.group ?? null) === JSON.stringify(b.group ?? null);

export function layoutComposedPage(given: ComposedPageInput): ComposedPageLayout {
  // A page added by continuation (#859) lays its template with the
  // continuation's rules (and, for the template laid again, its other
  // frames collapsed).
  const input: ComposedPageInput = given.continuing ? { ...given, template: continuationTemplate(given.template, given.continuing) } : given;
  const { template, fence, dpi } = input;
  const fi = fence.fenceIndex;
  const mmPx = dpi / MM_PER_IN;
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const groupOf = groupOfFrames(template);
  const prev = chainPrev(template, input.continuing?.receivers);
  const headOf = (name: string): string => {
    let at = name;
    const seen = new Set([at]);
    for (let p = prev.get(at); p !== undefined && !seen.has(p); p = prev.get(at)) {
      seen.add(p);
      at = p;
    }
    return at;
  };

  // Compositions by fit state: the ladder and its proposals ask for some
  // twice.
  const memo = new Map<string, Composition>();
  let runs = 0;
  const keyOf = (tpl: ResolvedPageTemplate, fit: FitState): string =>
    JSON.stringify([tpl.id, [...fit.patches], [...fit.text], [...fit.pictures], [...fit.yieldAll], [...fit.goOn]]);
  /** Frames a page added by continuation lays with no room (#859). */
  const collapsedHere = input.continuing ? collapsedOnAddedPage(given.template, input.continuing) : new Set<string>();
  const holdsStory = (name: string): boolean => input.stories.has(headOf(name));
  /** The empty frames that go with the rest of a frame cut for a page
   *  laid from this template again (#912), by that frame. */
  const travelling = (tpl: ResolvedPageTemplate, fit: FitState): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const f of tpl.frames) {
      if (!fit.goOn.has(f.name) || !continuesCollapsed(tpl, f, input.continuing?.collapse ?? false)) continue;
      const t = trailingFrames(tpl, f.name, holdsStory);
      if (t.length > 0) out.set(f.name, t);
    }
    return out;
  };
  const compose = (fit: FitState, tpl: ResolvedPageTemplate = template): Composition => {
    const key = keyOf(tpl, fit);
    const known = memo.get(key);
    if (known) return known;
    runs++;
    const travel = travelling(tpl, fit);
    const lay = (leaving: ReadonlySet<string>, whole: ReadonlySet<string> = new Set()): Composition =>
      composePage(input, collapseFrames(patchTemplate(tpl, fit.patches), leaving, whole), fit, leaving.size > 0 ? new Set([...collapsedHere, ...leaving]) : collapsedHere);
    const all = new Map(travel);
    let c = lay(new Set([...travel.values()].flat()));
    // The empty frames go with the rest only when there is a rest: a frame
    // that holds all of it once they leave keeps them after it…
    const staying = [...travel.keys()].filter((f) => !c.spills.has(f));
    if (staying.length > 0) {
      for (const f of staying) travel.delete(f);
      c = lay(new Set([...travel.values()].flat()));
      // …unless they then do not fit under it at their size: the whole box
      // goes on with them, and takes no room here.
      const whole = staying.filter((f) => squeezes(c, f));
      if (whole.length > 0) {
        for (const f of whole) travel.set(f, all.get(f)!);
        c = lay(new Set([...whole, ...[...travel.values()].flat()]), new Set(whole));
      }
    }
    // A box none of whose content fits goes on whole and takes no room
    // here either.
    const empty = [...fit.goOn].filter((f) => { const sp = c.spills.get(f); return sp !== undefined && !sp.advanced && sp.pieces === 0 && !frameIn(c, f)?.collapsed; });
    if (empty.length > 0) {
      for (const f of empty) if (all.has(f)) travel.set(f, all.get(f)!);
      c = lay(new Set([...empty, ...[...travel.values()].flat()]), new Set(empty));
    }
    memo.set(key, c);
    return c;
  };
  const frameIn = (c: Composition, name: string): VDTFrame | undefined => c.frames.find((f) => f.name === name);
  const overflows = (c: Composition, name: string): boolean => (frameIn(c, name)?.overflowPx ?? 0) > 0.5;
  /** A frame that can go on to another page squeezes the frames after it
   *  in its stack below their declared size (#912): the stack reached the
   *  foot of its area and the last frames were cut to fit, an answer space
   *  under the box lost its lines. The ladder treats it as content that
   *  does not fit, so the box goes on and they keep their size. */
  const squeezes = (c: Composition, name: string): boolean => {
    const frame = byName.get(name);
    if (!frame || !continuesOffPage(frame.overflow.continueIn)) return false;
    const g = groupOf.get(name);
    if (!g || g.kind !== 'stack') return false;
    for (const other of g.frames.slice(g.frames.indexOf(name) + 1)) {
      const f = byName.get(other);
      const v = frameIn(c, other);
      if (!f || !v || v.collapsed) continue;
      const min = f.minHeight ? dimensionToPx(f.minHeight, dpi, input.emPx) : fixedHeight(f) ? dimensionToPx(fixedHeight(f)!, dpi, input.emPx) : 0;
      if (v.rect.height < min - 0.5) return true;
    }
    return false;
  };
  /** The frame's content does not fit, or it squeezes the frames after it. */
  const short = (c: Composition, name: string): boolean => overflows(c, name) || squeezes(c, name);
  /** The ladder's last step (#859): the frame is cut at its foot and the
   *  rest goes on on another page, its text and pictures back at full
   *  size (they go on anyway). */
  const goingOn = (f: FitState, frame: ResolvedFrame): FitState => {
    const text = new Map(f.text);
    text.delete(headOf(frame.name));
    const pictures = new Map([...f.pictures].filter(([, p]) => p.by !== frame.name));
    return { ...f, text, pictures, goOn: new Set([...f.goOn, frame.name]) };
  };

  // The ladder, frame by frame in template order (ties break there).
  let fit = NO_FIT;
  let cur = compose(fit);
  const tried = new Map<string, FrameFitStep[]>();
  const patched = (f: FitState, name: string, patch: Partial<ResolvedFrame>): FitState => ({ ...f, patches: new Map([...f.patches, [name, { ...f.patches.get(name), ...patch }]]) });
  const withText = (f: FitState, head: string, s: number): FitState => ({ ...f, text: new Map([...f.text, [head, s]]) });
  const withPictures = (f: FitState, heads: readonly string[], s: number, by: string): FitState => {
    const pictures = new Map(f.pictures);
    for (const h of heads) pictures.set(h, { scale: s, by });
    return { ...f, pictures };
  };
  /** Take `next` when it makes `name` fit; else keep it anyway (each step
   *  builds on the ones before it at their limit) and say so. */
  const attempt = (next: FitState, name: string): boolean => {
    fit = next;
    cur = compose(fit);
    return !short(cur, name);
  };
  /** The largest scale among `steps` (descending) at which `name` fits,
   *  checked at the lowest first, then by bisection; adopted. */
  const searchScale = (steps: readonly number[], make: (s: number) => FitState, name: string): boolean => {
    if (steps.length === 0) return false;
    if (!attempt(make(steps[steps.length - 1]!), name)) return false;
    let lo = 0;
    let hi = steps.length - 1; // fits at hi
    while (lo < hi && runs < COMPOSE_BUDGET) {
      const mid = Math.floor((lo + hi) / 2);
      if (!short(compose(make(steps[mid]!)), name)) hi = mid;
      else lo = mid + 1;
    }
    fit = make(steps[hi]!);
    cur = compose(fit);
    return true;
  };
  /** Story heads of the frame and of its group's frames whose content holds
   *  a picture. */
  const pictureHeads = (frame: ResolvedFrame): string[] => {
    const g = groupOf.get(frame.name);
    const names = g ? [frame.name, ...g.frames.filter((m) => m !== frame.name)] : [frame.name];
    const heads: string[] = [];
    for (const n of names) {
      const head = headOf(n);
      const story = input.stories.get(head);
      if (!story || heads.includes(head)) continue;
      for (let i = story.startIdx + 1; i < story.plan.endIdx; i++) {
        if (input.pass.contentBlocks[i]?.type === 'resourceBlock') {
          heads.push(head);
          break;
        }
      }
    }
    return heads;
  };
  /** The frame's story sets text (not only pictures): its text can
   *  shrink. */
  const holdsText = (frame: ResolvedFrame): boolean => {
    const story = input.stories.get(headOf(frame.name));
    if (!story) return false;
    for (let i = story.startIdx + 1; i < story.plan.endIdx; i++) {
      const b = input.pass.contentBlocks[i];
      if (b && b.type !== 'resourceBlock' && b.type !== 'directive' && !isMarkerBlock(b)) return true;
    }
    return false;
  };
  const movesOthers = (frame: ResolvedFrame): boolean => {
    const g = groupOf.get(frame.name);
    if (g && g.frames.filter((m) => byName.has(m)).length > 1) return true;
    return template.frames.some((f) => f.name !== frame.name && !f.grid && anchorTarget(f.placement) === frame.name);
  };
  /** `free` applies: a fixed height with room up to a higher `maxHeight`. */
  const growPatch = (frame: ResolvedFrame): Partial<ResolvedFrame> | undefined => {
    const h = fixedHeight(frame);
    if (!h || !frame.maxHeight) return undefined;
    if (dimensionToPx(frame.maxHeight, dpi, input.emPx) <= dimensionToPx(h, dpi, input.emPx) + 0.5) return undefined;
    const min = frame.minHeight && dimensionToPx(frame.minHeight, dpi, input.emPx) > dimensionToPx(h, dpi, input.emPx) ? frame.minHeight : h;
    return { height: 'auto', minHeight: min };
  };

  for (const frame of template.frames) {
    const name = frame.name;
    if (!short(cur, name) || runs >= COMPOSE_BUDGET) continue;
    const steps: FrameFitStep[] = [];
    tried.set(name, steps);
    // 1. Free space: a fixed height grows to its maximum ('auto' heights
    //    already take the room their area and group leave).
    steps.push('free');
    const grow = growPatch(frame);
    if (grow && attempt(patched(fit, name, grow), name)) continue;
    // 2. Push siblings: the group moved the frames after it and the frames
    //    that shrink gave space back when it was laid.
    if (movesOthers(frame)) steps.push('push');
    // 3. Pictures of the frame and its group, down to imageMinScale.
    const scaleImages = (): boolean => {
      const heads = frame.fit.scaleImages ? pictureHeads(frame) : [];
      if (heads.length === 0 || frame.fit.imageMinScale >= 1) return false;
      steps.push('scaleImages');
      return searchScale(scaleSteps(frame.fit.imageMinScale), (s) => withPictures(fit, heads, s, name), name);
    };
    // 4. Redistribute: every other frame of the group gives space (or
    //    width) back, down to its minimum or its content.
    const redistribute = (): boolean => {
      const g = groupOf.get(name);
      if (!g || g.frames.filter((m) => byName.has(m)).length <= 1) return false;
      steps.push('redistribute');
      return attempt({ ...fit, yieldAll: new Set([...fit.yieldAll, g.name]) }, name);
    };
    // 5. The frame's text (its whole story), down to fit.minScale.
    const shrinkText = (): boolean => {
      if (!frame.fit.shrinkText || frame.fit.minScale >= 1 || !holdsText(frame)) return false;
      steps.push('shrinkText');
      return searchScale(scaleSteps(frame.fit.minScale), (s) => withText(fit, headOf(name), s), name);
    };
    // 6. Continuation on another page (`overflow.continueIn: 'next-page'`,
    //    `'template:<id>'` or `'page:<id>'`, #859). On a page added by
    //    continuation, a frame that would take none of what it receives
    //    sends nothing on (it would go on for ever): it warns.
    const goOn = (): boolean => {
      if (!continuesOffPage(frame.overflow.continueIn)) return false;
      steps.push('continue');
      const before = { fit, cur };
      // (Only for a story that came from another page: a page's own story
      // may go on whole.)
      const received = input.continuing?.receivers.has(headOf(name)) ?? false;
      if (attempt(goingOn(fit, frame), name) && (!received || cur.spills.get(name)?.advanced !== false)) return true;
      ({ fit, cur } = before);
      return false;
    };
    // A frame whose content can go on to another page goes on before its
    // pictures and text shrink (`fit.preferContinue`, #920): a story keeps
    // one size from page to page. The pictures and the text shrink only
    // when it cannot go on (the last page continuation may add, or a
    // receiver that takes none of it).
    const order = continuesOffPage(frame.overflow.continueIn) && frame.fit.preferContinue
      ? [redistribute, goOn, scaleImages, shrinkText]
      : [scaleImages, redistribute, shrinkText, goOn];
    for (const step of order) if (step()) break;
  }

  // 7. Warn, with what would make each frame that still overflows fit.
  const warnings: ContentWarning[] = [...(cur.notes ?? [])];
  const templateAttr = fence.attrSources.template;
  for (const frame of template.frames) {
    const vdt = frameIn(cur, frame.name);
    if (!vdt || vdt.overflowPx <= 0.5) continue;
    const overflowMm = Math.round((vdt.overflowPx / mmPx) * 10) / 10;
    const proposals = overflowProposals({
      frame,
      vdt,
      cur,
      fit,
      compose,
      overflows,
      headOf,
      withText,
      patched,
      groupOf,
      byName,
      mmPx,
      dpi,
      emPx: input.emPx,
      alternatives: input.alternatives,
      templateSource: templateAttr ? { sourceStart: templateAttr.sourceStart + input.bodyOffset, sourceEnd: templateAttr.sourceEnd + input.bodyOffset } : undefined,
      budgetLeft: () => runs < COMPOSE_BUDGET,
      holdsText: holdsText(frame),
    });
    warnings.push({
      kind: 'frameOverflow',
      template: template.id,
      frame: frame.name,
      fenceIndex: fi,
      overflowMm,
      configPath: frame.configPath,
      ...(input.locale ? { locale: input.locale } : {}),
      stepsTried: tried.get(frame.name) ?? ['free'],
      scale: vdt.scale,
      ...(vdt.imageScale !== undefined ? { imageScale: vdt.imageScale } : {}),
      proposals,
      ...(vdt.sourceStart !== undefined ? { sourceStart: vdt.sourceStart, sourceEnd: vdt.sourceEnd } : {}),
      pageIndex: input.page.index,
    });
  }

  const { frames, blocks, log, laid, fitted } = cur;
  // Template order on the page record.
  const order = new Map(template.frames.map((f, i) => [f.name, i]));
  frames.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const contentBlocks = input.pass.contentBlocks;
  const composed: VDTComposedPage = {
    template: template.id,
    ...(template.variant ? { variant: template.variant } : {}),
    fenceIndex: fi,
    role: template.role,
    attrs: { ...fence.attrs },
    attrSources: Object.fromEntries(Object.entries(fence.attrSources).map(([k, v]) => [k, { sourceStart: v.sourceStart + input.bodyOffset, sourceEnd: v.sourceEnd + input.bodyOffset }])),
    frames,
    log,
    configPath: template.configPath,
    sourceStart: contentBlocks[input.startIdx]!.sourceStart + input.bodyOffset,
    sourceEnd: contentBlocks[input.endIdx]!.sourceEnd + input.bodyOffset,
  };
  // What goes on on other pages (#859), in template order.
  const continuations: ComposedContinuation[] = [];
  const trailing = new Map([...travelling(template, fit)].filter(([f, names]) => cur.spills.has(f) && names.every((n) => frameIn(cur, n)?.collapsed)));
  for (const frame of template.frames) {
    const spill = cur.spills.get(frame.name);
    const story = spill ? input.stories.get(spill.head) : undefined;
    if (!spill || !story) continue;
    const came = input.continuing?.receivers.get(spill.head);
    continuations.push({
      frame: frame.name,
      fromFrameId: spill.frameId,
      head: spill.head,
      // `{attr.x}` read from the fence (#917).
      rule: resolveContinueIn(frame.overflow.continueIn!, fence.attrs),
      template: template.id,
      collapsed: input.continuing?.collapse ?? false,
      story,
      cut: spill.cut,
      pieces: spill.pieces,
      headBlockId: spill.headBlockId,
      // A story that jumped here (#917) goes on named by this page's frame.
      slot: (input.continuing?.jump ? undefined : came?.slot) ?? frame.name,
      ...(trailing.has(frame.name) ? { trailing: trailing.get(frame.name)! } : {}),
      ...(frame.overflow.fromMark !== undefined ? { fromMark: frame.overflow.fromMark } : {}),
    });
  }
  return { composed, blocks, warnings, laid, ...(fitted.size > 0 ? { fitted } : {}), ...(continuations.length > 0 ? { continuations } : {}) };
}

interface ProposalContext {
  frame: ResolvedFrame;
  vdt: VDTFrame;
  cur: Composition;
  fit: FitState;
  compose(fit: FitState, tpl?: ResolvedPageTemplate): Composition;
  overflows(c: Composition, name: string): boolean;
  headOf(name: string): string;
  withText(f: FitState, head: string, s: number): FitState;
  patched(f: FitState, name: string, patch: Partial<ResolvedFrame>): FitState;
  groupOf: ReadonlyMap<string, ResolvedFrameGroup>;
  byName: ReadonlyMap<string, ResolvedFrame>;
  mmPx: number;
  dpi: number;
  emPx: number;
  alternatives?: () => readonly ResolvedPageTemplate[];
  templateSource?: { sourceStart: number; sourceEnd: number };
  budgetLeft(): boolean;
  /** The frame sets text, which a smaller scale would shrink. */
  holdsText: boolean;
}

const mmDim = (value: number): Dimension => ({ value, unit: 'mm' });

/** What would make `frame`'s content fit, each value worked out from the
 *  shortfall and, where the page can tell, tried on it (DESIGN §5.7). */
function overflowProposals(c: ProposalContext): FrameOverflowProposal[] {
  const { frame, vdt, cur, fit, mmPx } = c;
  const name = frame.name;
  const out: FrameOverflowProposal[] = [];
  const path = (key: string): string => frame.fieldPaths[key] ?? `${frame.configPath}/${key}`;
  const fits = (next: FitState, tpl?: ResolvedPageTemplate): boolean => c.budgetLeft() && !c.overflows(c.compose(next, tpl), name);

  // More shrink: the largest text scale, in 2.5 % steps, at which it fits.
  const head = c.headOf(name);
  const from = frame.fit.shrinkText ? Math.min(frame.fit.minScale, vdt.scale) : 1;
  const steps = scaleSteps(PROPOSAL_MIN_SCALE, from);
  if (c.holdsText && steps.length > 0 && fits(c.withText(fit, head, steps[steps.length - 1]!))) {
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi && c.budgetLeft()) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(c.withText(fit, head, steps[mid]!))) hi = mid;
      else lo = mid + 1;
    }
    out.push({
      kind: 'allowShrink',
      path: path('fit/minScale'),
      value: steps[hi]!,
      ...(frame.fit.shrinkText ? {} : { also: [{ path: path('fit/shrinkText'), value: true }] }),
    });
  }

  // A frame that holds content (an empty one is short of its own box, #911:
  // more height, text or pages do not help it).
  const holds = cur.needs.has(name);
  // A higher maximum: the frame's height plus the shortfall, in whole mm.
  const fixed = fixedHeight(frame);
  if (holds && (frame.maxHeight || fixed)) {
    const want = Math.ceil((vdt.rect.height + vdt.overflowPx) / mmPx - 1e-6);
    const patch: Partial<ResolvedFrame> = { maxHeight: mmDim(want), ...(fixed ? { height: 'auto' as const, minHeight: fixed } : {}) };
    if (fits(c.patched(fit, name, patch))) out.push({ kind: 'raiseMax', path: path('maxHeight'), value: mmDim(want) });
  }

  // A lower minimum on a frame of its group that stands at its minimum
  // with less content than that: lowered by the shortfall, not below its
  // content.
  const g = c.groupOf.get(name);
  if (g) {
    for (const other of g.frames) {
      const f = c.byName.get(other);
      // An empty frame's minimum is the room it stands for (an answer
      // space, a picture slot), not room to take (#911).
      if (!f || other === name || f.pin || !f.minHeight || !cur.needs.has(other)) continue;
      const box = cur.frames.find((x) => x.name === other);
      if (!box) continue;
      const minPx = dimensionToPx(f.minHeight, c.dpi, c.emPx);
      const need = cur.needs.get(other)?.() ?? 0;
      if (Math.abs(box.rect.height - minPx) > 0.5 || need >= minPx - mmPx) continue;
      const lowered = Math.max(Math.ceil(need / mmPx - 1e-6), Math.floor((minPx - vdt.overflowPx) / mmPx + 1e-6));
      if (lowered * mmPx >= minPx - 0.5) continue;
      if (fits(c.patched(fit, other, { minHeight: mmDim(lowered) }))) {
        out.push({ kind: 'lowerMin', path: f.fieldPaths.minHeight ?? `${f.configPath}/minHeight`, value: mmDim(lowered), frame: other });
      }
    }
  }

  // An empty frame cut short by its group: a lower minimum of its own, the
  // height it was left (#911).
  if (!holds && g && frame.minHeight) {
    const lowered = Math.floor(vdt.rect.height / mmPx + 1e-6);
    if (lowered * mmPx < dimensionToPx(frame.minHeight, c.dpi, c.emPx) - 0.5 && fits(c.patched(fit, name, { minHeight: mmDim(lowered) }))) {
      out.push({ kind: 'lowerMin', path: path('minHeight'), value: mmDim(lowered), frame: name });
    }
  }

  // Continue on the next page (#859 lays it out).
  if (holds && !frame.overflow.continueIn) out.push({ kind: 'continueNextPage', path: path('overflow/continueIn'), value: 'next-page' });

  // Another template of the book with a frame of this name, where the
  // content fits as it is.
  for (const alt of c.alternatives?.() ?? []) {
    if (!c.budgetLeft()) break;
    if (!alt.frames.some((f) => f.name === name)) continue;
    const trial = c.compose(NO_FIT, alt);
    const laidThere = trial.frames.find((f) => f.name === name);
    if (laidThere && laidThere.blockIds.length > 0 && laidThere.overflowPx <= 0.5) {
      out.push({ kind: 'useTemplate', value: alt.id, ...(c.templateSource ?? {}) });
      break;
    }
  }

  // Shorter text: the lines that do not fit, at the frame's characters a
  // line.
  const lines = cur.blocks.filter((b) => vdt.blockIds.includes(b.id) && b.type !== 'resource').flatMap((b) => b.lines.filter((l) => l.text.length > 0));
  if (lines.length > 0) {
    // Characters of a full line: the lines that do not end their paragraph.
    const full = lines.filter((l) => !l.isLastLine);
    const sample = full.length > 0 ? full : lines;
    const perLine = sample.reduce((n, l) => n + l.text.length, 0) / sample.length;
    const lineH = (lines.reduce((h, l) => h + l.bbox.height, 0) / lines.length) * vdt.scale;
    if (lineH > 0) {
      const over = Math.ceil(vdt.overflowPx / lineH - 1e-6);
      out.push({ kind: 'shortenText', value: Math.ceil(over * perLine), ...(vdt.sourceStart !== undefined ? { sourceStart: vdt.sourceStart, sourceEnd: vdt.sourceEnd! } : {}) });
    }
  }
  return out;
}

/** A frame style whose box keeps its drawn size when the frame's text is
 *  set at `scale` (#858): the frame is laid out `1 / scale` as large and
 *  painted at `scale`, so its padding, border, corner radius, stripe and
 *  tab are laid out `1 / scale` as large to come out as drawn. Only the
 *  text and what it holds shrink: padding that keeps room for the photos
 *  set over a box stays that room. */
export function keepChromeAt(style: ResolvedCalloutStyleConfig, scale: number): ResolvedCalloutStyleConfig {
  if (scale === 1) return style;
  const d = (v: Dimension): Dimension => ({ ...v, value: v.value / scale });
  const p = style.padding;
  return {
    ...style,
    padding: { top: d(p.top), right: d(p.right), bottom: d(p.bottom), left: d(p.left) },
    border: { ...style.border, width: d(style.border.width) },
    borderRadius: d(style.borderRadius),
    stripe: { ...style.stripe, width: d(style.stripe.width) },
    ...(style.label
      ? { label: { ...style.label, height: d(style.label.height), paddingX: d(style.label.paddingX), offset: d(style.label.offset), inset: d(style.label.inset), rule: { ...style.label.rule, width: d(style.label.rule.width) } } }
      : {}),
  };
}

/** Lay out every frame of the page once, with the reflow ladder's `fit`. */
function composePage(input: ComposedPageInput, template: ResolvedPageTemplate, fit: FitState, collapsed: ReadonlySet<string>): Composition {
  const { pass, fence, dpi } = input;
  const fi = fence.fenceIndex;
  const cont = input.continuing;
  const cutRules = frameCutRules(pass.resolved);
  /** A frame's id: `cp<fence>:<name>`; on a page added by continuation
   *  (#859) `~<k>`, a frame that receives content named by the frame of
   *  the fence's page that first sent it on. */
  const frameIdOf = (name: string): string => (cont && !cont.jump ? frameElementId(fi, cont.receivers.get(name)?.slot ?? name, cont.generation) : frameElementId(fi, name));
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const prev = chainPrev(template, cont?.receivers);
  /** The head of the chain a frame belongs to. */
  const headOf = (name: string): string => {
    let at = name;
    const seen = new Set([at]);
    for (let p = prev.get(at); p !== undefined && !seen.has(p); p = prev.get(at)) {
      seen.add(p);
      at = p;
    }
    return at;
  };
  /** The text scale of a frame's story (#858). */
  const textScale = (frame: ResolvedFrame): number => fit.text.get(headOf(frame.name)) ?? 1;
  /** A page number a mark's `{page}` is laid out with (#917): a guess of
   *  the right width, the build writing the true one once pages are
   *  numbered (`VDTDesignTextBlock.pageMark`). */
  const toGuess = String(input.page.index + 2);
  const fromGuess = String(Math.max(1, input.page.index));
  /** The style a frame is laid out in: its box as drawn at any text scale. */
  const styleOf = (frame: ResolvedFrame): ResolvedCalloutStyleConfig => {
    const style = keepChromeAt(input.styleOf(frame), textScale(frame));
    if (!fit.goOn.has(frame.name)) return style;
    // A frame cut for another page (#859) ends with its mark: its own
    // words, none (`false`), or its style's localized ones.
    const mark = frame.overflow.mark;
    return { ...style, continuesMarkerEnabled: mark !== false, continuesMarker: typeof mark === 'string' ? withPage(mark, toGuess) : style.continuesMarker };
  };
  /** The mark of a frame that receives a story from another page (#917):
   *  its own `overflow.fromMark`, else the sending frame's, set at the
   *  head of the first piece it lays here. */
  const fromMarkOf = (frame: ResolvedFrame): string | undefined => {
    const came = cont?.receivers.get(headOf(frame.name));
    const words = frame.overflow.fromMark ?? came?.fromMark;
    return came && words !== undefined ? withPage(words, fromGuess) : undefined;
  };
  /** The scale of a frame's pictures (#858), below 1, or undefined. */
  const pictureScale = (frame: ResolvedFrame): number | undefined => fit.pictures.get(headOf(frame.name))?.scale;
  /** Rectangles in a frame's box coordinates, in its laid-out (scaled)
   *  coordinates. */
  const unscale = (rs: FrameBoxOptions['exclusions'], s: number): FrameBoxOptions['exclusions'] =>
    rs && s !== 1
      ? rs.map((r) => ({ x: r.x / s, y: r.y / s, width: r.width / s, height: r.height / s, ...(r.contour ? { contour: scaleContourAbout(r.contour, 0, 0, 1 / s) } : {}) }))
      : rs;
  /** Place and fill every frame. `seed`: the boxes of the frames that push
   *  text, from a first run, so a frame placed before one that pushes it
   *  (the photo anchored to its box) still runs round it. */
  const run = (seed?: ReadonlyMap<string, Rect>, seedShapes?: ReadonlyMap<string, VDTExclusionContour>) => {
    const pushRects = new Map<string, Rect>();
    /** The shapes of the frames that push with their pictures' contour (#883). */
    const pushShapes = new Map<string, VDTExclusionContour>();
    /** Pictures of a contour push whose shape is not known (#883). */
    const notes: ContentWarning[] = [];
    const states = new Map<string, StoryState>();
    const stateOf = (frame: ResolvedFrame): StoryState | undefined => {
      const head = headOf(frame.name);
      const known = states.get(head);
      if (known) return known;
      const story = input.stories.get(head);
      const headFrame = byName.get(head);
      if (!story || !headFrame) return undefined;
      // Content from the page before (#859) goes on where it was cut, its
      // blocks numbered on from its pieces there.
      const came = cont?.receivers.get(head);
      const st: StoryState = {
        story,
        L: makeCalloutLayouter(pass, story.startIdx, story.plan, styleOf(frame)),
        cut: came?.cut ?? CUT_START,
        pieces: came?.pieces ?? 0,
        headBlockId: came?.headBlockId ?? frameIdOf(head),
        headFrameId: came?.fromFrameId ?? frameIdOf(head),
      };
      states.set(head, st);
      return st;
    };
    const atEnd = (st: StoryState): boolean => st.cut.child >= st.L.end.child && st.cut.line === 0 && !st.cut.group;

    /** The frames' boxes as laid, and as the template declares them. */
    const rects = new Map<string, Rect>();
    const declared = new Map<string, Rect>();
    /** Groups' boxes once their step is laid. */
    const groupRects = new Map<string, Rect>();
    const groupDeclared = new Map<string, Rect>();
    const groupRect = (name: string, boxes: ReadonlyMap<string, Rect>, solved: ReadonlyMap<string, Rect>, refs: (n: string) => Rect | undefined): Rect | undefined => {
      const done = solved.get(name);
      if (done) return done;
      const g = template.groups.find((gr) => gr.name === name);
      if (!g) return undefined;
      const own = groupPlaceable(g);
      if (own) return placeBox(own, template, input, refs, () => 0);
      return unionRect(g.frames.flatMap((m) => (boxes.has(m) ? [boxes.get(m)!] : [])));
    };
    const refOf = (name: string): Rect | undefined => rects.get(name) ?? groupRect(name, rects, groupRects, refOf);
    const declaredRefOf = (name: string): Rect | undefined => declared.get(name) ?? groupRect(name, declared, groupDeclared, declaredRefOf);
    /** Pinned frames laid so far: a group's frames flow round them. */
    const pinned: { name: string; rect: Rect }[] = [];
    /** How far a stack cut each frame below its least height (#911). */
    const boxShort = new Map<string, number>();

    const frames: VDTFrame[] = [];
    const vdtByName = new Map<string, VDTFrame>();
    const blocks: VDTBlock[] = [];
    const overflowLog: ReflowEvent[] = [];
    const fitLog: ReflowEvent[] = [];
    const needs = new Map<string, () => number>();
    /** What `fitBox` did to each frame (#861), last placement wins. */
    const fitted = new Map<string, { placed: Rect; kept: Rect }>();
    const laid = new Set<string>();
    const spills = new Map<string, Spill>();
    const pushed: { name: string; box: Rect; contour?: VDTExclusionContour }[] = seed
      ? [...seed].map(([name, box]) => ({ name, box, ...(seedShapes?.get(name) ? { contour: seedShapes.get(name)! } : {}) }))
      : [];

    /** The rectangles of the pushing frames placed so far that `rect`
     *  meets, in the frame block's coordinates. */
    const exclusionsFor = (frame: ResolvedFrame, rect: Rect, open: boolean): FrameBoxOptions['exclusions'] => {
      const out: BoxExclusion[] = [];
      const g = input.pushGapPx;
      for (const p of pushed) {
        if (p.name === frame.name) continue;
        // A contour (#883) pushes with its shape, its margin round it.
        const cb = p.contour ? contourBounds(p.contour) : undefined;
        const b = cb ?? p.box;
        const e = cb ? 0 : g;
        const below = open ? true : b.y < rect.y + rect.height;
        if (b.x - e >= rect.x + rect.width || b.x + b.width + e <= rect.x || !below || b.y + b.height + e <= rect.y) continue;
        out.push({
          x: b.x - e - rect.x, y: b.y - e - rect.y, width: b.width + 2 * e, height: b.height + 2 * e,
          ...(cb && p.contour ? { contour: shiftContour(p.contour, -rect.x, -rect.y) } : {}),
        });
      }
      return out.length > 0 ? out : undefined;
    };

    /** Where a frame's story stands when the frame is reached. */
    interface Prep {
      frame: ResolvedFrame;
      st: StoryState | undefined;
      before: string | undefined;
      holds: boolean;
      continuation: boolean;
      blockId: string;
      /** "Continued from page …" at its head (#917). */
      fromMark?: string;
    }
    const prepare = (frame: ResolvedFrame): Prep => {
      const st = stateOf(frame);
      // Each frame of a chain sets the story in its own style: the cuts are
      // positions in the story's blocks, the same in any.
      if (st) st.L = makeCalloutLayouter(pass, st.story.startIdx, st.story.plan, styleOf(frame));
      // A frame continues its story only once the frame before it in the
      // chain was filled (a frame placed before it, through an anchor, starts
      // empty).
      const before = prev.get(frame.name);
      const reached = st !== undefined && (before === undefined || vdtByName.has(before));
      const holds = reached && !atEnd(st!);
      const continuation = st !== undefined && st.pieces > 0;
      const blockId = st && st.pieces > 0 ? `${st.headBlockId}-cont-${st.pieces}` : frameIdOf(frame.name);
      // The first piece here of a story that came from another page.
      const came = cont?.receivers.get(headOf(frame.name));
      const fromMark = st && came && continuation && st.pieces === came.pieces ? fromMarkOf(frame) : undefined;
      return { frame, st, before, holds, continuation, blockId, ...(fromMark !== undefined ? { fromMark } : {}) };
    };
    /** The content's height at `width`, running round the pushing frames
     *  below the top of `at` (the frame's box as first placed). A frame
     *  whose text the ladder scales (#858) is laid out `1 / scale` as
     *  wide and is `scale` as tall as that. */
    const naturalOf = (p: Prep, at?: Rect) => {
      const memo = new Map<number, number>();
      const s = textScale(p.frame);
      const pic = pictureScale(p.frame);
      return (width: number): number => {
        if (!p.holds) return 0;
        const key = Math.round(width * 1000);
        const known = memo.get(key);
        if (known !== undefined) return known;
        const exclusions = at ? unscale(exclusionsFor(p.frame, { ...at, width }, true), s) : undefined;
        const opts: FrameBoxOptions = { ...(exclusions ? { exclusions } : {}), ...(pic !== undefined ? { pictureScale: pic } : {}), ...(p.fromMark !== undefined ? { continuedMark: p.fromMark } : {}) };
        const r = p.st!.L.layoutRange(p.st!.cut, p.st!.L.end, width / s, p.blockId, p.continuation, input.mirrored, opts.exclusions || opts.pictureScale !== undefined || opts.continuedMark !== undefined ? opts : undefined);
        const h = r.totalHeight * s;
        memo.set(key, h);
        return h;
      };
    };
    /** `placeBox`, then the box the page lets the frame take (`fitBox`:
     *  off a spread's spine band, #861), its `'auto'` height measured at the
     *  width it is left with. Declared and final boxes alike: the band is
     *  the template's, not a reflow. */
    const placeFitted = (frame: ResolvedFrame, placeable: ReturnType<typeof framePlaceable>, ctx: Parameters<typeof placeBox>[2], refs: (n: string) => Rect | undefined, nat: (width: number) => number): Rect => {
      const r = placeBox(placeable, template, ctx, refs, nat);
      if (!input.fitBox) return r;
      const keep = (placed: Rect): Rect => {
        const kept = input.fitBox!(frame, placed);
        if (sameRect(kept, placed)) fitted.delete(frame.name);
        else fitted.set(frame.name, { placed, kept });
        return kept;
      };
      const first = keep(r);
      if (Math.abs(first.width - r.width) < 0.01) return first;
      return keep(placeBox(placeable, template, ctx, refs, () => nat(first.width)));
    };
    /** A frame's height as its template declares it: its `minHeight` where
     *  the height follows the content, else the content's (`natural`). */
    const declaredNatural = (frame: ResolvedFrame, natural: (w: number) => number) => (width: number): number => (frame.minHeight ? 0 : natural(width));

    /** Place a frame outside any group: its box, placed with the content's
     *  own height, then again with the height it takes running round the
     *  frames that push it there; a pinned frame where the template puts
     *  it. */
    const placeFrame = (p: Prep): Rect => {
      const frame = p.frame;
      const placeable = framePlaceable(frame);
      const natural = naturalOf(p);
      const at = (refs: (n: string) => Rect | undefined) => {
        const r0 = placeFitted(frame, placeable, input, refs, natural);
        if (!p.holds || !exclusionsFor(frame, r0, true)) return { rect: r0, natural };
        const round = naturalOf(p, r0);
        return { rect: placeFitted(frame, placeable, input, refs, round), natural: round };
      };
      const decl = frame.pin ? at(declaredRefOf) : undefined;
      const fin = decl ?? at(refOf);
      const declRect = placeFitted(frame, placeable, input, declaredRefOf, declaredNatural(frame, fin.natural));
      const rect = frame.pin ? declRect : fin.rect;
      declared.set(frame.name, declRect);
      rects.set(frame.name, rect);
      if (frame.pin) pinned.push({ name: frame.name, rect });
      return rect;
    };

    /** Lay a group: its frames' boxes as the template declares them and as
     *  their content needs (`composed/groups.ts`). With the ladder's
     *  `redistribute` (#858) every frame gives space back, down to its
     *  minimum or its content, whether it `shrink`s or not. */
    const placeGroup = (group: ResolvedFrameGroup, members: readonly ResolvedFrame[]): Map<string, Rect> => {
      const own = groupPlaceable(group);
      const mmPx = dpi / MM_PER_IN;
      const yieldAll = fit.yieldAll.has(group.name);
      const preps = members.map(prepare);
      const solve = (mode: 'final' | 'declared', naturals: ((w: number) => number)[]): { rects: Map<string, Rect>; box: Rect; items: GroupItem[] } => {
        const refs = mode === 'final' ? refOf : declaredRefOf;
        const ownBox = own ? placeBox(own, template, input, refs, () => 0) : undefined;
        const ownRects = new Map<string, Rect>();
        const memberRefs = (n: string): Rect | undefined => ownRects.get(n) ?? (n === group.name ? ownBox : refs(n));
        const items: GroupItem[] = members.map((f, k) => {
          // A frame placed nowhere stands in its group's box.
          const ctx = ownBox && !f.placement && !f.grid ? { ...input, areas: { ...input.areas, area: ownBox } } : input;
          const natural = naturals[k]!;
          const placeable = framePlaceable(f);
          // On a spread the member's own box keeps off the spine band, and
          // the negotiation starts from it (#861).
          const box = placeFitted(f, placeable, ctx, memberRefs, declaredNatural(f, natural));
          ownRects.set(f.name, box);
          const auto = f.height === 'auto' && !(f.grid && !placeable.heightSet);
          const fill = f.height === 'fill';
          const minH = f.minHeight ? dimensionToPx(f.minHeight, dpi, input.emPx) : 0;
          const want = fill ? minH : auto ? (mode === 'final' ? natural(box.width) : declaredNatural(f, natural)(box.width)) : box.height;
          const max = f.maxHeight ? dimensionToPx(f.maxHeight, dpi, input.emPx) : Infinity;
          const item: GroupItem = {
            name: f.name,
            own: box,
            want,
            min: minH,
            max,
            minWidth: f.minWidth ? dimensionToPx(f.minWidth, dpi, input.emPx) : 0,
            maxWidth: f.maxWidth ? dimensionToPx(f.maxWidth, dpi, input.emPx) : Infinity,
            grow: fill ? Math.max(1, f.grow) : f.grow,
            shrink: f.shrink,
            priority: f.priority,
            pin: f.pin,
            fixedHeight: !auto && !fill,
            need: natural,
            floor: minH,
          };
          if (yieldAll && mode === 'final' && !f.pin) {
            // Down to its minimum, never under what its content needs, never
            // over the height it has.
            const height = Math.min(Math.max(want, minH), max);
            item.shrink = f.shrink > 0 ? f.shrink : 1;
            // (A row's frames give width, each down to the narrowest width
            // its content still fits: their heights stay the row's.)
            if (group.kind === 'stack') item.min = Math.min(height, Math.max(minH, natural(box.width)));
          }
          if (fit.goOn.has(f.name) && mode === 'final' && !f.pin) {
            // A frame cut for another page (#859) gives the room first,
            // down to its minimum: the frames after it in the group keep
            // their size (#912), and its rest goes on.
            item.shrink = Math.max(f.shrink, 1);
            item.priority = Number.NEGATIVE_INFINITY;
            item.min = minH;
          }
          return item;
        });
        const firstFree = items.find((it) => !it.pin) ?? items[0];
        const start = firstFree?.own ?? input.areas.area;
        const box = ownBox ?? { x: start.x, y: start.y, width: 0, height: 0 };
        const out = layoutGroup({
          kind: group.kind,
          box,
          elastic: !ownBox,
          limit: input.areas.area,
          gap: dimensionToPx(group.gap, dpi, input.emPx),
          align: group.align,
          items,
          obstacles: pinned.filter((q) => !members.some((m) => m.name === q.name)).map((q) => q.rect),
          mmPx,
          negotiate: mode === 'final',
        });
        // A pinned frame of the group stands where the template puts it.
        for (const it of items) if (it.pin) out.set(it.name, it.own);
        return { rects: out, box: ownBox ?? unionRect([...out.values()]) ?? box, items };
      };
      let naturals = preps.map((p) => naturalOf(p));
      let fin = solve('final', naturals);
      // Text that runs round a pushing frame is taller: measured at the box
      // first found, then laid again.
      const round = preps.map((p) => (p.holds && exclusionsFor(p.frame, fin.rects.get(p.frame.name)!, true) ? naturalOf(p, fin.rects.get(p.frame.name)!) : undefined));
      if (round.some((r) => r !== undefined)) {
        naturals = naturals.map((n, k) => round[k] ?? n);
        fin = solve('final', naturals);
      }
      const decl = solve('declared', naturals);
      // A frame the stack cut below the least it may have (its
      // `minHeight`, a fixed height its own) is short of its box, content
      // or none (#911): an empty answer space or picture slot overflows
      // too.
      for (const it of fin.items) {
        if (it.pin || group.kind !== 'stack') continue;
        const least = it.fixedHeight && (it.floor ?? 0) <= 0.5 ? it.own.height : it.floor ?? 0;
        const got = fin.rects.get(it.name)!.height;
        if (least - got > 0.5) boxShort.set(it.name, least - got);
        else boxShort.delete(it.name);
      }
      for (const m of members) {
        rects.set(m.name, fin.rects.get(m.name)!);
        declared.set(m.name, decl.rects.get(m.name)!);
        if (m.pin) pinned.push({ name: m.name, rect: fin.rects.get(m.name)! });
      }
      groupRects.set(group.name, fin.box);
      groupDeclared.set(group.name, decl.box);
      return fin.rects;
    };

    /** Pour a frame's content into its box and record the frame. A frame
     *  whose text the ladder scales (#858) is laid out in a box `1 / scale`
     *  as large, painted at `scale` (`frameMatrix`). */
    const fill = (p: Prep, rect: Rect): void => {
      const { frame, st, holds, continuation, blockId, before } = p;
      const style = styleOf(frame);
      const s = textScale(frame);
      const pic = pictureScale(frame);
      const laidW = rect.width / s;
      const laidH = rect.height / s;
      let result: CalloutLayoutResult | undefined;
      let overflowPx = 0;
      let goesOn = false;
      const from = st?.cut ?? CUT_START;
      if (holds) {
        // What its content needs at its width, measured only when a
        // proposal asks (`lowerMin`), from where the frame starts.
        const width = rect.width;
        const startAt: Prep = { ...p, st: { ...st!, cut: from } };
        let known: number | undefined;
        needs.set(frame.name, () => (known ??= naturalOf(startAt)(width)));
        const exclusions = unscale(exclusionsFor(frame, rect, false), s);
        const extra: FrameBoxOptions = { ...(exclusions ? { exclusions } : {}), ...(pic !== undefined ? { pictureScale: pic } : {}), ...(p.fromMark !== undefined ? { continuedMark: p.fromMark } : {}) };
        const opts: FrameBoxOptions = { boxHeight: laidH, verticalAlign: frame.verticalAlign, ...extra };
        const whole = st!.L.layoutRange(from, st!.L.end, laidW, blockId, continuation, input.mirrored, opts);
        const nextName = nextFrameOf(frame);
        const nextFrame = nextName !== undefined ? byName.get(nextName) : undefined;
        const chained = nextFrame !== undefined && !vdtByName.has(nextFrame.name);
        // Cut for another page (#859) when the chain ends here.
        goesOn = !chained && fit.goOn.has(frame.name);
        if ((whole.overflowPx ?? 0) > 0.5 && (chained || goesOn)) {
          // The rest goes on in the next frame of the chain, or on another
          // page.
          const minLines = Math.max(1, style.splitMinLines);
          // A heading stays with what follows it, a list keeps two items
          // on each side of the cut (#913).
          const frag = splitCalloutFragment(pass, st!.L, from, laidW, laidH, blockId, continuation, minLines, input.mirrored, extra.exclusions || extra.pictureScale !== undefined || extra.continuedMark !== undefined ? extra : undefined, cutRules);
          const to = frag?.to ?? from;
          // A frame none of whose content fits draws nothing: the whole box
          // goes on (#912), not a tab and a mark over an empty piece.
          result = frag ? st!.L.layoutRange(from, to, laidW, blockId, continuation, input.mirrored, opts) : undefined;
          st!.cut = to;
        } else {
          goesOn = false;
          result = whole;
          overflowPx = (whole.overflowPx ?? 0) * s;
          st!.cut = st!.L.end;
        }
      } else if (st && frame.style) {
        // A styled frame with nothing (left) to hold still draws its box.
        result = st.L.layoutRange(st.L.end, st.L.end, laidW, blockId, true, input.mirrored, { boxHeight: laidH });
      }
      // A frame cut below its least height overflows by the cut, holding
      // content or not (#911).
      overflowPx = Math.max(overflowPx, boxShort.get(frame.name) ?? 0);
      const vdt: VDTFrame = {
        id: frameIdOf(frame.name),
        name: frame.name,
        rect: { ...rect },
        rotate: frame.rotate,
        layer: frame.layer,
        ...(frame.style ? { styleId: frame.style } : {}),
        scale: s,
        ...(pic !== undefined && holds ? { imageScale: pic } : {}),
        overflowPx,
        blockIds: [],
        configPath: frame.configPath,
        ...(frame.exclude === 'push' ? { push: true as const } : {}),
        ...(collapsed.has(frame.name) ? { collapsed: true as const } : {}),
      };
      const decl = declared.get(frame.name);
      if (decl && !sameRect(decl, rect)) vdt.declaredRect = { ...decl };
      if (before && vdtByName.has(before) && st && st.lastFrameId) {
        vdt.continuedFrom = st.lastFrameId;
        const q = frames.find((f) => f.id === st.lastFrameId);
        if (q) q.continuesTo = vdt.id;
      } else if (holds && cont?.receivers.has(frame.name)) {
        // Content from the page before (#859).
        vdt.continuedFrom = cont.receivers.get(frame.name)!.fromFrameId;
      }
      if (result) {
        // The marks whose `{page}` the build fills in (#917).
        if (goesOn && typeof frame.overflow.mark === 'string' && frame.overflow.mark.includes('{page}')) tagPageMark(result.frame, withPage(frame.overflow.mark, toGuess), frame.overflow.mark, 'to');
        const fromWords = frame.overflow.fromMark ?? cont?.receivers.get(headOf(frame.name))?.fromMark;
        if (p.fromMark !== undefined && fromWords?.includes('{page}')) tagPageMark(result.frame, p.fromMark, fromWords, 'from');
      }
      if (result && st) {
        const range = fragmentRange(st.L, from, st.cut);
        commitFrame(result, rect, st.story, range, input, vdt, blocks);
        st.pieces++;
        st.lastFrameId = vdt.id;
        laid.add(headOf(frame.name));
        // What the ladder changed in the frame's content (#858).
        const pictures = fit.pictures.get(headOf(frame.name));
        if (pictures && result.children.some((b) => b.type === 'resource')) {
          fitLog.push({ frame: frame.name, kind: 'imageScaled', scale: pictures.scale, ...(pictures.by !== frame.name ? { cause: pictures.by } : {}) });
        }
        if (s !== 1 && holds) fitLog.push({ frame: frame.name, kind: 'textScaled', scale: s });
      }
      if (goesOn && st) {
        // Laid here even when none of it fits: the rest goes on (#912).
        laid.add(headOf(frame.name));
        spills.set(frame.name, { head: headOf(frame.name), cut: st.cut, advanced: !sameCut(from, st.cut), pieces: st.pieces, headBlockId: st.headBlockId, frameId: vdt.id });
      }
      if (overflowPx > 0.5) {
        const overflowMm = Math.round((overflowPx / dpi) * MM_PER_IN * 10) / 10;
        overflowLog.push({ frame: frame.name, kind: 'overflow', toMm: overflowMm });
      }
      if (frame.exclude === 'push') {
        const box = frameBounds({ rect, rotate: frame.rotate });
        pushRects.set(frame.name, box);
        // `wrap: 'contour'` (#883): the shape of the pictures it holds; a
        // turned frame pushes with its box.
        const shape = frame.wrap === 'contour' && frame.rotate === 0 && result
          ? frameContour(result.children, { gapPx: input.pushGapPx, dpi, emPx: input.emPx, mirrored: pageIsMirrored(input.page), pageIndex: input.page.index })
          : undefined;
        if (shape) notes.push(...shape.notes);
        // A frame whose text the ladder scaled (#858) holds its pictures in
        // its laid-out coordinates: on the page they are `s` as large, from
        // its box's corner (`frameMatrix`).
        const contour = shape?.contour && s !== 1 ? scaleContourAbout(shape.contour, rect.x, rect.y, s, false) : shape?.contour;
        if (contour) pushShapes.set(frame.name, contour);
        if (!seed) pushed.push({ name: frame.name, box, ...(contour ? { contour } : {}) });
      }
      frames.push(vdt);
      vdtByName.set(frame.name, vdt);
    };

    for (const step of composedOrder(template)) {
      if (step.kind === 'frame') {
        const p = prepare(step.frame);
        fill(p, placeFrame(p));
        continue;
      }
      const solved = placeGroup(step.group, step.frames);
      // A frame of a chain inside the group is reached once the frame
      // before it was filled: each is prepared again as it is filled.
      for (const f of step.frames) fill(prepare(f), solved.get(f.name)!);
    }
    const log = mergeLog(reflowEvents(motionsOf(template, rects, declared), dpi / MM_PER_IN), [...fitLog, ...overflowLog], template);
    return { frames, blocks, log, laid, needs, pushRects, pushShapes, fitted, notes, spills };
  };
  const first = run();
  const { frames, blocks, log, laid, needs, fitted, notes, spills } = first.pushRects.size > 0 ? run(first.pushRects, first.pushShapes) : first;
  return { frames, blocks, log, laid, needs, template, fitted, spills, ...(notes.length > 0 ? { notes } : {}) };
}

const sameRect = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;

/** Each laid frame's declared and final boxes, in template order, with
 *  what moves it: what it anchors to (a group: its frames, last first),
 *  then, in a group, the frames before it (nearest first), what the group
 *  anchors to, and the frames after it. */
function motionsOf(template: ResolvedPageTemplate, rects: ReadonlyMap<string, Rect>, declared: ReadonlyMap<string, Rect>): FrameMotion[] {
  const groupOf = groupOfFrames(template);
  const groups = new Map(template.groups.map((g) => [g.name, g]));
  const expand = (target: string | undefined): string[] => {
    if (!target) return [];
    const g = groups.get(target);
    return g && !rects.has(target) ? [...g.frames].reverse() : [target];
  };
  const out: FrameMotion[] = [];
  for (const f of template.frames) {
    const fin = rects.get(f.name);
    const decl = declared.get(f.name);
    if (!fin || !decl) continue;
    const deps = f.grid ? [] : expand(anchorTarget(f.placement));
    const g = groupOf.get(f.name);
    if (g) {
      const k = g.frames.indexOf(f.name);
      deps.push(...g.frames.slice(0, k).reverse());
      if (!g.grid) deps.push(...expand(anchorTarget(g.placement)));
      deps.push(...g.frames.slice(k + 1));
    }
    out.push({ name: f.name, declared: decl, final: fin, deps });
  }
  return out;
}

/** The page's log: each frame's events in template order, what groups and
 *  anchors changed first, then its overflow. */
function mergeLog(reflow: readonly ReflowEvent[], overflow: readonly ReflowEvent[], template: ResolvedPageTemplate): ReflowEvent[] {
  const order = new Map(template.frames.map((f, i) => [f.name, i]));
  const all = [...reflow.map((e, i) => ({ e, i })), ...overflow.map((e, i) => ({ e, i: reflow.length + i }))];
  all.sort((a, b) => (order.get(a.e.frame) ?? 0) - (order.get(b.e.frame) ?? 0) || a.i - b.i);
  return all.map((x) => x.e);
}

/** Stamp a frame's laid-out box with its source and page, move it to the
 *  frame's place and add it (box first) to `out` and to the frame's ids. */
function commitFrame(
  result: CalloutLayoutResult,
  rect: Rect,
  story: ComposedStory,
  range: { firstChildIdx: number; lastChildIdx: number },
  input: ComposedPageInput,
  vdt: VDTFrame,
  out: VDTBlock[],
): void {
  const { pass, page, bodyOffset } = input;
  const blocks = pass.contentBlocks;
  const box = result.frame;
  box.contentIndex = story.startIdx;
  const first = blocks[Math.max(story.startIdx + 1, Math.min(range.firstChildIdx, story.plan.endIdx - 1))];
  const last = blocks[Math.max(story.startIdx + 1, Math.min(range.lastChildIdx, story.plan.endIdx - 1))];
  if (first && last && range.lastChildIdx >= range.firstChildIdx) {
    box.sourceStart = first.sourceStart + bodyOffset;
    box.sourceEnd = last.sourceEnd + bodyOffset;
    vdt.sourceStart = box.sourceStart;
    vdt.sourceEnd = box.sourceEnd;
  }
  box.pageIndex = page.index;
  box.columnIndex = 0;
  stampFrameAttrText(box, blocks[story.startIdx]?.containerAttrSources, story.plan.attrs, bodyOffset);
  offsetCalloutToAbsolute(result, rect.x, rect.y);
  out.push(box);
  vdt.blockIds.push(box.id);
  for (const child of result.children) {
    child.pageIndex = page.index;
    child.columnIndex = 0;
    out.push(child);
    vdt.blockIds.push(child.id);
  }
}

/** The frame's tab (`label`) and title (`title`) as the box draws them,
 *  stamped with where the `:::frame` fence writes them (#857): the
 *  attribute's value range, and a per-character map when the text is
 *  printed as written. */
function stampFrameAttrText(
  box: VDTBlock,
  sources: Readonly<Record<string, { sourceStart: number; sourceEnd: number }>> | undefined,
  attrs: Readonly<Record<string, string>>,
  bodyOffset: number,
): void {
  if (!sources || !box.designOverlay) return;
  for (const name of ['label', 'title'] as const) {
    const src = sources[name];
    const value = attrs[name];
    if (!src || value === undefined || value.trim() === '') continue;
    const start = src.sourceStart + bodyOffset;
    const end = src.sourceEnd + bodyOffset;
    for (const b of box.designOverlay.blocks) {
      if (b.kind !== 'text' || b.attr !== undefined) continue;
      const shown = b.lines.map((l) => l.text).join(' ');
      if (shown.trim() !== value.trim() && shown.trim().toLocaleLowerCase() !== value.trim().toLocaleLowerCase()) continue;
      b.sourceStart = start;
      b.sourceEnd = end;
      b.attr = name;
      if (shown === value && end - start === value.length) {
        b.sourceText = value;
        b.sourceMap = Array.from({ length: value.length }, (_, i) => start + i);
      }
      break;
    }
  }
}

/** The callout style a frame is drawn with: `base` (its `style`, or the
 *  frameless frame style) with what a frame sets of its own: its padding
 *  (side by side) and a measure that is the frame's. A style's placement,
 *  span, width and margins do not apply to a frame. */
export function frameStyleOf(base: ResolvedCalloutStyleConfig, frame: ResolvedFrame): ResolvedCalloutStyleConfig {
  const padding = frame.padding ? { ...base.padding, ...frame.padding } : base.padding;
  return {
    ...base,
    padding,
    width: 'fill',
    placement: 'here',
    span: 'column',
    marginTop: { value: 0, unit: 'px' },
    marginBottom: { value: 0, unit: 'px' },
  };
}

/** The story heads of a composed page's stories, by the head frame's
 *  name, read from the boxes `wrapComposedPages` made (`FRAME_ATTR`). */
export function composedStories(
  startIdx: number,
  endIdx: number,
  plans: ReadonlyMap<number, PlannedCallout>,
): Map<string, ComposedStory> {
  const out = new Map<string, ComposedStory>();
  for (let i = startIdx + 1; i < endIdx; i++) {
    const plan = plans.get(i);
    if (!plan) continue;
    const head = plan.attrs[FRAME_ATTR];
    if (head !== undefined && !out.has(head)) out.set(head, { startIdx: i, plan });
    i = plan.endIdx;
  }
  return out;
}

/** `d` in px, 0 when unset. */
export function lengthPx(d: Parameters<typeof dimensionToPx>[0] | undefined, dpi: number, emPx: number): number {
  return d ? dimensionToPx(d, dpi, emPx) : 0;
}

/** A composed page of the pass whose template is known: its markers and
 *  its stories. */
export interface PlannedComposedPage {
  startIdx: number;
  endIdx: number;
  stories: Map<string, ComposedStory>;
  /** The story box holding block `idx`, if any. */
  storyAt(idx: number): ComposedStory | undefined;
}

/** The composed pages of `blocks` whose template `source` has, by their
 *  opening marker's index. */
export function planComposedPages(
  blocks: readonly ContentBlock[],
  plans: ReadonlyMap<number, PlannedCallout>,
  source: PageTemplateSource,
): Map<number, PlannedComposedPage> {
  const out = new Map<number, PlannedComposedPage>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'containerStart' || b.containerName !== 'composedPage' || !b.composedPage) continue;
    let end = i + 1;
    while (end < blocks.length && !(blocks[end]!.type === 'containerEnd' && blocks[end]!.containerId === b.containerId)) end++;
    end = Math.min(end, blocks.length - 1);
    if (resolvePageTemplate(source, b.composedPage.template)) {
      const stories = composedStories(i, end, plans);
      const list = [...stories.values()];
      out.set(i, {
        startIdx: i,
        endIdx: end,
        stories,
        storyAt: (idx) => list.find((s) => idx > s.startIdx && idx < s.plan.endIdx),
      });
    }
    i = end;
  }
  return out;
}

/** The planned composed page whose markers enclose block `idx`. */
export function composedPageAt(pages: ReadonlyMap<number, PlannedComposedPage>, idx: number): PlannedComposedPage | undefined {
  for (const p of pages.values()) if (idx > p.startIdx && idx < p.endIdx) return p;
  return undefined;
}

/** `words` with `{page}` as `page` (#917). */
const withPage = (words: string, page: string): string => words.split('{page}').join(page);

/** Mark the design text of `box` that sets `shown` as a continuation mark
 *  whose `{page}` the build fills in once pages are numbered (#917). */
function tagPageMark(box: VDTBlock, shown: string, text: string, page: 'to' | 'from'): void {
  const want = shown.trim();
  for (const b of box.designOverlay?.blocks ?? []) {
    if (b.kind !== 'text' || !b.artifact || b.pageMark) continue;
    if (b.lines.map((l) => l.text).join(' ').trim() !== want && b.lines.map((l) => l.text).join('').trim() !== want) continue;
    b.pageMark = { text: text.trim(), page };
    return;
  }
}
