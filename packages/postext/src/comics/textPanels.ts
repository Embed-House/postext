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
    const r = panel.bbox;
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
