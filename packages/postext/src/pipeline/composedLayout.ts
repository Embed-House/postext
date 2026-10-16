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
import { framePlaceable, nextFrameOf, groupPlaceable, placeBox, unionRect, type FrameAreas, type Rect } from '../composed/geometry';
import { composedOrder, groupOfFrames, layoutGroup, type GroupItem } from '../composed/groups';
import { reflowEvents, type FrameMotion } from '../composed/reflowLog';
import { anchorTarget } from '../composed/templates';
import type { ResolvedFrame, ResolvedFrameGroup, ResolvedPageTemplate } from '../composed/types';
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
  /** The box a frame takes given the one its placement gives: on a spread
   *  (#861, `composed/spread.ts`), off the spine band unless the frame
   *  crosses the gutter. An `'auto'` height is measured at the width it
   *  returns. */
  fitBox?: (frame: ResolvedFrame, rect: Rect) => Rect;
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
  for (const f of template.frames) {
    const n = nextFrameOf(f);
    if (n && byName.has(n) && !prev.has(n)) prev.set(n, f.name);
  }
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

    const frames: VDTFrame[] = [];
    const vdtByName = new Map<string, VDTFrame>();
    const blocks: VDTBlock[] = [];
    const warnings: ContentWarning[] = [];
    const overflowLog: ReflowEvent[] = [];
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

    /** Where a frame's story stands when the frame is reached. */
    interface Prep {
      frame: ResolvedFrame;
      st: StoryState | undefined;
      before: string | undefined;
      holds: boolean;
      continuation: boolean;
      blockId: string;
    }
    const prepare = (frame: ResolvedFrame): Prep => {
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
      return { frame, st, before, holds, continuation, blockId };
    };
    /** The content's height at `width`, running round the pushing frames
     *  below the top of `at` (the frame's box as first placed). */
    const naturalOf = (p: Prep, at?: Rect) => {
      const memo = new Map<number, number>();
      return (width: number): number => {
        if (!p.holds) return 0;
        const key = Math.round(width * 1000);
        const known = memo.get(key);
        if (known !== undefined) return known;
        const exclusions = at ? exclusionsFor(p.frame, { ...at, width }, true) : undefined;
        const r = p.st!.L.layoutRange(p.st!.cut, p.st!.L.end, width, p.blockId, p.continuation, input.mirrored, exclusions ? { exclusions } : undefined);
        memo.set(key, r.totalHeight);
        return r.totalHeight;
      };
    };
    /** `placeBox`, then the box the page lets the frame take (`fitBox`:
     *  off a spread's spine band, #861), its `'auto'` height measured at the
     *  width it is left with. Declared and final boxes alike: the band is
     *  the template's, not a reflow. */
    const placeFitted = (frame: ResolvedFrame, placeable: ReturnType<typeof framePlaceable>, ctx: Parameters<typeof placeBox>[2], refs: (n: string) => Rect | undefined, nat: (width: number) => number): Rect => {
      const r = placeBox(placeable, template, ctx, refs, nat);
      if (!input.fitBox) return r;
      const fitted = input.fitBox(frame, r);
      if (Math.abs(fitted.width - r.width) < 0.01) return fitted;
      return input.fitBox(frame, placeBox(placeable, template, ctx, refs, () => nat(fitted.width)));
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
     *  their content needs (`composed/groups.ts`). */
    const placeGroup = (group: ResolvedFrameGroup, members: readonly ResolvedFrame[]): Map<string, Rect> => {
      const own = groupPlaceable(group);
      const mmPx = dpi / MM_PER_IN;
      const preps = members.map(prepare);
      const solve = (mode: 'final' | 'declared', naturals: ((w: number) => number)[]): { rects: Map<string, Rect>; box: Rect } => {
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
          return {
            name: f.name,
            own: box,
            want,
            min: minH,
            max: f.maxHeight ? dimensionToPx(f.maxHeight, dpi, input.emPx) : Infinity,
            minWidth: f.minWidth ? dimensionToPx(f.minWidth, dpi, input.emPx) : 0,
            maxWidth: f.maxWidth ? dimensionToPx(f.maxWidth, dpi, input.emPx) : Infinity,
            grow: fill ? Math.max(1, f.grow) : f.grow,
            shrink: f.shrink,
            priority: f.priority,
            pin: f.pin,
            fixedHeight: !auto && !fill,
            need: natural,
          };
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
        return { rects: out, box: ownBox ?? unionRect([...out.values()]) ?? box };
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
      for (const m of members) {
        rects.set(m.name, fin.rects.get(m.name)!);
        declared.set(m.name, decl.rects.get(m.name)!);
        if (m.pin) pinned.push({ name: m.name, rect: fin.rects.get(m.name)! });
      }
      groupRects.set(group.name, fin.box);
      groupDeclared.set(group.name, decl.box);
      return fin.rects;
    };

    /** Pour a frame's content into its box and record the frame. */
    const fill = (p: Prep, rect: Rect): void => {
      const { frame, st, holds, continuation, blockId, before } = p;
      const style = input.styleOf(frame);
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
        const nextName = nextFrameOf(frame);
        const nextFrame = nextName !== undefined ? byName.get(nextName) : undefined;
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
      const decl = declared.get(frame.name);
      if (decl && !sameRect(decl, rect)) vdt.declaredRect = { ...decl };
      if (before && vdtByName.has(before) && st && st.lastFrameId) {
        vdt.continuedFrom = st.lastFrameId;
        const q = frames.find((f) => f.id === st.lastFrameId);
        if (q) q.continuesTo = vdt.id;
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
        overflowLog.push({ frame: frame.name, kind: 'overflow', toMm: overflowMm });
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
    const log = mergeLog(reflowEvents(motionsOf(template, rects, declared), dpi / MM_PER_IN), overflowLog, template);
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
