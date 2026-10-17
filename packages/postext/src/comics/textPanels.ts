/**
 * Text panels (`::panel{text}`, #885, DESIGN §7): a panel whose body is
 * Markdown, poured into the frame the split generated for it the way a
 * composed page pours a slot into a frame.
 *
 * The block parser reads the body as any text and sets its blocks right
 * after the comic's directive. Before layout, {@link wrapComicTextPanels}
 * puts each panel's blocks in one frameless story box (the composed pages'
 * {@link FRAME_STYLE_ID} box); the comic page's layout then sets each story
 * in its panel's frame with the composed pages' frame layout
 * (`layoutComposedPage`, one frame filling the panel's text area), so a
 * text panel has real paragraphs: selectable, searchable, read in order by
 * tagged PDF and EPUB. Where a frame cannot take the text (a strip, a
 * spread, a page whose flow is turned or mirrored), the blocks stay
 * unwrapped and are set in the flow after the comic, never lost
 * (`comicPanelFrame`).
 */

import type { ContentBlock } from '../parse/types';
import type { CalloutPaddingConfig, Dimension, ResolvedCalloutStyleConfig } from '../types';
import type { ContentWarning, ResolvedConfig, VDTBlock, VDTComicPage, VDTPage } from '../vdt';
import { pageIsMirrored, pageIsVertical } from '../vdt';
import { FRAME_ATTR, FRAME_STYLE_ID } from '../composed/wrap';
import { normalizeFrame } from '../composed/templates';
import type { ResolvedFrame, ResolvedPageTemplate } from '../composed/types';
import type { PlannedCallout } from '../pipeline/calloutLayout';
import type { FrameLayoutPass } from '../pipeline/frameLayout';
import { composedStories, layoutComposedPage, type ComposedStory, type PlannedComposedPage } from '../pipeline/composedLayout';
import { resolvedDirection } from '../pipeline/config';
import { dimensionToPx } from '../units';
import { resolvedComics } from '../defaults/comics';
import { isComicSpread } from './spread';
import { comicBoxStyle, isComicTextPanel } from './frames';
import { comicPanelSources, setComicLayoutWarnings, comicPageLayoutWarnings } from './layoutPage';
import type { ComicPageSource, ComicPanelSource } from './types';

/** `containerAttrs` key of a text panel's story box: the panel's index in
 *  its page's source (`ComicPanelSource.index`). */
export const COMIC_PANEL_ATTR = '__comicPanel';

/** Container ids of the text panels' story boxes: past any id the parser
 *  hands out and clear of the other synthetic boxes'. */
const COMIC_TEXT_CONTAINER_BASE = 1_900_000_000;

/** The story key of a text panel (its box's `FRAME_ATTR`). */
export const comicTextStoryKey = (panelIndex: number): string => `comic:${panelIndex}`;

/** Whether text panels can be set in their frames in a document: frames
 *  take text on pages whose flow is the sheet (horizontal, left to right).
 *  On a vertical or right-to-left document the text is set in the flow
 *  after the comic. */
export function comicTextPanelsSupported(resolved: Pick<ResolvedConfig, 'layout'> & Parameters<typeof resolvedDirection>[0]): boolean {
  return resolved.layout.writingMode !== 'vertical-rl' && resolvedDirection(resolved) !== 'rtl';
}

/** Why a text panel's Markdown is set in the flow instead of its frame:
 *  the comic is a strip or a spread, or the document's flow is turned or
 *  mirrored. Undefined when its frame takes it. */
export function comicTextPanelFallback(source: Pick<ComicPageSource, 'kind' | 'attrs'>, supported: boolean): 'strip' | 'spread' | 'flow' | undefined {
  if (source.kind === 'strip') return 'strip';
  if (isComicSpread(source)) return 'spread';
  if (!supported) return 'flow';
  return undefined;
}

/**
 * `blocks` with the Markdown of every text panel of a comic page set in
 * its frame regrouped in a story box of its own (see the module comment).
 * Only comics outside any container and whose frame takes text
 * ({@link comicTextPanelFallback}). The same array comes back when there
 * is nothing to wrap.
 */
export function wrapComicTextPanels(blocks: readonly ContentBlock[], supported: boolean): { blocks: ContentBlock[]; wrapped: boolean } {
  let out: ContentBlock[] | undefined;
  let next = 0;
  let depth = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type === 'containerStart') depth++;
    else if (b.type === 'containerEnd') depth = Math.max(0, depth - 1);
    const comic = b.type === 'directive' && depth === 0 ? b.comic : undefined;
    const texts = comic && comicTextPanelFallback(comic, supported) === undefined ? comic.panels.filter((p) => p.text && p.text.end > p.text.start && isComicTextPanel(p)) : [];
    if (texts.length === 0) {
      out?.push(b);
      continue;
    }
    out ??= blocks.slice(0, i);
    out.push(b);
    // The panels' blocks follow the directive, panel after panel.
    let k = i + 1;
    for (const panel of texts) {
      const range = panel.text!;
      const start = k;
      while (k < blocks.length && blocks[k]!.sourceStart >= range.start && blocks[k]!.sourceEnd <= range.end) k++;
      if (k === start) continue;
      const first = blocks[start]!;
      const last = blocks[k - 1]!;
      const id = COMIC_TEXT_CONTAINER_BASE + next++;
      out.push({
        type: 'containerStart',
        text: '',
        spans: [],
        containerName: 'callout',
        containerAttrs: { type: FRAME_STYLE_ID, placement: 'here', span: 'column', [FRAME_ATTR]: comicTextStoryKey(panel.index), [COMIC_PANEL_ATTR]: String(panel.index) },
        containerId: id,
        sourceStart: first.sourceStart,
        sourceEnd: first.sourceStart,
        sourceMap: [],
      });
      for (let j = start; j < k; j++) out.push(blocks[j]!);
      out.push({ type: 'containerEnd', text: '', spans: [], containerName: 'callout', containerId: id, sourceStart: last.sourceEnd, sourceEnd: last.sourceEnd, sourceMap: [] });
    }
    i = k - 1;
  }
  return out ? { blocks: out, wrapped: next > 0 } : { blocks: blocks as ContentBlock[], wrapped: false };
}

/** The text panels' stories of every comic page of the pass, by the index
 *  of its directive: the markers they span (the directive to the closing
 *  marker of the last story) and the stories by key
 *  ({@link comicTextStoryKey}). */
export function planComicTextPanels(blocks: readonly ContentBlock[], plans: ReadonlyMap<number, PlannedCallout>): Map<number, PlannedComposedPage> {
  const out = new Map<number, PlannedComposedPage>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'directive' || !b.comic) continue;
    let end = i;
    for (let plan = plans.get(end + 1); plan && plan.attrs[COMIC_PANEL_ATTR] !== undefined; plan = plans.get(end + 1)) end = plan.endIdx;
    if (end === i) continue;
    const stories = composedStories(i, end + 1, plans);
    const list = [...stories.values()];
    out.set(i, {
      startIdx: i,
      endIdx: end,
      stories,
      storyAt: (idx) => list.find((s) => idx > s.startIdx && idx < s.plan.endIdx),
    });
    i = end;
  }
  return out;
}

/** What {@link layoutComicTextFrames} reads of the pass (as a composed page
 *  does, `ComposedPageInput`). */
export interface ComicTextFramesInput {
  pass: FrameLayoutPass;
  resolved: ResolvedConfig;
  page: VDTPage;
  comic: VDTComicPage;
  plan: PlannedComposedPage;
  /** The style a frame is drawn with: its `style`, else frameless. */
  styleOf(frame: ResolvedFrame): ResolvedCalloutStyleConfig;
  dpi: number;
  emPx: number;
  bodyOffset: number;
  mirrored: boolean;
  pushGapPx: number;
  locale?: string;
}

export interface ComicTextFramesLayout {
  /** The frames' boxes and content, for `page.floats` and `doc.blocks`. */
  blocks: VDTBlock[];
  /** The stories set (by key). */
  laid: Set<string>;
}

const px = (v: number): Dimension => ({ value: v, unit: 'px' });

/**
 * Set the text panels of a laid-out comic page in their frames: each text
 * frame of `comic.frames` gets the blocks its story was set in
 * (`blockIds`), its overflow and its scale; a frame its text does not fit
 * clips it (`comicPanelFrame`, reason `textOverflow`). The frame's text
 * area is the panel's box inside its border and the lettering's inset;
 * with a `box` style, the panel's box (the style's padding keeps the text
 * off its edges).
 */
export function layoutComicTextFrames(input: ComicTextFramesInput): ComicTextFramesLayout {
  const { comic, page, plan, resolved, dpi } = input;
  const blocks: VDTBlock[] = [];
  const laid = new Set<string>();
  if (!comic.frames || pageIsVertical(page) || pageIsMirrored(page)) return { blocks, laid };
  const sources = comicPanelSources(comic);
  const insetPx = dimensionToPx(resolvedComics(resolved).lettering.inset, dpi);
  const warnings: ContentWarning[] = [];
  const fence = Number(/^cm(\d+)$/.exec(comic.id ?? '')?.[1] ?? 0);
  comic.frames.forEach((frame, fi) => {
    const panelIndex = frame.panel ?? fi;
    const src: ComicPanelSource | undefined = sources[panelIndex];
    if (!src || !isComicTextPanel(src)) return;
    const key = comicTextStoryKey(src.index);
    const story: ComposedStory | undefined = plan.stories.get(key);
    if (!story) return;
    const panel = comic.panels[panelIndex]!;
    const box = comicBoxStyle(resolved, src.attrs.box);
    const edge = box ? 0 : panel.border.width + insetPx;
    // A slanted cell: the widest box with straight sides inside its outline,
    // so that no line runs past the slant.
    const r = frame.polygon ? innerBox(frame.polygon, panel.bbox) : panel.bbox;
    const area = { x: r.x + edge, y: r.y + edge, width: Math.max(1, r.width - 2 * edge), height: Math.max(1, r.height - 2 * edge) };
    const valign = src.attrs.valign?.trim().toLowerCase();
    const padding: CalloutPaddingConfig | undefined = box ? undefined : { top: px(0), right: px(0), bottom: px(0), left: px(0) };
    const resolvedFrame = normalizeFrame({
      name: frame.name,
      width: 'fill',
      height: 'fill',
      ...(box ? { style: box.id } : {}),
      ...(valign === 'middle' || valign === 'bottom' ? { verticalAlign: valign } : {}),
      ...(padding ? { padding } : {}),
    });
    const template: ResolvedPageTemplate = {
      id: comic.id ?? 'comic',
      area: 'content',
      frames: [resolvedFrame],
      groups: [],
      decoration: { elements: [] },
      decorationPaths: [],
      spread: false,
      gutter: px(0),
      role: 'comic',
      chain: [comic.id ?? 'comic'],
      configPath: '',
    };
    const out = layoutComposedPage({
      pass: input.pass,
      page,
      template,
      fence: { template: template.id, spread: false, attrs: {}, attrSources: {}, fenceIndex: fence, colons: 4 },
      startIdx: plan.startIdx,
      endIdx: plan.endIdx,
      stories: new Map([[frame.name, story]]),
      styleOf: input.styleOf,
      areas: { area, page: area, bleed: area },
      dpi,
      emPx: input.emPx,
      bodyOffset: input.bodyOffset,
      mirrored: input.mirrored,
      pushGapPx: input.pushGapPx,
      ...(input.locale ? { locale: input.locale } : {}),
    });
    const set = out.composed.frames[0];
    if (!set || !out.laid.has(frame.name)) return;
    laid.add(key);
    // The composed pages' ids (`cp<n>:…`) as the comic's (`cm<n>:…`).
    const from = `cp${fence}:`;
    const to = `cm${fence}:`;
    const rename = (id: string): string => (id.startsWith(from) ? to + id.slice(from.length) : id);
    for (const b of out.blocks) {
      b.id = rename(b.id);
      if (b.callout) b.callout.childIds = b.callout.childIds.map(rename);
      blocks.push(b);
    }
    comic.frames![fi] = {
      ...frame,
      blockIds: set.blockIds.map(rename),
      overflowPx: set.overflowPx,
      scale: set.scale,
      ...(set.imageScale !== undefined ? { imageScale: set.imageScale } : {}),
      ...(box ? { styleId: box.id } : {}),
    };
    if (set.overflowPx > 0.5) {
      warnings.push({
        kind: 'comicPanelFrame',
        reason: 'textOverflow',
        panel: src.index,
        overflowMm: Math.round((set.overflowPx / dpi) * 254) / 10,
        sourceStart: src.text!.start + input.bodyOffset,
        sourceEnd: src.text!.end + input.bodyOffset,
        pageIndex: page.index,
      });
    }
  });
  if (warnings.length > 0) setComicLayoutWarnings(comic, [...comicPageLayoutWarnings(comic), ...warnings]);
  return { blocks, laid };
}

/** Where a horizontal (`axis: 'y'`, at height `at`) or vertical line
 *  crosses a convex polygon: the interval it lies in, or undefined. */
function crossing(poly: readonly { x: number; y: number }[], axis: 'x' | 'y', at: number): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const [a0, a1, b0, b1] = axis === 'y' ? [a.y, a.x, b.y, b.x] : [a.x, a.y, b.x, b.y];
    if ((a0 - at) * (b0 - at) > 0 || a0 === b0) {
      if (a0 === at) { lo = Math.min(lo, a1); hi = Math.max(hi, a1); }
      continue;
    }
    const v = a1 + ((at - a0) / (b0 - a0)) * (b1 - a1);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** The box with straight sides inside a convex polygon (a cell cut by
 *  slanted lines), so that text keeps off the slants: the larger of the box
 *  that keeps the whole height and the width every row of it shares (then
 *  the height every column of that width shares), and the box that keeps
 *  the whole width first. Falls back to `box` when both are degenerate. */
export function innerBox(poly: readonly { x: number; y: number }[], box: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const N = 16;
  /** The interval every line across `axis` shares, sampled over [a, b]. */
  const shared = (axis: 'x' | 'y', a: number, b: number, lo: number, hi: number): [number, number] => {
    for (let i = 0; i <= N && hi > lo; i++) {
      const c = crossing(poly, axis, a + 0.001 + ((b - a - 0.002) * i) / N);
      if (!c) continue;
      lo = Math.max(lo, c[0]);
      hi = Math.min(hi, c[1]);
    }
    return [lo, hi];
  };
  const X0 = box.x;
  const X1 = box.x + box.width;
  const Y0 = box.y;
  const Y1 = box.y + box.height;
  // Rows first: the width all rows share, then the height its columns share.
  const [ax0, ax1] = shared('y', Y0, Y1, X0, X1);
  const [ay0, ay1] = ax1 - ax0 > 1 ? shared('x', ax0, ax1, Y0, Y1) : [0, 0];
  // Columns first.
  const [by0, by1] = shared('x', X0, X1, Y0, Y1);
  const [bx0, bx1] = by1 - by0 > 1 ? shared('y', by0, by1, X0, X1) : [0, 0];
  const area = (w: number, h: number) => (w > 1 && h > 1 ? w * h : 0);
  const a = area(ax1 - ax0, ay1 - ay0);
  const b = area(bx1 - bx0, by1 - by0);
  if (a === 0 && b === 0) return { ...box };
  return a >= b ? { x: ax0, y: ay0, width: ax1 - ax0, height: ay1 - ay0 } : { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
}

/** The source warnings of a comic's frames (#885): a `box` that names no
 *  callout style, and text panels whose Markdown is set in the flow
 *  ({@link comicTextPanelFallback}). Offsets as in `source`. */
export function comicFrameSourceWarnings(source: ComicPageSource, calloutStyles: ReadonlySet<string>, supported: boolean): ContentWarning[] {
  const out: ContentWarning[] = [];
  const fallback = comicTextPanelFallback(source, supported);
  for (const panel of source.panels) {
    const box = panel.attrs.box?.trim();
    if (box && !calloutStyles.has(box)) {
      const r = panel.attrSources.box ?? { start: panel.lineStart, end: panel.lineEnd };
      out.push({ kind: 'comicPanelFrame', reason: 'unknownBox', panel: panel.index, style: box, sourceStart: r.start, sourceEnd: r.end });
    }
    if (fallback && isComicTextPanel(panel) && panel.text && panel.text.end > panel.text.start) {
      out.push({ kind: 'comicPanelFrame', reason: fallback, panel: panel.index, sourceStart: panel.lineStart, sourceEnd: panel.lineEnd });
    }
  }
  return out;
}
