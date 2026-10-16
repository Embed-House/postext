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
 * clipped at the foot (`frameOverflow`). Text runs round the frames that
 * push it (`exclude: 'push'`) already placed. The groups' negotiation
 * (#856), the reflow ladder (#858) and continuation on other pages (#859)
 * build on this.
 */
import type { ComposedPageFence, ContentBlock } from '../parse/types';
import type { ResolvedCalloutStyleConfig } from '../types';
import type { ContentWarning, ReflowEvent, VDTBlock, VDTComposedPage, VDTFrame, VDTPage } from '../vdt';
import { dimensionToPx } from '../units';
import { frameBounds } from '../composed/paint';
import { FRAME_ATTR } from '../composed/wrap';
import { frameOrder, framePlaceable, groupPlaceable, placeBox, unionRect, type FrameAreas, type Rect } from '../composed/geometry';
import type { ResolvedFrame, ResolvedPageTemplate } from '../composed/types';
import { resolvePageTemplate, type PageTemplateSource } from '../composed/templates';
import { offsetCalloutToAbsolute, type CalloutLayoutResult, type PlannedCallout } from './calloutLayout';
import { CUT_START, fragmentRange, makeCalloutLayouter, splitCalloutFragment, type CalloutCut, type CalloutLayouter, type FrameBoxOptions, type FrameLayoutPass } from './frameLayout';

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

export function layoutComposedPage(input: ComposedPageInput): ComposedPageLayout {
  const { pass, page, template, fence, dpi } = input;
  const fi = fence.fenceIndex;
  const frameIdOf = (name: string): string => `cp${fi}:${name}`;
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const prev = new Map<string, string>();
  for (const f of template.frames) if (f.next && byName.has(f.next) && !prev.has(f.next)) prev.set(f.next, f.name);
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
  /** Place and fill every frame. `seed`: the boxes of the frames that push
   *  text, from a first run, so a frame placed before one that pushes it
   *  (the photo anchored to its box) still runs round it. */
  const run = (seed?: ReadonlyMap<string, Rect>) => {
    const pushRects = new Map<string, Rect>();
    const states = new Map<string, StoryState>();
    const stateOf = (frame: ResolvedFrame): StoryState | undefined => {
      const head = headOf(frame.name);
      const known = states.get(head);
      if (known) return known;
      const story = input.stories.get(head);
      const headFrame = byName.get(head);
      if (!story || !headFrame) return undefined;
      const st: StoryState = {
        story,
        L: makeCalloutLayouter(pass, story.startIdx, story.plan, input.styleOf(frame)),
        cut: CUT_START,
        pieces: 0,
        headBlockId: frameIdOf(head),
        headFrameId: frameIdOf(head),
      };
      states.set(head, st);
      return st;
    };
    const atEnd = (st: StoryState): boolean => st.cut.child >= st.L.end.child && st.cut.line === 0 && !st.cut.group;

    const rects = new Map<string, Rect>();
    const groupRect = (name: string): Rect | undefined => {
      const g = template.groups.find((gr) => gr.name === name);
      if (!g) return undefined;
      const own = groupPlaceable(g);
      if (own) return placeBox(own, template, input, (n) => rects.get(n) ?? groupRect(n), () => 0);
      return unionRect(g.frames.flatMap((m) => (rects.has(m) ? [rects.get(m)!] : [])));
    };
    const refOf = (name: string): Rect | undefined => rects.get(name) ?? groupRect(name);

    const frames: VDTFrame[] = [];
    const vdtByName = new Map<string, VDTFrame>();
    const blocks: VDTBlock[] = [];
    const warnings: ContentWarning[] = [];
    const log: ReflowEvent[] = [];
    const laid = new Set<string>();
    const pushed: { name: string; box: Rect }[] = seed ? [...seed].map(([name, box]) => ({ name, box })) : [];

    /** The rectangles of the pushing frames placed so far that `rect`
     *  meets, in the frame block's coordinates. */
    const exclusionsFor = (frame: ResolvedFrame, rect: Rect, open: boolean): FrameBoxOptions['exclusions'] => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const g = input.pushGapPx;
      for (const p of pushed) {
        if (p.name === frame.name) continue;
        const b = p.box;
        const below = open ? true : b.y < rect.y + rect.height;
        if (b.x - g >= rect.x + rect.width || b.x + b.width + g <= rect.x || !below || b.y + b.height + g <= rect.y) continue;
        out.push({ x: b.x - g - rect.x, y: b.y - g - rect.y, width: b.width + 2 * g, height: b.height + 2 * g });
      }
      return out.length > 0 ? out : undefined;
    };

    for (const frame of frameOrder(template)) {
      const st = stateOf(frame);
      // Each frame of a chain sets the story in its own style: the cuts are
      // positions in the story's blocks, the same in any.
      if (st) st.L = makeCalloutLayouter(pass, st.story.startIdx, st.story.plan, input.styleOf(frame));
      // A frame continues its story only once the frame before it in the
      // chain was filled (a frame placed before it, through an anchor, starts
      // empty).
      const before = prev.get(frame.name);
      const reached = st !== undefined && (before === undefined || vdtByName.has(before));
      const holds = reached && !atEnd(st!);
      const continuation = st !== undefined && st.pieces > 0;
      const blockId = st && st.pieces > 0 ? `${st.headBlockId}-cont-${st.pieces}` : frameIdOf(frame.name);
      const style = input.styleOf(frame);
      const placeable = framePlaceable(frame);
      /** The content's height at `width`, running round the pushing
       *  frames below the top of `at` (the frame's box as first placed). */
      const natural = (at?: Rect) => (width: number): number => {
        if (!holds) return 0;
        const exclusions = at ? exclusionsFor(frame, { ...at, width }, true) : undefined;
        const r = st!.L.layoutRange(st!.cut, st!.L.end, width, blockId, continuation, input.mirrored, exclusions ? { exclusions } : undefined);
        return r.totalHeight;
      };
      // The box: placed with the content's own height, then again with the
      // height it takes running round the frames that push it there.
      const rect0 = placeBox(placeable, template, input, refOf, natural());
      const rect = holds && exclusionsFor(frame, rect0, true) ? placeBox(placeable, template, input, refOf, natural(rect0)) : rect0;
      rects.set(frame.name, rect);
      let result: CalloutLayoutResult | undefined;
      let overflowPx = 0;
      const from = st?.cut ?? CUT_START;
      if (holds) {
        const opts: FrameBoxOptions = {
          boxHeight: rect.height,
          verticalAlign: frame.verticalAlign,
          ...(exclusionsFor(frame, rect, false) ? { exclusions: exclusionsFor(frame, rect, false) } : {}),
        };
        const whole = st!.L.layoutRange(from, st!.L.end, rect.width, blockId, continuation, input.mirrored, opts);
        const nextFrame = frame.next ? byName.get(frame.next) : undefined;
        if ((whole.overflowPx ?? 0) > 0.5 && nextFrame && !vdtByName.has(nextFrame.name)) {
          // The rest goes on in the next frame of the chain.
          const minLines = Math.max(1, style.splitMinLines);
          const frag = splitCalloutFragment(pass, st!.L, from, rect.width, rect.height, blockId, continuation, minLines, input.mirrored, opts.exclusions ? { exclusions: opts.exclusions } : undefined);
          const to = frag?.to ?? from;
          result = frag
            ? st!.L.layoutRange(from, to, rect.width, blockId, continuation, input.mirrored, opts)
            : undefined;
          st!.cut = to;
        } else {
          result = whole;
          overflowPx = whole.overflowPx ?? 0;
          st!.cut = st!.L.end;
        }
      } else if (st && frame.style) {
        // A styled frame with nothing (left) to hold still draws its box.
        result = st.L.layoutRange(st.L.end, st.L.end, rect.width, blockId, true, input.mirrored, { boxHeight: rect.height });
      }
      const vdt: VDTFrame = {
        id: frameIdOf(frame.name),
        name: frame.name,
        rect: { ...rect },
        rotate: frame.rotate,
        layer: frame.layer,
        ...(frame.style ? { styleId: frame.style } : {}),
        scale: 1,
        overflowPx,
        blockIds: [],
        configPath: frame.configPath,
        ...(frame.exclude === 'push' ? { push: true as const } : {}),
      };
      if (before && vdtByName.has(before) && st && st.lastFrameId) {
        vdt.continuedFrom = st.lastFrameId;
        const p = frames.find((f) => f.id === st.lastFrameId);
        if (p) p.continuesTo = vdt.id;
      }
      if (result && st) {
        const range = fragmentRange(st.L, from, st.cut);
        commitFrame(result, rect, st.story, range, input, vdt, blocks);
        st.pieces++;
        st.lastFrameId = vdt.id;
        laid.add(headOf(frame.name));
      }
      if (overflowPx > 0.5) {
        const overflowMm = Math.round((overflowPx / dpi) * MM_PER_IN * 10) / 10;
        log.push({ frame: frame.name, kind: 'overflow', toMm: overflowMm });
        warnings.push({
          kind: 'frameOverflow',
          template: template.id,
          frame: frame.name,
          fenceIndex: fi,
          overflowMm,
          configPath: frame.configPath,
          ...(vdt.sourceStart !== undefined ? { sourceStart: vdt.sourceStart, sourceEnd: vdt.sourceEnd } : {}),
          pageIndex: page.index,
        });
      }
      if (frame.exclude === 'push') {
        const box = frameBounds({ rect, rotate: frame.rotate });
        pushRects.set(frame.name, box);
        if (!seed) pushed.push({ name: frame.name, box });
      }
      frames.push(vdt);
      vdtByName.set(frame.name, vdt);
    }
    return { frames, blocks, warnings, log, laid, pushRects };
  };
  const first = run();
  const { frames, blocks, warnings, log, laid } = first.pushRects.size > 0 ? run(first.pushRects) : first;
  // Template order on the page record.
  const order = new Map(template.frames.map((f, i) => [f.name, i]));
  frames.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const contentBlocks = pass.contentBlocks;
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
  return { composed, blocks, warnings, laid };
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
