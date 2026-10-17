/**
 * Figure labels drawn on their picture (#860, DESIGN §2.6, §3.3).
 *
 * A `:::figure` lists `::label[TEXT]{at style}` lines; the resource holds
 * the anchors (points in fractions of the whole picture, shared by every
 * locale). Each label is set as a small caption (inline Markdown: bold,
 * italic, chips, marks, references, formulas) in its label style, wrapped
 * within its anchor's `width` and, when a word is still too wide, set
 * smaller down to the style's `minScale`. Its box stands at the anchor's
 * point as `align` / `verticalAlign` say (start and end follow the label's
 * own direction), turned by `rotate` degrees about that point.
 *
 * The label's geometry is kept in its own frame (origin at the anchor
 * point) and the point itself relative to the picture's body, so the
 * label moves with its block wherever placement, frames, spreads or the
 * memo put it, and the painters only add the body's corner:
 * {@link figureLabelMatrix}. Once the pages exist the build stamps each
 * label's `rect` (for `sourceAt`) and reports the anchors a figure names
 * wrongly or leaves without a word ({@link figureLabelWarnings}).
 */

import type { InlineSpan } from '../parse/types';
import type { FigureLabel } from '../parse/types';
import type { ColorValue, Dimension, Resource, ResourceAnchor, ResourceType, ResolvedParagraphStyleConfig } from '../types';
import type {
  BoundingBox,
  ContentWarning,
  ResolvedConfig,
  ResolvedResourceBlock,
  VDTBlock,
  VDTDocument,
  VDTFigureLabel,
  VDTFigureLabelLayout,
  VDTLine,
  VDTVerticalText,
} from '../vdt';
import type { MeasurementCache } from '../measure';
import type { ResourceNumberingMap } from '../pipeline/resourceNumbering';
import { buildFontString } from '../measure';
import { flowTextWidth, fontFamilyOf, measureCentralBaseline, withMeasureWritingMode } from '../measure/vertical';
import { dimensionToPx } from '../units';
import { resolveColorValue } from '../defaults/shared';
import { layoutLabelLines } from '../pipeline/resourceLayout';
import { uppercasePreservingLength } from '../pipeline/buildBlockKind';
import { firstStrongDirection } from '../design/bidiText';
import { BREAK_PLACEHOLDER } from '../parse/inlineFormatting';

/** `[a, b, c, d, e, f]`, canvas `transform` order (y down). */
export type LabelMatrix = [number, number, number, number, number, number];

/** The line pitch of a label, in ems, when no paragraph style lends one. */
const LABEL_LINE_HEIGHT = 1.15;
/** Measure of a label with no `width`: as good as unbounded. */
const NO_MEASURE = 1e6;

/** A label style resolved for one label: the type and the plate. */
export interface LabelLook {
  styleId?: string;
  fontFamily: string;
  fontPx: number;
  weight: number;
  boldWeight: number;
  italic: boolean;
  color: string;
  uppercase: boolean;
  /** Ems. */
  letterSpacing: number;
  lineHeight: number;
  halo?: { color: string; widthPx: number };
  background?: string;
  paddingPx: number;
  minScale: number;
  /** Set in vertical writing (the label style's; an anchor's wins). */
  vertical?: boolean;
}

const hexOf = (value: ColorValue | undefined, resolved: ResolvedConfig, fallback: ColorValue): string =>
  resolveColorValue(value, resolved.colorPalette, fallback).hex;

const px = (dim: Dimension | undefined, dpi: number, em: number): number | undefined => {
  if (!dim || typeof dim.value !== 'number' || !Number.isFinite(dim.value)) return undefined;
  try {
    return dimensionToPx(dim, dpi, em);
  } catch {
    return undefined;
  }
};

/**
 * The look of a label set in style `styleId` (the label's own `style`,
 * else its anchor's): the body text's type, under the paragraph style the
 * label style borrows (`paragraphStyle`), under the label style's own
 * fields. An unknown or absent style is the body text's type.
 */
export function resolveLabelLook(styleId: string | undefined, resolved: ResolvedConfig): LabelLook {
  const dpi = resolved.page.dpi;
  const body = resolved.bodyText;
  const style = styleId !== undefined ? resolved.labelStyles?.find((s) => s.id === styleId) : undefined;
  const para: ResolvedParagraphStyleConfig | undefined = style?.paragraphStyle
    ? resolved.paragraphStyles.find((p) => p.id === style.paragraphStyle)
    : undefined;
  const bodyPx = px(body.fontSize, dpi, 16) ?? 16;
  const paraPx = para ? px(para.fontSize, dpi, bodyPx) ?? bodyPx : bodyPx;
  const fontPx = px(style?.fontSize, dpi, paraPx) ?? paraPx;
  const lineHeight = para
    ? Math.max(0.8, (px(para.lineHeight, dpi, paraPx) ?? paraPx * LABEL_LINE_HEIGHT) / paraPx)
    : LABEL_LINE_HEIGHT;
  const haloWidth = style?.halo ? px(style.halo.width, dpi, fontPx) : undefined;
  return {
    ...(style ? { styleId: style.id } : {}),
    fontFamily: style?.fontFamily ?? para?.fontFamily ?? body.fontFamily,
    fontPx,
    weight: style?.fontWeight ?? para?.fontWeight ?? body.fontWeight,
    boldWeight: Math.max(para?.boldFontWeight ?? body.boldFontWeight, style?.fontWeight ?? 0),
    // A borrowed paragraph style's slant and capitals hold unless the
    // label style says otherwise: 'italic' / 'uppercase' turn them on,
    // 'normal' / 'none' written turn them off (#955).
    italic: style?.fontStyle !== undefined ? style.fontStyle === 'italic' : para?.italic === true,
    color: hexOf(style?.color ?? para?.color, resolved, body.color),
    uppercase: style?.textTransform !== undefined ? style.textTransform === 'uppercase' : para?.textTransform === 'uppercase',
    letterSpacing: typeof style?.letterSpacing === 'number' && Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0,
    lineHeight,
    ...(style?.halo && haloWidth !== undefined && haloWidth > 0
      ? { halo: { color: hexOf(style.halo.color, resolved, { hex: '#ffffff', model: 'hex' }), widthPx: haloWidth } }
      : {}),
    ...(style?.background ? { background: hexOf(style.background, resolved, { hex: '#ffffff', model: 'hex' }) } : {}),
    paddingPx: Math.max(0, px(style?.padding, dpi, fontPx) ?? 0),
    minScale: style ? Math.min(1, Math.max(0.1, style.minScale)) : 0.85,
    ...(style?.writingMode === 'vertical-rl' ? { vertical: true } : {}),
  };
}

/** Where a label stands on the picture: its anchor (looked up on the
 *  resource) or its percentages, with the anchor's label fields. */
export interface LabelPlace {
  /** Fractions of the whole picture. */
  x: number;
  y: number;
  anchor?: ResourceAnchor;
}

/** The place of `label` on `resource`; undefined when it names an anchor
 *  the resource lacks. */
export function labelPlace(label: Pick<VDTFigureLabel, 'at'>, resource: Pick<Resource, 'anchors'>): LabelPlace | undefined {
  if ('anchor' in label.at) {
    const id = label.at.anchor;
    const anchor = resource.anchors?.find((a) => a.id === id);
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return undefined;
    return { x: anchor.x, y: anchor.y, anchor };
  }
  const { x, y } = label.at;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/** A point of the whole picture (fractions) in px from the top-left of the
 *  body as drawn: through its crop (`bodySource`) and its size. */
export function pictureToBody(rb: Pick<ResolvedResourceBlock, 'bodyRect' | 'bodySource'>, fx: number, fy: number): { x: number; y: number } {
  const src = rb.bodySource ?? { x: 0, y: 0, width: 1, height: 1 };
  const w = src.width > 0 ? src.width : 1;
  const h = src.height > 0 ? src.height : 1;
  return { x: ((fx - src.x) / w) * rb.bodyRect.width, y: ((fy - src.y) / h) * rb.bodyRect.height };
}

/** The width of the whole picture in px, as its body draws it. */
const pictureWidthPx = (rb: Pick<ResolvedResourceBlock, 'bodyRect' | 'bodySource'>): number =>
  rb.bodyRect.width / (rb.bodySource && rb.bodySource.width > 0 ? rb.bodySource.width : 1);

/** The height of the whole picture in px, as its body draws it. */
const pictureHeightPx = (rb: Pick<ResolvedResourceBlock, 'bodyRect' | 'bodySource'>): number =>
  rb.bodyRect.height / (rb.bodySource && rb.bodySource.height > 0 ? rb.bodySource.height : 1);

/** What laying the labels out needs besides the block. */
export interface FigureLabelContext {
  resolved: ResolvedConfig;
  resourceNumbering?: ResourceNumberingMap;
  resourceTypes?: ResourceType[];
  resources?: Resource[];
  cache?: MeasurementCache;
}

const upperSpans = (spans: readonly InlineSpan[]): InlineSpan[] =>
  spans.map((s) => (s.text ? { ...s, text: uppercasePreservingLength(s.text) } : s)).map((s) =>
    s.chip ? { ...s, chip: { ...s.chip, spans: s.chip.spans.map((c) => ({ ...c, text: uppercasePreservingLength(c.text) })) } } : s);

const moveLine = (line: VDTLine, dx: number, dy: number): VDTLine => ({
  ...line,
  bbox: { x: line.bbox.x + dx, y: line.bbox.y + dy, width: line.bbox.width, height: line.bbox.height },
  baseline: line.baseline + dy,
  ...(line.measure ? { measure: { ...line.measure, x: line.measure.x + dx } } : {}),
});

/** A label's spans with each `\\` that ends a word made a forced line
 *  break, as in a caption: two characters for two (the break and a space
 *  the next line drops), so the source map holds. */
function withForcedBreaks(spans: InlineSpan[]): InlineSpan[] {
  return spans.map((s) => (s.text.includes('\\\\') ? { ...s, text: s.text.replace(/\\\\(?=\s|$)/g, `${BREAK_PLACEHOLDER} `) } : s));
}

/** The plain text a label's spans read as (a chip's words included). */
function spanText(spans: readonly InlineSpan[]): string {
  return spans.map((s) => (s.chip ? s.chip.spans.map((c) => c.text).join('') : s.text)).join('');
}

const CJK_CHAR = '\\u2E80-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uFF00-\\uFFEF';
const PIECES = new RegExp(`[${CJK_CHAR}]|[^${CJK_CHAR}\\s]+`, 'gu');

/** The pieces of `text` a line cannot be cut inside: the words between
 *  spaces, and each Chinese, Japanese or Korean character on its own. */
function unbreakablePieces(text: string): string[] {
  return text.match(PIECES) ?? [];
}

/**
 * Lay out one label: its lines in its look, wrapped within `widthPx` (none:
 * one line per forced break), set smaller (down to `minScale`) while a
 * line is wider, then placed about the anchor point by `align` and
 * `verticalAlign`.
 */
export function layOutLabel(
  spans: readonly InlineSpan[],
  look: LabelLook,
  place: { x: number; y: number; widthPx?: number; align?: ResourceAnchor['align']; verticalAlign?: ResourceAnchor['verticalAlign']; rotate?: number; vertical?: boolean },
  ctx: FigureLabelContext,
): VDTFigureLabelLayout | undefined {
  const text = withForcedBreaks(look.uppercase ? upperSpans(spans) : [...spans]);
  const plain = spanText(text);
  if (plain.trim().length === 0) return undefined;
  // Vertical writing (#902): measured as a vertical page's flow is, in the
  // label's own frame, which the matrix then turns a quarter turn
  // clockwise; the text reads top to bottom in columns from right to left.
  const vertical = place.vertical ?? look.vertical ?? false;
  const region = ctx.resolved.cjk.region;
  const inMode = <T,>(fn: () => T): T => (vertical ? withMeasureWritingMode('vertical-rl', fn, region) : fn());
  const rtl = !vertical && firstStrongDirection(plain) === 'rtl';
  const widthPx = place.widthPx !== undefined && place.widthPx > 0 ? place.widthPx : undefined;
  const fontsAt = (sizePx: number): [string, string, string, string] => {
    const w = look.weight === 400 ? 'normal' : String(look.weight);
    const b = String(look.boldWeight);
    const slant = look.italic ? 'italic' : 'normal';
    const flip = look.italic ? 'normal' : 'italic';
    return [
      buildFontString(look.fontFamily, sizePx, w, slant),
      buildFontString(look.fontFamily, sizePx, b, slant),
      buildFontString(look.fontFamily, sizePx, w, flip),
      buildFontString(look.fontFamily, sizePx, b, flip),
    ];
  };
  const measure = (scale: number) => inMode(() => {
    const sizePx = look.fontPx * scale;
    const fonts = fontsAt(sizePx);
    const lines = layoutLabelLines({
      spans: text,
      fonts,
      fontPx: sizePx,
      lineHeightPx: sizePx * look.lineHeight,
      maxWidthPx: widthPx ?? NO_MEASURE,
      ...(look.letterSpacing !== 0 ? { letterSpacingPx: look.letterSpacing * sizePx } : {}),
      direction: rtl ? 'rtl' : 'ltr',
      resolved: ctx.resolved,
      ...(ctx.resourceNumbering ? { resourceNumbering: ctx.resourceNumbering } : {}),
      ...(ctx.resourceTypes ? { resourceTypes: ctx.resourceTypes } : {}),
      ...(ctx.resources ? { resources: ctx.resources } : {}),
      ...(ctx.cache ? { cache: ctx.cache } : {}),
    });
    const widest = lines.reduce((m, l) => Math.max(m, l.bbox.width), 0);
    // A word wider than the measure is divided by the measurer: the label
    // does not fit.
    const cut = widthPx !== undefined && (widest > widthPx + 0.01 || lines.some((l) => l.hyphenated && !l.hardHyphen));
    return { lines, fonts, widest, sizePx, cut };
  });
  let scale = 1;
  if (widthPx !== undefined) {
    // The widest word sets the first guess.
    const font = fontsAt(look.fontPx)[0];
    const tracking = look.letterSpacing * look.fontPx;
    const word = inMode(() => unbreakablePieces(plain).reduce((m, w) => Math.max(m, flowTextWidth(w, font) + tracking * [...w].length), 0));
    if (word > widthPx) scale = Math.max(look.minScale, (widthPx / word) * 0.999);
  }
  let set = measure(scale);
  // Still cut or wider than the measure: a little smaller, down to the
  // style's floor.
  for (let round = 0; round < 6 && set.cut && scale > look.minScale + 1e-6; round++) {
    scale = Math.max(look.minScale, scale * Math.min(0.97, widthPx! / Math.max(set.widest, widthPx! + 1e-6)));
    set = measure(scale);
  }
  if (set.lines.length === 0) return undefined;
  const boxW = set.widest;
  const pitch = set.sizePx * look.lineHeight;
  const boxH = Math.max(pitch * set.lines.length, set.lines.reduce((m, l) => Math.max(m, l.bbox.y + l.bbox.height), 0));
  const align = place.align ?? 'center';
  // `start` is the label's own start: its left edge, its right edge right
  // to left.
  const side = align === 'center' ? 'center' : (align === 'start') !== rtl ? 'left' : 'right';
  const left = side === 'center' ? -boxW / 2 : side === 'left' ? 0 : -boxW;
  const vAlign = place.verticalAlign ?? 'middle';
  const top = vAlign === 'top' ? 0 : vAlign === 'bottom' ? -boxH : -boxH / 2;
  const lines = set.lines.map((line) => {
    const slack = Math.max(0, boxW - line.bbox.width);
    const dx = side === 'center' ? slack / 2 : side === 'left' ? 0 : slack;
    return moveLine(line, left + dx - line.bbox.x, top);
  });
  const box: BoundingBox = { x: left, y: top, width: boxW, height: boxH };
  const pad = look.paddingPx;
  // A vertical label's frame is the flow frame of a vertical page: turned
  // a quarter turn clockwise on the picture, and further by `rotate`.
  const turn = (place.rotate !== undefined && Number.isFinite(place.rotate) ? place.rotate : 0) + (vertical ? 90 : 0);
  const rotate = Math.abs(turn % 360) > 1e-9 ? turn % 360 : undefined;
  const verticalText: VDTVerticalText | undefined = vertical ? verticalTextOf(set.lines, set.fonts, region, ctx) : undefined;
  return {
    x: place.x,
    y: place.y,
    ...(rotate !== undefined ? { rotate } : {}),
    lines,
    box,
    fontString: set.fonts[0],
    boldFontString: set.fonts[1],
    italicFontString: set.fonts[2],
    boldItalicFontString: set.fonts[3],
    color: look.color,
    ...(look.halo ? { halo: { color: look.halo.color, widthPx: look.halo.widthPx * scale } } : {}),
    ...(look.background ? { background: { color: look.background, rect: { x: left - pad, y: top - pad, width: boxW + 2 * pad, height: boxH + 2 * pad } } } : {}),
    ...(scale < 1 - 1e-6 ? { scale } : {}),
    ...(set.cut ? { overflow: true as const } : {}),
    ...(look.styleId !== undefined ? { styleId: look.styleId } : {}),
    ...(rtl ? { direction: 'rtl' as const } : {}),
    ...(verticalText ? { vertical: verticalText } : {}),
  };
}

/** How a vertical label is painted: the document's region and upright
 *  digits, and the central axis of each family it is set in. */
function verticalTextOf(lines: readonly VDTLine[], fonts: readonly string[], region: VDTVerticalText['region'], ctx: FigureLabelContext): VDTVerticalText {
  const centralBaselines: Record<string, number> = {};
  const add = (font: string | undefined): void => {
    if (!font) return;
    const family = fontFamilyOf(font);
    if (family && !(family in centralBaselines)) centralBaselines[family] = measureCentralBaseline(family);
  };
  for (const font of fonts) add(font);
  for (const line of lines) {
    for (const seg of line.segments ?? []) {
      add(seg.fontString);
      for (const run of seg.chip?.runs ?? []) add(run.fontString);
    }
  }
  return { region, uprightDigits: ctx.resolved.cjk.uprightDigits, centralBaselines };
}

/**
 * The labels of a figure laid out on its picture: `labels` (the VDT's,
 * `figureLabels`) with the `layout` of each one that can be drawn, read
 * from `parsed` (the parser's, the same order) for its inline Markdown.
 * A table, a video or a picture with no body draws none; a label whose
 * anchor is unknown is left without a layout.
 */
export function layOutFigureLabels(
  labels: readonly VDTFigureLabel[],
  parsed: readonly Pick<FigureLabel, 'spans'>[] | undefined,
  rb: ResolvedResourceBlock,
  ctx: FigureLabelContext,
): VDTFigureLabel[] {
  if (rb.kind !== 'bitmap' && rb.kind !== 'svg') return [...labels];
  if (!(rb.bodyRect.width > 0) || !(rb.bodyRect.height > 0)) return [...labels];
  const pictureW = pictureWidthPx(rb);
  const pictureH = pictureHeightPx(rb);
  return labels.map((label, i) => {
    const place = labelPlace(label, rb.resource);
    if (!place) return label;
    const anchor = place.anchor;
    const at = pictureToBody(rb, place.x, place.y);
    const look = resolveLabelLook(label.style ?? anchor?.style, ctx.resolved);
    const spans = parsed?.[i]?.spans ?? [{ text: label.text, bold: false, italic: false }];
    // The anchor's writing mode wins over the style's; a vertical label's
    // measure is a share of the picture's height.
    const vertical = anchor?.writingMode !== undefined ? anchor.writingMode === 'vertical-rl' : look.vertical === true;
    const layout = layOutLabel(spans, look, {
      x: at.x,
      y: at.y,
      vertical,
      ...(anchor?.width !== undefined && anchor.width > 0 ? { widthPx: anchor.width * (vertical ? pictureH : pictureW) } : {}),
      ...(anchor?.align ? { align: anchor.align } : {}),
      ...(anchor?.verticalAlign ? { verticalAlign: anchor.verticalAlign } : {}),
      ...(anchor?.rotate !== undefined ? { rotate: anchor.rotate } : {}),
    }, ctx);
    return layout ? { ...label, layout } : label;
  });
}

// ---------------------------------------------------------------------------
// Painting and hit-testing
// ---------------------------------------------------------------------------

/** The matrix that puts a label's frame on the block's frame, the body's
 *  top-left corner at (`bodyX`, `bodyY`): `translate(body + point) ·
 *  rotate(rotate)`. */
export function figureLabelMatrix(layout: Pick<VDTFigureLabelLayout, 'x' | 'y' | 'rotate'>, bodyX: number, bodyY: number): LabelMatrix {
  const t = ((layout.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  // A quarter turn lands exactly (no 1e-17 shear).
  const c = Math.abs(cos) < 1e-12 ? 0 : cos;
  const s = Math.abs(sin) < 1e-12 ? 0 : sin;
  return [c, s, -s, c, bodyX + layout.x, bodyY + layout.y];
}

/** What a label paints in its own frame: its background, else its lines'
 *  box. */
export function figureLabelExtent(layout: VDTFigureLabelLayout): BoundingBox {
  return layout.background?.rect ?? layout.box;
}

const apply = (m: LabelMatrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The upright box a label covers in the block's frame. */
export function figureLabelBounds(layout: VDTFigureLabelLayout, bodyX: number, bodyY: number): BoundingBox {
  const m = figureLabelMatrix(layout, bodyX, bodyY);
  const r = figureLabelExtent(layout);
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.width, r.y), apply(m, r.x, r.y + r.height), apply(m, r.x + r.width, r.y + r.height)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The point `(x, y)` of the block's frame in a label's own frame. */
export function pointInLabel(layout: VDTFigureLabelLayout, bodyX: number, bodyY: number, x: number, y: number): { x: number; y: number } {
  const m = figureLabelMatrix(layout, bodyX, bodyY);
  const dx = x - m[4];
  const dy = y - m[5];
  // The inverse of a rotation is its transpose.
  return { x: m[0] * dx + m[1] * dy, y: m[2] * dx + m[3] * dy };
}

/** The top-left corner of a resource block's body in its own frame, and
 *  the quarter turn that puts that frame on the block's (a rotated
 *  block). */
function bodyFrame(block: Pick<VDTBlock, 'bbox' | 'resourceBlock'>): { bx: number; by: number; turn?: LabelMatrix } {
  const rb = block.resourceBlock!;
  const rot = rb.rotation;
  if (!rot) return { bx: block.bbox.x + rb.bodyRect.x, by: block.bbox.y + rb.bodyRect.y };
  const turn: LabelMatrix = rot.direction === 'ccw' ? [0, -1, 1, 0, rot.originX, rot.originY] : [0, 1, -1, 0, rot.originX, rot.originY];
  return { bx: rb.bodyRect.x, by: rb.bodyRect.y, turn };
}

/**
 * Stamp `rect` on every drawn label of the document (#860): the upright
 * box it covers in its block's frame, through a quarter-turned block's
 * turn. A label not drawn loses any `rect` it had.
 */
export function stampFigureLabelRects(doc: VDTDocument): void {
  const seen = new Set<VDTBlock>();
  const visit = (block: VDTBlock): void => {
    if (seen.has(block)) return;
    seen.add(block);
    const labels = block.resourceBlock?.labels;
    if (!labels || labels.length === 0) return;
    const { bx, by, turn } = bodyFrame(block);
    for (const label of labels) {
      if (!label.layout) {
        delete label.rect;
        continue;
      }
      let r = figureLabelBounds(label.layout, bx, by);
      if (turn) {
        const pts = [apply(turn, r.x, r.y), apply(turn, r.x + r.width, r.y), apply(turn, r.x, r.y + r.height), apply(turn, r.x + r.width, r.y + r.height)];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        r = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
      }
      label.rect = r;
    }
  };
  for (const block of doc.blocks) visit(block);
  for (const page of doc.pages) {
    for (const col of page.columns) for (const block of col.blocks) visit(block);
    for (const block of page.floats ?? []) visit(block);
    // The half of a spread frame painted on the facing page (#861) is a
    // copy of its blocks moved onto that page: its labels get their boxes
    // there, so the facing page answers for the labels it shows.
    for (const frame of page.composed?.frames ?? []) for (const block of frame.facingBlocks ?? []) visit(block);
  }
}

/**
 * The glyph of a drawn label under the point `(x, y)` of its block's
 * frame: the index into `label.text`'s source map, or undefined off its
 * lines. Lines are read from their plain ranges; a label whose lines lack
 * them spreads its text over its lines in order.
 */
export function labelGlyphAt(label: VDTFigureLabel, block: Pick<VDTBlock, 'bbox' | 'resourceBlock'>, x: number, y: number): number | undefined {
  const layout = label.layout;
  if (!layout || layout.lines.length === 0) return undefined;
  const { bx, by, turn } = bodyFrame(block);
  let px = x;
  let py = y;
  if (turn) {
    // Into the block's upright frame: the transpose of the quarter turn.
    const dx = x - turn[4];
    const dy = y - turn[5];
    px = turn[0] * dx + turn[1] * dy;
    py = turn[2] * dx + turn[3] * dy;
  }
  const p = pointInLabel(layout, bx, by, px, py);
  let li = 0;
  let best = Infinity;
  layout.lines.forEach((line, i) => {
    const d = p.y < line.bbox.y ? line.bbox.y - p.y : p.y > line.bbox.y + line.bbox.height ? p.y - line.bbox.y - line.bbox.height : 0;
    if (d < best) { best = d; li = i; }
  });
  const line = layout.lines[li]!;
  const n = label.text.length;
  if (n === 0) return undefined;
  const start = line.plainStart ?? Math.floor((li * n) / layout.lines.length);
  const end = line.plainEnd ?? Math.floor(((li + 1) * n) / layout.lines.length);
  const len = Math.max(1, end - start);
  let frac = line.bbox.width > 0 ? (p.x - line.bbox.x) / line.bbox.width : 0;
  frac = Math.max(0, Math.min(0.9999, frac));
  if (layout.direction === 'rtl') frac = 0.9999 - frac;
  return Math.max(0, Math.min(n - 1, start + Math.floor(frac * len)));
}

// ---------------------------------------------------------------------------
// Right-to-left pages
// ---------------------------------------------------------------------------

/** Layouts already turned for a mirrored page. */
const mirrored = new WeakSet<VDTFigureLabelLayout>();

/**
 * A label layout for the flow of a mirrored page (a right-to-left book):
 * its point, its turn and its lines reflected about the body's vertical
 * axis, so that the page's reflection puts it back where the picture shows
 * it, reading as written. `bodyWidth` is the body's width; `orient` turns
 * a line's run order for the frame as the build does for captions.
 */
export function mirrorLabelLayout(layout: VDTFigureLabelLayout, bodyWidth: number, orient: (line: VDTLine) => VDTLine): VDTFigureLabelLayout {
  if (mirrored.has(layout)) return layout;
  const flipBox = (r: BoundingBox): BoundingBox => ({ ...r, x: -(r.x + r.width) });
  // The lines of a vertical label keep the order they were set in: its
  // cells are painted from the frame turned back (`unmirrorLabelLayout`),
  // where the text runs down the column as on any page (#955).
  const out: VDTFigureLabelLayout = {
    ...layout,
    x: bodyWidth - layout.x,
    ...(layout.rotate !== undefined ? { rotate: -layout.rotate } : {}),
    lines: layout.lines.map((line) => {
      const o = layout.vertical ? line : orient(line);
      return {
        ...o,
        bbox: { ...o.bbox, x: -(o.bbox.x + o.bbox.width) },
        ...(o.measure ? { measure: { ...o.measure, x: -(o.measure.x + o.measure.width) } } : {}),
      };
    }),
    box: flipBox(layout.box),
    ...(layout.background ? { background: { ...layout.background, rect: flipBox(layout.background.rect) } } : {}),
    ...(layout.vertical ? { mirrored: true as const } : {}),
  };
  mirrored.add(out);
  return out;
}

/**
 * The layout of a vertical label (`mirrored`) as it was set, before
 * {@link mirrorLabelLayout} reflected it for the flow of a mirrored page:
 * the geometry reflected back about the body's axis. The painters of such
 * a flow reflect their frame back about the body, so this layout lands on
 * the sheet where the label's anchor says, its cells running down the
 * column and standing upright, whatever the page's direction.
 */
export function unmirrorLabelLayout(layout: VDTFigureLabelLayout, bodyWidth: number): VDTFigureLabelLayout {
  if (!layout.mirrored) return layout;
  const flipBox = (r: BoundingBox): BoundingBox => ({ ...r, x: -(r.x + r.width) });
  const { mirrored: _mirrored, ...rest } = layout;
  void _mirrored;
  return {
    ...rest,
    x: bodyWidth - layout.x,
    ...(layout.rotate !== undefined ? { rotate: -layout.rotate } : {}),
    lines: layout.lines.map((line) => ({
      ...line,
      bbox: { ...line.bbox, x: -(line.bbox.x + line.bbox.width) },
      ...(line.measure ? { measure: { ...line.measure, x: -(line.measure.x + line.measure.width) } } : {}),
    })),
    box: flipBox(layout.box),
    ...(layout.background ? { background: { ...layout.background, rect: flipBox(layout.background.rect) } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The labels of a figure that are not drawn as text: what its picture's
 *  alternative text still names (`altWithLabels`). */
export function undrawnLabels(labels: readonly VDTFigureLabel[] | undefined): VDTFigureLabel[] | undefined {
  if (!labels) return undefined;
  const out = labels.filter((l) => !l.layout);
  return out.length > 0 ? out : undefined;
}

/** A drawn label's words as read, its lines joined by a space. */
export function figureLabelReading(label: VDTFigureLabel): string {
  const lines = label.layout?.lines;
  const text = lines && lines.length > 0 ? lines.map((l) => l.text).join(' ') : label.text;
  return text.replace(/[￼]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

type Pt = [number, number];

/** The share of a line box, at its top and at its foot, that holds no ink. */
const INK_MARGIN = 0.12;

/** The shapes a label covers in the body's frame, as convex quadrilaterals:
 *  its plate when it has one, else the box of each of its lines (a short
 *  line beside a long one leaves its side free). */
function labelShapes(layout: VDTFigureLabelLayout): Pt[][] {
  const m = figureLabelMatrix(layout, 0, 0);
  const quad = (r: BoundingBox): Pt[] => [apply(m, r.x, r.y), apply(m, r.x + r.width, r.y), apply(m, r.x + r.width, r.y + r.height), apply(m, r.x, r.y + r.height)];
  if (layout.background) return [quad(layout.background.rect)];
  // A line's box is taller than its ink (it is the line pitch): the band
  // the letters stand in is its middle, so two names set one under the
  // other at a tighter leading than the label's own do not meet.
  return layout.lines
    .filter((l) => l.bbox.width > 0 && l.bbox.height > 0)
    .map((l) => quad({ x: l.bbox.x, y: l.bbox.y + l.bbox.height * INK_MARGIN, width: l.bbox.width, height: l.bbox.height * (1 - 2 * INK_MARGIN) }));
}

/** How far two convex polygons run into each other: the shortest push that
 *  frees them (separating axis test), 0 when they do not meet. */
export function polygonPenetration(a: readonly Pt[], b: readonly Pt[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      let nx = q[1] - p[1];
      let ny = p[0] - q[0];
      const len = Math.hypot(nx, ny);
      if (len < 1e-12) continue;
      nx /= len;
      ny /= len;
      const proj = (pts: readonly Pt[]): [number, number] => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const pt of pts) {
          const d = pt[0] * nx + pt[1] * ny;
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        }
        return [lo, hi];
      };
      const [aLo, aHi] = proj(a);
      const [bLo, bHi] = proj(b);
      const overlap = Math.min(aHi, bHi) - Math.max(aLo, bLo);
      if (overlap <= 0) return 0;
      if (overlap < depth) depth = overlap;
    }
  }
  return Number.isFinite(depth) ? depth : 0;
}

/** The share of a line's height two labels may run into each other before
 *  they count as meeting: line boxes are taller than the ink. */
const OVERLAP_TOLERANCE = 0.12;

/** The pairs of labels whose lines meet: for each label (by index) the
 *  indices of the earlier labels it meets. */
export function overlappingLabels(labels: readonly Pick<VDTFigureLabel, 'layout'>[]): Map<number, number[]> {
  const shapes = labels.map((l) => (l.layout ? labelShapes(l.layout) : []));
  const heights = labels.map((l) => l.layout?.lines.reduce((m, line) => Math.min(m, line.bbox.height), Infinity) ?? Infinity);
  const bounds = shapes.map((quads) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const q of quads) for (const [x, y] of q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1] as const;
  });
  const out = new Map<number, number[]>();
  for (let j = 1; j < labels.length; j++) {
    if (shapes[j]!.length === 0) continue;
    for (let i = 0; i < j; i++) {
      if (shapes[i]!.length === 0) continue;
      const a = bounds[i]!;
      const b = bounds[j]!;
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      const tolerance = OVERLAP_TOLERANCE * Math.min(heights[i]!, heights[j]!);
      const meet = shapes[i]!.some((p) => shapes[j]!.some((q) => polygonPenetration(p, q) > Math.max(tolerance, 0.25)));
      if (meet) {
        const list = out.get(j);
        if (list) list.push(i);
        else out.set(j, [i]);
      }
    }
  }
  return out;
}

const shortText = (label: Pick<VDTFigureLabel, 'text'>): string => label.text.replace(/\s+/g, ' ').trim().slice(0, 40);
const anchorOf = (label: Pick<VDTFigureLabel, 'at'>): string | undefined => ('anchor' in label.at ? label.at.anchor : undefined);

/**
 * The anchors the figures of `doc` name wrongly (`labelAnchorUnknown`, at
 * the label's text) or leave without a word (`anchorUnlabelled`, a note
 * at the figure: an anchor that names a label style and that no label of
 * the figure stands at), the labels that do not fit their measure
 * (`labelOverflow`) and those whose boxes meet (`labelOverlap`, #902),
 * each on the page its figure landed on.
 */
export function figureLabelWarnings(doc: VDTDocument, figureSource: (block: VDTBlock) => { start: number; end: number } | undefined): ContentWarning[] {
  const out: ContentWarning[] = [];
  const locale = doc.config?.locale;
  const seen = new Set<string>();
  const visit = (block: VDTBlock): void => {
    const rb = block.resourceBlock;
    const labels = rb?.labels;
    if (!rb || !labels || labels.length === 0 || block.pageIndex < 0) return;
    // A figure laid out more than once (the slices of a table, a picture
    // met twice): once.
    const key = `${rb.resource.id}@${labels[0]!.sourceStart}`;
    if (seen.has(key)) return;
    seen.add(key);
    const anchors = rb.resource.anchors ?? [];
    const known = anchors.map((a) => a.id);
    const used = new Set<string>();
    for (const label of labels) {
      if (!('anchor' in label.at)) continue;
      const id = label.at.anchor;
      used.add(id);
      if (known.includes(id)) continue;
      out.push({
        kind: 'labelAnchorUnknown',
        resourceId: rb.resource.id,
        anchor: id,
        known,
        ...(locale ? { locale } : {}),
        ...(label.id ? { labelId: label.id } : {}),
        sourceStart: label.sourceStart,
        sourceEnd: label.sourceEnd,
        pageIndex: block.pageIndex,
      });
    }
    // Labels that do not fit their measure even at the smallest scale
    // their style allows (#902).
    for (const label of labels) {
      const layout = label.layout;
      if (!layout?.overflow) continue;
      const anchor = anchorOf(label);
      const width = anchor !== undefined ? anchors.find((a) => a.id === anchor)?.width : undefined;
      out.push({
        kind: 'labelOverflow',
        resourceId: rb.resource.id,
        text: shortText(label),
        ...(anchor !== undefined ? { anchor } : {}),
        widthPct: width !== undefined ? Math.round(width * 1000) / 10 : 0,
        scale: Math.round((layout.scale ?? 1) * 1000) / 1000,
        ...(locale ? { locale } : {}),
        ...(label.id ? { labelId: label.id } : {}),
        sourceStart: label.sourceStart,
        sourceEnd: label.sourceEnd,
        pageIndex: block.pageIndex,
      });
    }
    // Labels whose boxes meet: reported once, on the later of the two in
    // the order written (#902).
    for (const [j, earlier] of overlappingLabels(labels)) {
      const label = labels[j]!;
      const other = labels[earlier[0]!]!;
      const anchor = anchorOf(label);
      const otherAnchor = anchorOf(other);
      out.push({
        kind: 'labelOverlap',
        resourceId: rb.resource.id,
        text: shortText(label),
        ...(anchor !== undefined ? { anchor } : {}),
        with: shortText(other),
        ...(otherAnchor !== undefined ? { withAnchor: otherAnchor } : {}),
        count: earlier.length,
        ...(locale ? { locale } : {}),
        ...(label.id ? { labelId: label.id } : {}),
        sourceStart: label.sourceStart,
        sourceEnd: label.sourceEnd,
        pageIndex: block.pageIndex,
      });
    }
    const where = figureSource(block);
    for (const a of anchors) {
      if (!a.style || used.has(a.id)) continue;
      out.push({
        kind: 'anchorUnlabelled',
        resourceId: rb.resource.id,
        anchor: a.id,
        style: a.style,
        ...(locale ? { locale } : {}),
        ...(where ? { sourceStart: where.start, sourceEnd: where.end } : {}),
        pageIndex: block.pageIndex,
      });
    }
  };
  for (const page of doc.pages) {
    for (const col of page.columns) for (const block of col.blocks) visit(block);
    for (const block of page.floats ?? []) visit(block);
  }
  for (const block of doc.blocks) visit(block);
  return out;
}
