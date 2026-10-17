/**
 * Spread templates (#861, DESIGN §2.1): a `spread: true` template laid as
 * one sheet of two facing pages, then cut at the spine, as comic spreads
 * are (`comics/spread.ts`).
 *
 * The sheet is in *spread coordinates*: the first page's frame, with the
 * second page's set against it so that the two trim boxes meet at the
 * spine (`shift` = the trim's width). The first page is the one on the
 * left of the flow: the left page of a left-to-right book, the right page
 * of a book whose flow is mirrored (right to left), whose frames are in
 * flow coordinates. The template's `area` spans both pages (both inner
 * margins inside it), the trim and the bleed run from one outer edge to
 * the other, with no bleed at the spine.
 *
 * - The gutter: a band of `gutter` centred on the spine. A frame without
 *   `crossGutter` that meets it is kept off it, on the side of its centre
 *   (its edge moved to the band's, or the frame moved out when it starts
 *   inside it); an `'auto'` height is measured at the narrower width.
 * - The cut: each frame goes to the page that holds it. A frame crossing
 *   the spine is read on the page holding its centre (the first page when
 *   it is centred on the spine); the facing page gets
 *   a copy of its blocks moved onto its own sheet (`VDTFrame.facingBlocks`),
 *   painted, never read. Each page clips its frames and its decoration to
 *   its bleed box (`VDTComposedPage.sheetClip`), so a band across the spine
 *   shows its own half on each side.
 * - Decoration is laid once, over the physical sheet of two pages, then
 *   cut the same way ({@link splitSpreadDecoration}).
 */
import type { BoundingBox, ContentWarning, ReflowEvent, VDTBlock, VDTComposedPage, VDTDesignSlot, VDTFrame, VDTPage } from '../vdt';
import { offsetBlock, offsetDesignBlock } from '../pipeline/calloutLayout';
import { layoutComposedPage, lengthPx, type ComposedPageInput, type ComposedPageLayout } from '../pipeline/composedLayout';
import { frameBounds } from './paint';
import type { FrameAreas, Rect } from './geometry';
import type { ResolvedFrame, ResolvedPageTemplate } from './types';
import type { ComposedContinuation } from './continuation';

const MM_PER_IN = 25.4;
/** Below this a frame touches the spine without crossing it (px). */
const SPINE_EPS = 0.5;

/** The sheet of two pages a spread template is laid on. */
export interface SpreadSheet {
  /** Where the second page's sheet starts in spread coordinates. */
  shift: number;
  /** The spine's x. */
  spine: number;
  /** The template's area, the trim and the bleed of the sheet. */
  areas: FrameAreas;
  /** What each page shows of the sheet: its bleed box, in spread
   *  coordinates (the first page's, then the second's). */
  shows: [Rect, Rect];
}

const unionOf = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/**
 * The sheet of two pages: `trim` and `bleed` are one page's boxes (the
 * same on every page, centred on the sheet, so a mirrored flow reads them
 * unchanged); `first` and `second` the pages' content areas.
 */
export function spreadSheet(area: ResolvedPageTemplate['area'], first: Rect, second: Rect, trim: Rect, bleed: Rect): SpreadSheet {
  const spine = trim.x + trim.width;
  const shift = spine - trim.x;
  const page: Rect = { x: trim.x, y: trim.y, width: shift + trim.width, height: trim.height };
  const bleedBox: Rect = { x: bleed.x, y: bleed.y, width: shift + bleed.width, height: bleed.height };
  const content = unionOf(first, { ...second, x: second.x + shift });
  return {
    shift,
    spine,
    areas: { area: area === 'trim' ? page : area === 'bleed' ? bleedBox : content, page, bleed: bleedBox },
    shows: [{ ...bleed }, { ...bleed, x: bleed.x + shift }],
  };
}

/**
 * The box a frame takes on a spread: `rect` as placed, or, for a frame
 * without `crossGutter` that meets the spine band `[spine − g/2, spine +
 * g/2]`, the box kept off it on the side of its centre: a frame reaching
 * across the whole band is cut at the band's edge; one whose inner edge
 * falls inside the band moves out whole, keeping its width.
 */
export function keepOffGutter(frame: Pick<ResolvedFrame, 'crossGutter'>, rect: Rect, spine: number, gutterPx: number): Rect {
  if (frame.crossGutter) return rect;
  const lo = spine - gutterPx / 2;
  const hi = spine + gutterPx / 2;
  const right = rect.x + rect.width;
  if (right <= lo + SPINE_EPS || rect.x >= hi - SPINE_EPS) return rect;
  // A frame centred on the spine stays on the first page.
  const centre = rect.x + rect.width / 2;
  if (centre <= spine + SPINE_EPS) {
    return right > hi ? { ...rect, width: Math.max(0, lo - rect.x) } : { ...rect, x: lo - rect.width };
  }
  return rect.x < lo ? { ...rect, x: hi, width: Math.max(0, right - hi) } : { ...rect, x: hi };
}

/** One page of a laid spread. */
export interface ComposedSpreadSide {
  page: VDTPage;
  composed: VDTComposedPage;
  /** Blocks the page reads (each frame's box first): its `page.floats`
   *  and `doc.blocks`. The facing copies are on their frames. */
  blocks: VDTBlock[];
}

export interface ComposedSpreadLayout {
  /** The first page of the flow, then the second. */
  sides: [ComposedSpreadSide, ComposedSpreadSide];
  warnings: ContentWarning[];
  laid: Set<string>;
  /** Content the sheet's frames send on to other pages (#859). */
  continuations?: ComposedContinuation[];
}

export interface ComposedSpreadInput extends Omit<ComposedPageInput, 'page' | 'areas' | 'fitBox'> {
  /** The page on the left of the flow, and the page after it in the flow. */
  first: VDTPage;
  second: VDTPage;
  /** Each page's physical side of the open book. */
  firstSide: 'left' | 'right';
  /** One page's trim and bleed boxes. */
  trim: Rect;
  bleed: Rect;
}

/** Copies of `blocks` moved by `dx` onto page `pageIndex` (ids suffixed
 *  `suffix`). The laid blocks are never moved in place: a box typesetter
 *  may share measured parts between runs. */
function movedCopies(blocks: readonly VDTBlock[], dx: number, pageIndex: number, suffix: string): VDTBlock[] {
  return blocks.map((b) => {
    const c = structuredClone(b);
    if (dx !== 0) offsetBlock(c, dx, 0);
    c.pageIndex = pageIndex;
    if (suffix) c.id = `${c.id}${suffix}`;
    return c;
  });
}

/**
 * Lay a spread template over two facing pages: one composed layout on the
 * sheet of two pages ({@link spreadSheet}), frames kept off the spine band
 * ({@link keepOffGutter}), then each frame and its blocks moved to the page
 * that holds it, and the half of a frame crossing the spine copied onto
 * the facing page.
 */
export function layoutComposedSpread(input: ComposedSpreadInput): ComposedSpreadLayout {
  const { first, second, template, dpi } = input;
  const sheet = spreadSheet(template.area, first.contentArea, second.contentArea, input.trim, input.bleed);
  const gutterPx = lengthPx(template.gutter, dpi, input.emPx);
  const mm = (v: number): number => Math.round((v / dpi) * MM_PER_IN * 10) / 10;
  const out: ComposedPageLayout = layoutComposedPage({
    ...input,
    page: first,
    areas: sheet.areas,
    fitBox: (frame, rect) => keepOffGutter(frame, rect, sheet.spine, gutterPx),
  });
  // What the gutter did, read off the layout the reflow ladder (#858)
  // settled on (not the ones it only tried).
  const resized = new Map<string, ReflowEvent>();
  for (const [name, { placed, kept }] of out.fitted ?? []) {
    if (Math.abs(kept.width - placed.width) > 0.5) resized.set(name, { frame: name, kind: 'resized', fromMm: mm(placed.width), toMm: mm(kept.width), cause: 'gutter' });
    else resized.set(name, { frame: name, kind: 'moved', fromMm: mm(placed.x), toMm: mm(kept.x), cause: 'gutter' });
  }
  const pages = [first, second] as const;
  const byId = new Map(out.blocks.map((b) => [b.id, b]));
  const sideFrames: [VDTFrame[], VDTFrame[]] = [[], []];
  const sideBlocks: [VDTBlock[], VDTBlock[]] = [[], []];
  const sideOf = new Map<string, 0 | 1>();
  for (const frame of out.composed.frames) {
    const b = frameBounds(frame);
    const onFirst = b.x < sheet.spine - SPINE_EPS;
    const onSecond = b.x + b.width > sheet.spine + SPINE_EPS;
    const owner: 0 | 1 = onFirst && onSecond ? (b.x + b.width / 2 <= sheet.spine + SPINE_EPS ? 0 : 1) : onSecond ? 1 : 0;
    sideOf.set(frame.name, owner);
    const blocks = frame.blockIds.map((id) => byId.get(id)).filter((x): x is VDTBlock => x !== undefined);
    const dx = owner === 0 ? 0 : -sheet.shift;
    const own = owner === 0 ? blocks : movedCopies(blocks, dx, second.index, '');
    for (const blk of own) blk.pageIndex = pages[owner].index;
    const moved = (by: number): VDTFrame => ({
      ...frame,
      rect: { ...frame.rect, x: frame.rect.x + by },
      ...(frame.declaredRect ? { declaredRect: { ...frame.declaredRect, x: frame.declaredRect.x + by } } : {}),
    });
    sideFrames[owner].push(moved(dx));
    sideBlocks[owner].push(...own);
    if (onFirst && onSecond) {
      const other: 0 | 1 = owner === 0 ? 1 : 0;
      const odx = other === 0 ? 0 : -sheet.shift;
      sideFrames[other].push({
        ...moved(odx),
        blockIds: [],
        facingBlocks: movedCopies(blocks, odx, pages[other].index, '-facing'),
      });
    }
  }
  // Template order on each page record, as on a single page.
  const order = new Map(template.frames.map((f, i) => [f.name, i]));
  for (const list of sideFrames) list.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const log: [ReflowEvent[], ReflowEvent[]] = [[], []];
  for (const ev of [...resized.values(), ...out.composed.log]) log[sideOf.get(ev.frame) ?? 0].push(ev);
  const warnings = out.warnings.map((w) => {
    const side = w.kind === 'frameOverflow' ? sideOf.get(w.frame) ?? 0 : 0;
    return side === 1 ? { ...w, pageIndex: second.index } : w;
  });
  const secondSide: 'left' | 'right' = input.firstSide === 'left' ? 'right' : 'left';
  const side = (i: 0 | 1): ComposedSpreadSide => {
    const page = pages[i];
    const show = sheet.shows[i];
    const composed: VDTComposedPage = {
      ...out.composed,
      spread: i === 0 ? input.firstSide : secondSide,
      facingPage: pages[i === 0 ? 1 : 0].index,
      sheetClip: { ...show, x: show.x - (i === 0 ? 0 : sheet.shift) },
      frames: sideFrames[i],
      log: log[i],
    };
    return { page, composed, blocks: sideBlocks[i] };
  };
  return { sides: [side(0), side(1)], warnings, laid: out.laid, ...(out.continuations ? { continuations: out.continuations } : {}) };
}

/**
 * The decoration of a spread, laid once over the physical sheet of two
 * pages (the left page's sheet with the right page's set against it at
 * `shift`), cut for each page: the blocks that reach the page's bleed box
 * (`shows`, in sheet coordinates), moved onto its own sheet. A block
 * crossing the spine goes to both pages; each paints it clipped to its
 * `sheetClip`.
 */
export function splitSpreadDecoration(slot: VDTDesignSlot, shift: number, shows: { left: BoundingBox; right: BoundingBox }): { left: VDTDesignSlot; right: VDTDesignSlot } {
  const cut = (box: BoundingBox, dx: number): VDTDesignSlot => {
    const blocks = slot.blocks
      .filter((b) => b.bbox.x < box.x + box.width && b.bbox.x + b.bbox.width > box.x)
      .map((b) => {
        const c = structuredClone(b);
        if (dx !== 0) offsetDesignBlock(c, dx, 0);
        return c;
      });
    const x = Math.max(slot.bbox.x, box.x);
    const right = Math.min(slot.bbox.x + slot.bbox.width, box.x + box.width);
    return { bbox: { x: x + dx, y: slot.bbox.y, width: Math.max(0, right - x), height: slot.bbox.height }, blocks };
  };
  return { left: cut(shows.left, 0), right: cut(shows.right, -shift) };
}
