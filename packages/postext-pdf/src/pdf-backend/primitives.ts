import {
  rgb,
  cmyk,
  grayscale,
  BlendMode,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  concatTransformationMatrix,
  type PDFPage,
  type PDFFont,
  type Color,
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  beginText,
  endText,
  setFillingColor,
  setFontAndSize,
  showText,
  setTextMatrix,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  stroke,
  fill,
  setStrokingColor,
  setLineWidth,
  setTextRenderingMode,
  TextRenderingMode,
  setGraphicsState,
  setCharacterSpacing,
} from 'pdf-lib';
import { colorAlpha, hexToRgb, rgbToCmyk, rgbToGrayscale } from '../colors';
import { isPrintMode, modeKey, overPaper, type ColorMode } from '../print/colorMode';
import { graphemesOf, joinsLetters, scriptContextUntracked, type CjkRegion, type ForcedOrientation, type RoundedOutline, type ScriptContext, type VDTChip } from 'postext';
import type { PageTagger } from './tagging';
import { fallbackPieces, isDefaultIgnorable, isSpaceCharacter, type FallbackFace, type TextPiece } from './fallbackSpaces';
import { fileRuns, inRun, noteMissingGlyphs, wordRuns, type FileRun } from '../faceFiles';
import { needsComplexShaping } from '../complexShaping';
import { shapesAsCanvas, shapingKey, withShapingScript } from '../shapingLanguage';

export interface PageCtx {
  page: PDFPage;
  /** Set while a figure label's halo is painted (#860): every text drawn
   *  without an outline of its own takes this one. */
  textOutline?: TextOutline;
  pageHeightPt: number;
  scale: number;
  /** The output colour: a PDF colour space, or an ICC print mode. */
  colorSpace: ColorMode;
  /** Marked-content state of an accessible (tagged) render; absent when the
   *  document is not tagged. Renderers route each drawing call to a
   *  structure element or flag it as an artifact through it. */
  tags?: PageTagger;
  /** Set while a frame is pushed ({@link pushFrame}: a vertical page's
   *  flow, a rotated resource block, a vertical design text): maps a rect
   *  `[x1, y1, x2, y2]` in points of the current frame — what the `*Px`
   *  helpers compute — to page user space, for the annotation and
   *  structure rects that live outside the content stream. */
  mapRectPt?: (rect: [number, number, number, number]) => [number, number, number, number];
  /** The frames pushed with {@link pushFrame}, outermost first, each
   *  composed with the ones outside it: a point of the innermost frame
   *  lands on the page through the last one. */
  frames?: PdfMatrix[];
  /** Told of every image the page paints as a placeholder (no bytes, or
   *  bytes that did not decode), with its resource when the painter knows
   *  it. Set when the host asked for render warnings. */
  onMissingImage?: (fileId: string, resourceId?: string) => void;
  /** Set while a vertical page's flow (or a vertical design text) paints:
   *  text is set down the column (see `verticalText.ts`). */
  vertical?: VerticalPaint;
  /** The character spacing (px) set with {@link setTrackingPx}: the
   *  vertical painter reads it, since it sets its own spacing inside its
   *  text objects. */
  trackingPx?: number;
  /** How many spans opened with {@link beginActualTextSpan} are open:
   *  what is painted inside one is read as the span's text, and no glyph
   *  takes a span of its own there (#755; a reader that meets an
   *  `/ActualText` inside another, Poppler, drops the outer one). */
  readSpans?: number;
  /** Set while a right-to-left page's flow paints through its mirror
   *  (`VDTMirroredFlowFrame`, {@link mirrorMatrix}): every text object
   *  and picture is turned back about its own box, so it reads as written
   *  where the mirrored layout put it ({@link pushTextObject},
   *  {@link counterFlipPx}). */
  mirror?: boolean;
  /** The advance (px) of the text {@link drawTextPx} is painting on a
   *  mirrored page, for a painter that does not pass its own to
   *  {@link pushTextObject}. */
  runAdvancePx?: number;
}

/** What the vertical painter needs (see `verticalText.ts`): the Chinese
 *  region whose marks it sets, the central axis of each family (em above
 *  the baseline, `VDTFlowFrame.centralBaselines`), and how many digits a
 *  number set in one upright cell may have (`cjk.uprightDigits`). */
export interface VerticalPaint {
  region: CjkRegion;
  axes?: Record<string, number>;
  uprightDigits: number;
}

/** Set the character spacing (`Tc`) text is painted with, px, and record
 *  it on the context. */
export function setTrackingPx(ctx: PageCtx, px: number): void {
  ctx.trackingPx = px;
  ctx.page.pushOperators(setCharacterSpacing(px * ctx.scale));
}

/**
 * Paint, with `paint`, a word the layout measured in `script`
 * (`VDTLineSegment.scriptContext`, #725): shaped in that script (the
 * script in force, `withShapingScript`) and, in a script whose words take
 * no tracking (`scriptContextUntracked`: the Arabic script), with no
 * character spacing, as it was measured. Any other word (`script`
 * undefined) is just painted.
 */
export function paintInScript<T>(ctx: PageCtx, script: ScriptContext | undefined, paint: () => T): T {
  if (script === undefined) return paint();
  const tracking = ctx.trackingPx ?? 0;
  const lift = tracking !== 0 && scriptContextUntracked(script);
  if (lift) setTrackingPx(ctx, 0);
  try {
    return withShapingScript(script, paint);
  } finally {
    if (lift) setTrackingPx(ctx, tracking);
  }
}

/** A PDF transformation matrix `[a b c d e f]` (`x' = a·x + c·y + e`,
 *  `y' = b·x + d·y + f`). */
export type PdfMatrix = [number, number, number, number, number, number];

/** Apply `m` to a point. */
export function applyMatrix(m: PdfMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Push a graphics state with `m` concatenated onto the CTM. Everything
 *  drawn until {@link popTransform} goes through it. */
export function pushTransform(ctx: PageCtx, m: PdfMatrix): void {
  ctx.tags?.close();
  ctx.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
}

export function popTransform(ctx: PageCtx): void {
  ctx.tags?.close();
  ctx.page.pushOperators(popGraphicsState());
}

/** The quarter-turn matrix of a turned frame (`VDTResourceRotation`, or
 *  a vertical page's flow, `VDTFlowFrame.rotation`) in the backend's
 *  points, y up: a frame whose `*Px` helpers flip y against the page
 *  height, as the page's own do. */
export function quarterTurnMatrix(
  rot: { direction: 'cw' | 'ccw'; originX: number; originY: number },
  scale: number,
  pageHeightPt: number,
): PdfMatrix {
  return rot.direction === 'ccw'
    ? [0, 1, -1, 0, rot.originX * scale + pageHeightPt, pageHeightPt - rot.originY * scale]
    : [0, -1, 1, 0, rot.originX * scale - pageHeightPt, pageHeightPt - rot.originY * scale];
}

/** The matrix of a right-to-left page's flow (`VDTMirroredFlowFrame`,
 *  `mirror.originX` px) in the backend's points: the flow turned over the
 *  sheet's vertical axis, `x` → `originX − x`. */
export function mirrorMatrix(originX: number, scale: number): PdfMatrix {
  return [-1, 0, 0, 1, originX * scale, 0];
}

/** Paint what `paint` draws turned back about the horizontal extent
 *  `[leftPx, leftPx + widthPx]` of the current frame, on a mirrored page
 *  (`ctx.mirror`): a picture or a formula lands where the mirrored layout
 *  put its box and reads unmirrored. Elsewhere it just paints. */
export function counterFlipPx(ctx: PageCtx, leftPx: number, widthPx: number, paint: () => void): void {
  if (!ctx.mirror) {
    paint();
    return;
  }
  const s = ctx.scale;
  // The transform closes the open marked content (#900): the picture or
  // formula is painted in the element (or artifact) it was routed to, and
  // so is what its painter draws after it.
  const open = ctx.tags?.current ?? null;
  pushTransform(ctx, [-1, 0, 0, 1, (2 * leftPx + widthPx) * s, 0]);
  ctx.tags?.resume(open);
  ctx.mirror = false;
  try {
    paint();
  } finally {
    ctx.mirror = true;
    popTransform(ctx);
    ctx.tags?.resume(open);
  }
}

/** `inner` then `outer`: the matrix that maps a point of `inner`'s frame
 *  through both. */
export function composeMatrix(inner: PdfMatrix, outer: PdfMatrix): PdfMatrix {
  return [
    inner[0] * outer[0] + inner[1] * outer[2],
    inner[0] * outer[1] + inner[1] * outer[3],
    inner[2] * outer[0] + inner[3] * outer[2],
    inner[2] * outer[1] + inner[3] * outer[3],
    inner[4] * outer[0] + inner[5] * outer[2] + outer[4],
    inner[4] * outer[1] + inner[5] * outer[3] + outer[5],
  ];
}

/** Enter a frame: `m` concatenated onto the CTM ({@link pushTransform}),
 *  and the rects and points computed inside it mapped onto the page
 *  through it and every frame around it (`ctx.mapRectPt`,
 *  {@link mapPointPt}). Frames nest; {@link popFrame} leaves the last. */
export function pushFrame(ctx: PageCtx, m: PdfMatrix): void {
  pushTransform(ctx, m);
  const frames = ctx.frames ?? (ctx.frames = []);
  const outer = frames[frames.length - 1];
  const composed = outer ? composeMatrix(m, outer) : m;
  frames.push(composed);
  ctx.mapRectPt = (r) => mapRectThrough(composed, r);
}

/** Leave the frame {@link pushFrame} entered last. */
export function popFrame(ctx: PageCtx): void {
  popTransform(ctx);
  const frames = ctx.frames;
  frames?.pop();
  const outer = frames?.[frames.length - 1];
  if (outer) ctx.mapRectPt = (r) => mapRectThrough(outer, r);
  else {
    delete ctx.mapRectPt;
    delete ctx.frames;
  }
}

/** A point `(x, y)` in points of the current frame, on the page. */
export function mapPointPt(ctx: PageCtx, x: number, y: number): { x: number; y: number } {
  const m = ctx.frames?.[ctx.frames.length - 1];
  return m ? applyMatrix(m, x, y) : { x, y };
}

/** The rect map of the frame around the current one (the page's for a
 *  block turned inside a vertical page's flow), or undefined on the
 *  page. */
export function outerRectMap(ctx: PageCtx): PageCtx['mapRectPt'] {
  const frames = ctx.frames;
  const outer = frames && frames.length > 1 ? frames[frames.length - 2] : undefined;
  return outer ? (r) => mapRectThrough(outer, r) : undefined;
}

/** Map a rect `[x1, y1, x2, y2]` through `m`: the box its four corners
 *  cover, min / max (a frame turned by any angle, #910, covers more than
 *  the box of two opposite corners). */
export function mapRectThrough(m: PdfMatrix, rect: [number, number, number, number]): [number, number, number, number] {
  const pts = [
    applyMatrix(m, rect[0], rect[1]),
    applyMatrix(m, rect[2], rect[1]),
    applyMatrix(m, rect[0], rect[3]),
    applyMatrix(m, rect[2], rect[3]),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Inline colour swatch (`:swatch{…}`): a square of `sidePx` on the
 *  baseline, filled with `fill` (hex) when resolved and outlined in `ink`. */
export function drawSwatchPx(
  ctx: PageCtx,
  xPx: number,
  baselinePx: number,
  sidePx: number,
  fill: string | undefined,
  ink: Color,
): void {
  const { scale, pageHeightPt } = ctx;
  const strokePx = Math.max(0.5, sidePx * 0.06);
  const x = (xPx + strokePx / 2) * scale;
  const y = pageHeightPt - (baselinePx - strokePx / 2) * scale;
  const side = (sidePx - strokePx) * scale;
  const fillColor = fill ? colorFromHex(fill, ctx.colorSpace) : undefined;
  const fillAlpha = alphaOf(fillColor);
  const inkAlpha = alphaOf(ink);
  ctx.page.drawRectangle({
    x,
    y,
    width: side,
    height: side,
    ...(fillColor ? { color: fillColor } : {}),
    borderColor: ink,
    borderWidth: Math.max(0.01, strokePx * scale),
    ...(fillColor && fillAlpha < 1 ? { opacity: fillAlpha } : {}),
    ...(inkAlpha < 1 ? { borderOpacity: inkAlpha } : {}),
  });
}

export function makeScale(dpi: number): number {
  return 72 / dpi;
}

export function whiteColor(colorSpace: ColorMode): Color {
  if (colorSpace === 'cmyk' || isPrintMode(colorSpace)) return cmyk(0, 0, 0, 0);
  if (colorSpace === 'grayscale') return grayscale(1);
  return rgb(1, 1, 1);
}

// Memoized: called per text segment during rendering, while a document only
// uses a handful of colors. pdf-lib Color objects are plain immutable
// descriptors, so sharing instances is safe.
const colorCache = new Map<string, Color>();

/** Opacity riding on a {@link colorFromHex} colour (absent: opaque). pdf-lib
 *  reads only a colour's channels, so the extra field travels with it to
 *  the painters, which set it as an ExtGState constant alpha. */
interface AlphaColor {
  alpha?: number;
}

/**
 * The pdf-lib colour of a document colour string — `#rgb`, `#rrggbb`, with
 * an alpha channel (`#rgba`, `#rrggbbaa`), `rgb()` / `rgba()` or
 * `transparent` — in the output colour space. A translucent colour carries
 * its opacity along (see {@link alphaOf}); malformed input paints black.
 */
export function colorFromHex(hex: string, colorSpace: ColorMode): Color {
  const key = `${modeKey(colorSpace)}|${hex}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  const c = hexToRgb(hex);
  let color: Color;
  if (isPrintMode(colorSpace)) {
    // Through the output profile; PDF/X-1a has no transparency, so a
    // translucent colour is set as it would print over the paper.
    let alpha = colorAlpha(hex);
    let [r, g, b] = [c.r, c.g, c.b];
    if (alpha < 1 && colorSpace.flattenTransparency) {
      [r, g, b] = overPaper(r, g, b, alpha);
      alpha = 1;
    }
    const exact = colorSpace.authored.get(hex.slice(0, 7).toLowerCase());
    if (exact && alpha < 1 && colorSpace.flattenTransparency) {
      // A tint of the authored ink mix stands in for it over the paper.
      const t = colorAlpha(hex);
      color = cmyk(round4((exact.c / 100) * t), round4((exact.m / 100) * t), round4((exact.y / 100) * t), round4((exact.k / 100) * t));
    } else if (exact) {
      color = cmyk(round4(exact.c / 100), round4(exact.m / 100), round4(exact.y / 100), round4(exact.k / 100));
    } else {
      const k = colorSpace.transform.fromRgb(r, g, b);
      color = cmyk(round4(k.c), round4(k.m), round4(k.y), round4(k.k));
    }
    if (alpha < 1) (color as AlphaColor).alpha = alpha;
    colorCache.set(key, color);
    return color;
  }
  if (colorSpace === 'cmyk') {
    const k = rgbToCmyk(c);
    color = cmyk(k.c, k.m, k.y, k.k);
  } else if (colorSpace === 'grayscale') {
    color = grayscale(rgbToGrayscale(c));
  } else {
    color = rgb(c.r, c.g, c.b);
  }
  const alpha = colorAlpha(hex);
  if (alpha < 1) (color as AlphaColor).alpha = alpha;
  colorCache.set(key, color);
  return color;
}

/** Four decimals: enough for a separation, and exact K 1 stays exact. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Opacity of a colour made by {@link colorFromHex}, 0 … 1. */
export function alphaOf(color: Color | undefined): number {
  return (color as AlphaColor | undefined)?.alpha ?? 1;
}

/** ExtGState per distinct (fill alpha, stroke alpha) pair, per page. */
const alphaStates = new WeakMap<PDFPage, Map<string, PDFName>>();

const roundAlpha = (n: number): number => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;

/** The `gs` operator setting constant fill (`ca`) and stroke (`CA`) alpha,
 *  one shared ExtGState per pair and page; null when both are opaque. */
export function alphaStateOp(ctx: PageCtx, fillAlpha: number, strokeAlpha = 1): PDFOperator | null {
  const ca = roundAlpha(fillAlpha);
  const CA = roundAlpha(strokeAlpha);
  if (ca >= 1 && CA >= 1) return null;
  let states = alphaStates.get(ctx.page);
  if (!states) {
    states = new Map();
    alphaStates.set(ctx.page, states);
  }
  const key = `${ca}|${CA}`;
  let name = states.get(key);
  if (!name) {
    const dict = ctx.page.doc.context.obj({ Type: 'ExtGState', ca, CA });
    name = ctx.page.node.newExtGState('GSa', dict);
    states.set(key, name);
  }
  return setGraphicsState(name);
}

/** `op` as a one-element list when set, for spreading into operator runs. */
export function opt(op: PDFOperator | null): PDFOperator[] {
  return op ? [op] : [];
}

/** Back-compat alias — defaults to RGB. */
export function rgbFromHex(hex: string): Color {
  return colorFromHex(hex, 'rgb');
}

export function fillRectPx(
  ctx: PageCtx,
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
  color: Color,
  blendMode?: BlendMode,
): void {
  const { scale, pageHeightPt } = ctx;
  const x = xPx * scale;
  const y = pageHeightPt - (yPx + hPx) * scale;
  const width = wPx * scale;
  const height = hPx * scale;
  const alpha = alphaOf(color);
  if (alpha < 1 && !blendMode) {
    ctx.page.pushOperators(
      pushGraphicsState(),
      ...opt(alphaStateOp(ctx, alpha)),
      setFillingColor(color),
      rectangle(x, y, width, height),
      fill(),
      popGraphicsState(),
    );
    return;
  }
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height,
    color,
    ...(blendMode ? { blendMode } : {}),
    ...(alpha < 1 ? { opacity: alpha } : {}),
  });
}

/** Fill several rectangles (px) in one colour with a single fill operation:
 *  the viewer rasterises them as one shape, so rectangles that abut or
 *  overlap leave no seam between them. */
export function fillRectsPx(
  ctx: PageCtx,
  rects: readonly { x: number; y: number; width: number; height: number }[],
  color: Color,
): void {
  if (rects.length === 0) return;
  const { scale, pageHeightPt } = ctx;
  const alpha = alphaOf(color);
  ctx.page.pushOperators(
    pushGraphicsState(),
    ...(alpha < 1 ? opt(alphaStateOp(ctx, alpha)) : []),
    setFillingColor(color),
    ...rects.map((r) => rectangle(r.x * scale, pageHeightPt - (r.y + r.height) * scale, r.width * scale, r.height * scale)),
    fill(),
    popGraphicsState(),
  );
}

export function drawLinePx(
  ctx: PageCtx,
  x1Px: number,
  y1Px: number,
  x2Px: number,
  y2Px: number,
  color: Color,
  thicknessPx: number,
): void {
  const { scale, pageHeightPt } = ctx;
  const alpha = alphaOf(color);
  if (alpha < 1) {
    ctx.page.pushOperators(
      pushGraphicsState(),
      ...opt(alphaStateOp(ctx, 1, alpha)),
      setStrokingColor(color),
      setLineWidth(Math.max(0.01, thicknessPx * scale)),
      moveTo(x1Px * scale, pageHeightPt - y1Px * scale),
      lineTo(x2Px * scale, pageHeightPt - y2Px * scale),
      stroke(),
      popGraphicsState(),
    );
    return;
  }
  ctx.page.drawLine({
    start: { x: x1Px * scale, y: pageHeightPt - y1Px * scale },
    end: { x: x2Px * scale, y: pageHeightPt - y2Px * scale },
    color,
    thickness: Math.max(0.01, thicknessPx * scale),
  });
}

// Text is drawn a word at a time (the layout engine positions every
// word), and pdf-lib's `drawText` shapes each call afresh through fontkit —
// the same words, over and over. The show-text operator of a (font, text)
// pair never changes, so it is shaped once and reused; the font's resource
// key on a page likewise.
const showByFont = new WeakMap<PDFFont, Map<string, PDFOperator>>();
const ENCODE_CACHE_SLOTS = 50_000;

/** A glyph fontkit laid out: its id in the font file and the characters
 *  the font's `/ToUnicode` map gives it (see {@link glyphReads}). */
interface LaidGlyph {
  id: number;
  advanceWidth: number;
  codePoints: number[];
}

/** The fontkit side of a pdf-lib custom font — what kerning needs. */
interface ShapingFace {
  unitsPerEm: number;
  layout(text: string, features?: unknown): {
    glyphs: LaidGlyph[];
    positions: Array<{ xAdvance: number; xOffset: number }>;
  };
}

/** A glyph of a show-text array read as `text`, not as the characters the
 *  font's `/ToUnicode` map gives it (#755, {@link glyphReads}): shown in a
 *  `/Span` of its own whose `/ActualText` is `text`. `hex` is its code. */
interface ReadGlyph {
  hex: string;
  text: string;
}

/** A part of a show-text array: a run of glyph codes, a pen adjustment, or
 *  a glyph read through a span. */
type ShowPart = string | number | ReadGlyph;

/** Round a TJ adjustment to 1/100 of a text-space unit. */
function tjNumber(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The show-text operator for `text`, carrying the shaper's glyph positions.
 *
 * pdf-lib's `encodeText` shapes through fontkit but keeps only the glyph
 * ids, so a viewer advances each glyph by its raw width (the `W` array) and
 * the GPOS kerning the canvas measured with is lost: in a tightly kerned
 * face (Geist: `referencia` is 0.21 em narrower kerned) each word paints
 * wider than the layout engine placed it and eats the following space.
 * Emit a `TJ` array instead whose numbers restore every glyph's
 * `xAdvance` / `xOffset`; a run without adjustments stays a plain `Tj`.
 */
export function showTextShaped(font: PDFFont, text: string, letterTj = 0): PDFOperator {
  // A tracked text with a ligature is another show at each tracking
  // ({@link letterTrackedParts}); it is not kept.
  if (letterTj !== 0) {
    const spaced = shownRun(font, text);
    if (spaced && spaced.joined.length > 0) return partsOperator(font, plainParts(letterTrackedParts(spaced, letterTj)));
  }
  let cache = showByFont.get(font);
  if (!cache) {
    cache = new Map();
    showByFont.set(font, cache);
  }
  // Text shaped in another language or script is another show.
  const key = shapingKey(text);
  const hit = cache.get(key);
  if (hit) return hit;
  const run = shownRun(font, text);
  let op: PDFOperator;
  if (run) op = partsOperator(font, plainParts(run.parts));
  else {
    // A standard font: no shaper, pdf-lib's own encoding.
    noteMissingGlyphs(font, text);
    op = showText(font.encodeText(text));
  }
  if (cache.size >= ENCODE_CACHE_SLOTS) cache.clear();
  cache.set(key, op);
  return op;
}

/** A show-text operator and the font (a file of the face) it shows in. */
export interface TextShow {
  font: PDFFont;
  op: PDFOperator;
}

/** The show-text operators of `text` in `font`'s face: one
 *  ({@link showTextShaped}) for a face of one file, else one per run of
 *  characters set in the same file (see `faceFiles.ts`). A glyph the
 *  font's `/ToUnicode` map reads as other text is shown in a span of its
 *  own ({@link glyphReads}), unless `read` is false: the caller reads the
 *  text some other way (an `/ActualText` over all of it, a figure's
 *  alternate text).
 *
 *  In a document shaped in its own language the text is shaped word by
 *  word, as the canvas shaped it (`wordRuns`, #770), and the words that
 *  follow each other in one file are one operator; with `whole` it is
 *  shaped as one string, as the text of a drawing is (a browser lays an
 *  SVG's text out as it does a page's, not as its canvas does). */
export function textShows(font: PDFFont, text: string, read = true, whole = false, letterTj = 0): TextShow[] {
  const runs = whole ? fileRuns(font, text) : wordRuns(font, text);
  if (runs.length > 1 && !whole && shapesAsCanvas()) {
    const joined = joinedShows(runs, read, letterTj);
    if (joined) return joined;
  }
  return runs.flatMap((run) => inRun(run, () => {
    const shown = read ? shownRun(run.font, run.text) : undefined;
    return shown?.reads ? partsShows(run.font, letterTrackedParts(shown, letterTj)) : [{ font: run.font, op: showTextShaped(run.font, run.text, letterTj) }];
  }));
}

/**
 * The character spacing a ligature is owed for the letters it joins, as a
 * `TJ` number (thousandths of the font size), for a text of `sizePx`
 * painted under a character spacing of `trackingPx` (#770); 0 when it is
 * owed none.
 *
 * The layout counts the tracking once a letter, and `Tc` follows every
 * glyph: a ligature, one glyph for two or three letters, advanced by one
 * tracking, and the word ended a tracking short of the width measured for
 * each letter joined (`shift` in Source Serif 4 at 19.58 px, 0.39 px a
 * letter: 0.39 px short). In a document shaped in its own language the
 * pen moves on after a ligature by the tracking of its other letters
 * ({@link letterTrackedParts}), as the canvas and the HTML set it; one
 * that keeps the host's language prints as it did.
 */
export function letterTrackingTj(trackingPx: number, sizePx: number): number {
  return trackingPx !== 0 && sizePx > 0 && shapesAsCanvas() ? (trackingPx / sizePx) * 1000 : 0;
}

/**
 * The parts of `run` with, after each glyph that stands for several
 * letters ({@link ShownRun.joined}), a pen movement of `letterTj` for
 * each letter but the first: the tracking `Tc` gave the glyph once and
 * the layout counted once a letter. The run's own parts when it holds no
 * such glyph or is not tracked.
 */
function letterTrackedParts(run: ShownRun, letterTj: number): ShowPart[] {
  if (letterTj === 0 || run.joined.length === 0) return run.parts;
  const out: ShowPart[] = [];
  // Glyphs shown so far, and the next entry of `joined` to place.
  let glyph = 0;
  let next = 0;
  for (const part of run.parts) {
    if (typeof part === 'number') {
      pushPart(out, part);
      continue;
    }
    const hex = typeof part === 'string' ? part : part.hex;
    const count = hex.length / 4;
    if (typeof part === 'object') {
      out.push(part);
      for (; next < run.joined.length && run.joined[next]![0] < glyph + count; next++) pushPart(out, tjNumber(-run.joined[next]![1] * letterTj));
      glyph += count;
      continue;
    }
    let from = 0;
    for (let k = 0; k < count && next < run.joined.length; k++) {
      if (run.joined[next]![0] !== glyph + k) continue;
      pushPart(out, hex.slice(from * 4, (k + 1) * 4));
      pushPart(out, tjNumber(-run.joined[next]![1] * letterTj));
      from = k + 1;
      next++;
    }
    if (from < count) pushPart(out, hex.slice(from * 4));
    glyph += count;
  }
  return out;
}

/** The show-text operators of `runs` (`wordRuns`), the runs that follow
 *  each other in one file joined into one operator: the pen carries from
 *  each to the next, and nothing is kerned across. Undefined when a run's
 *  font carries no shaper (a standard font). */
function joinedShows(runs: readonly FileRun[], read: boolean, letterTj = 0): TextShow[] | undefined {
  const groups: Array<{ font: PDFFont; parts: ShowPart[] }> = [];
  for (const run of runs) {
    const shown = inRun(run, () => shownRun(run.font, run.text));
    if (!shown) return undefined;
    let group = groups[groups.length - 1];
    if (!group || group.font !== run.font) {
      group = { font: run.font, parts: [] };
      groups.push(group);
    }
    for (const part of letterTrackedParts(shown, letterTj)) pushPart(group.parts, read || typeof part !== 'object' ? part : part.hex);
  }
  return groups.flatMap((g) => partsShows(g.font, g.parts));
}

function shapingFace(font: PDFFont): { face: ShapingFace & FallbackFace; features: unknown } | undefined {
  const embedder = (font as unknown as { embedder?: { font?: ShapingFace & FallbackFace; fontFeatures?: unknown } }).embedder;
  const face = embedder?.font;
  if (!face || typeof face.layout !== 'function' || !face.unitsPerEm) return undefined;
  return { face, features: embedder!.fontFeatures };
}

/**
 * What the glyphs fontkit laid `text` out with are read as, where the
 * font's `/ToUnicode` map reads them as other text (#755); undefined when
 * the map reads every one as written, which is nearly always.
 *
 * The map is one per font, and a glyph keeps the characters it was first
 * given (fontkit makes a glyph once, with the characters of the text that
 * first showed it; `shapedText.ts` does the same for the glyphs HarfBuzz
 * shows). A glyph two characters share therefore reads as the first of
 * them the document set: the bracket a right-to-left run mirrors is the
 * glyph of the other bracket, so after `(١)` in an Arabic note the glyph
 * of `)` stands for `(`, and a later `(Brill, 2017)` in the same font read
 * back `(Brill, 2017(`. A form the shaper puts in a character's place
 * takes the characters of that character's own glyph, the wrong ones
 * with them. The same goes for any two characters the face's cmap draws
 * with one glyph: the hyphen-minus and the hyphen, the space and the
 * no-break space. Such a glyph is shown in a span whose `/ActualText` is
 * its character here, as `shapedText.ts` does for a cluster HarfBuzz
 * shaped: the first use of a glyph costs nothing, each use for another
 * character one span.
 *
 * The glyphs are walked against the text. A glyph whose own characters
 * are the next ones of the text reads right; one with no characters (the
 * second glyph of a decomposed letter) reads as nothing; one that holds
 * one character, and not the next of the text, is read as that next
 * character. Three glyphs are left as they read: `.notdef`, which stands
 * for every character the face lacks; the space glyph fontkit hides an
 * invisible character behind; and the space glyph, read as a space, under
 * a no-break space or any other space the face draws with it (a space the
 * face lacks reads as a space too, see `fallbackSpaces.ts`). The reads
 * hold only when the walk ends where the text does (every glyph accounted
 * for, one way or another); when it does not — a glyph for several
 * characters that holds others, a variation selector — the run is left as
 * it reads.
 */
function glyphReads(face: ShapingFace, glyphs: readonly LaidGlyph[], text: string): Array<string | undefined> | undefined {
  // fontkit hands a right-to-left run's glyphs over in visual order: such
  // text is HarfBuzz's whenever it is loaded, and is not walked here.
  if (needsComplexShaping(text)) return undefined;
  let reads: Array<string | undefined> | undefined;
  let space: number | undefined;
  // UTF-16 offset in `text` of the next character to read.
  let at = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!;
    const own = glyph.codePoints;
    if (glyph.id !== 0 && (!own || own.length === 0)) continue;
    let end = at;
    for (const cp of own ?? []) {
      if (text.codePointAt(end) !== cp) {
        end = -1;
        break;
      }
      end += cp > 0xffff ? 2 : 1;
    }
    if (end > at) {
      at = end;
      continue;
    }
    const cp = text.codePointAt(at);
    if (cp === undefined) return undefined;
    at += cp > 0xffff ? 2 : 1;
    if (glyph.id === 0) continue;
    if (isDefaultIgnorable(cp) && glyph.id === (space ??= cmapGlyphId(face, 0x20))) continue;
    if (own.length !== 1) return undefined;
    if (own[0] === 0x20 && isSpaceCharacter(cp)) continue;
    reads ??= new Array<string | undefined>(glyphs.length);
    reads[i] = String.fromCodePoint(cp);
  }
  return at === text.length ? reads : undefined;
}

/** The id of the glyph the face's cmap gives `cp` (0: none), read from the
 *  cmap itself: `glyphForCodePoint` would make the glyph, with `cp` as the
 *  characters it then keeps in the font's map. */
function cmapGlyphId(face: ShapingFace, cp: number): number {
  const cmap = (face as unknown as { _cmapProcessor?: { lookup?(codePoint: number): number } })._cmapProcessor;
  return typeof cmap?.lookup === 'function' ? cmap.lookup(cp) || 0 : 0;
}

/** The `TJ` array (hex glyph runs and adjustments) of a shaped run, with
 *  the sum of the glyphs' own widths (their `W` entries), in thousandths
 *  of the font size; undefined when the shaper's positions cannot be
 *  matched to its glyphs. A glyph the font's map reads as other text is a
 *  part of its own ({@link glyphReads}). */
function shapedRun(font: PDFFont, text: string, encoded: PDFHexString): { parts: ShowPart[]; widths: number; joined: Array<[number, number]> } | undefined {
  const shaping = shapingFace(font);
  if (!shaping) return undefined;
  const { face } = shaping;
  const run = face.layout(text, shaping.features);
  const hex = encoded.asString();
  const count = run.glyphs.length;
  if (count === 0 || hex.length !== count * 4 || run.positions.length !== count) return undefined;
  const reads = glyphReads(face, run.glyphs, text);
  // TJ numbers are thousandths of text space, subtracted from the pen: a
  // glyph drawn at `pen + xOffset` then advancing by `xAdvance` (not its
  // W width `advanceWidth`) is `-xOffset, glyph, -(xAdvance - w - xOffset)`.
  const toText = 1000 / face.unitsPerEm;
  const subsetFont = isSubsetFont(font);
  const parts: ShowPart[] = [];
  let pendingHex = '';
  let pendingAdjust = 0;
  const flushHex = () => {
    if (pendingHex) parts.push(pendingHex);
    pendingHex = '';
  };
  let widths = 0;
  // The glyphs that stand for several letters (a ligature), by index,
  // with the letters each joins beyond its first.
  const joined: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const own = run.glyphs[i]!.codePoints;
    if (own && own.length > 1) {
      const letters = graphemesOf(String.fromCodePoint(...own)).length;
      if (letters > 1) joined.push([i, letters - 1]);
    }
    const pos = run.positions[i]!;
    const lead = tjNumber(pendingAdjust - pos.xOffset * toText);
    if (lead !== 0) {
      flushHex();
      parts.push(lead);
    }
    const cid = hex.slice(i * 4, i * 4 + 4);
    const read = reads?.[i];
    if (read !== undefined) {
      flushHex();
      parts.push({ hex: cid, text: read });
    } else pendingHex += cid;
    pendingAdjust = -(pos.xAdvance - run.glyphs[i]!.advanceWidth - pos.xOffset) * toText;
    widths += cid === '0000' && subsetFont ? MISSING_WIDTH : run.glyphs[i]!.advanceWidth * toText;
  }
  flushHex();
  return { parts, widths, joined };
}

/** The width a viewer gives a glyph with no `W` entry (no `DW` is written). */
const MISSING_WIDTH = 1000;

/** Whether pdf-lib embeds `font` as a subset, whose `W` array never lists
 *  the notdef glyph (CID 0): a viewer advances it by {@link MISSING_WIDTH}. */
function isSubsetFont(font: PDFFont): boolean {
  return !!(font as unknown as { embedder?: { subset?: unknown } }).embedder?.subset;
}

function adjustedOperator(font: PDFFont, parts: Array<string | number>): PDFOperator {
  const array = PDFArray.withContext(font.doc.context);
  for (const part of parts) {
    array.push(typeof part === 'number' ? PDFNumber.of(part) : PDFHexString.of(part));
  }
  return PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [array]);
}

/** A plain `Tj` for a single glyph run (or none), else a `TJ`. */
function partsOperator(font: PDFFont, parts: Array<string | number>): PDFOperator {
  if (parts.length === 0) return showText(PDFHexString.of(''));
  return parts.length === 1 && typeof parts[0] === 'string' ? showText(PDFHexString.of(parts[0])) : adjustedOperator(font, parts);
}

/** Append a part to a `TJ` array, merging it into a neighbouring glyph run
 *  or number; a zero adjustment is dropped. A glyph read through a span
 *  stays a part of its own. */
function pushPart(parts: ShowPart[], part: ShowPart): void {
  const last = parts[parts.length - 1];
  if (typeof part === 'object') parts.push(part);
  else if (typeof part === 'number') {
    if (part === 0) return;
    if (typeof last === 'number') parts[parts.length - 1] = tjNumber(last + part);
    else parts.push(part);
  } else if (typeof last === 'string') parts[parts.length - 1] = last + part;
  else parts.push(part);
}

/** A text set for a show-text array: its glyph runs and adjustments, where
 *  they leave the pen (thousandths of the font size: the glyphs' `W`
 *  widths less the adjustments, before any character spacing) and how
 *  many glyphs they show. */
interface ShownRun {
  parts: ShowPart[];
  advance: number;
  glyphs: number;
  /** A glyph of it is read through a span ({@link ReadGlyph}). */
  reads: boolean;
  /** Its glyphs that stand for several letters (a ligature): the glyph's
   *  index among the run's and the letters it joins beyond its first, in
   *  order. A tracked text owes each of those a tracking (#770). */
  joined: ReadonlyArray<readonly [number, number]>;
  /** The letters of {@link joined} together. */
  letters: number;
}

/** Glyphs and pen advance of a run of parts whose glyph widths sum to
 *  `widths` (thousandths of the font size). */
function shownRunOf(parts: ShowPart[], widths: number, joined: ReadonlyArray<readonly [number, number]> = []): ShownRun {
  let advance = widths;
  let glyphs = 0;
  let reads = false;
  for (const part of parts) {
    if (typeof part === 'number') advance -= part;
    else if (typeof part === 'string') glyphs += part.length / 4;
    else {
      glyphs += part.hex.length / 4;
      reads = true;
    }
  }
  let letters = 0;
  for (const [, more] of joined) letters += more;
  return { parts, advance, glyphs, reads, joined, letters };
}

/** `parts` with every glyph read through the font's map: one show-text
 *  array, as before any glyph took a span. */
function plainParts(parts: readonly ShowPart[]): Array<string | number> {
  const out: Array<string | number> = [];
  for (const part of parts) pushPart(out, typeof part === 'object' ? part.hex : part);
  return out;
}

/**
 * The show-text operators of `parts` in `font`: one, or, around each glyph
 * read through a span ({@link ReadGlyph}), the span's `BDC`, the glyph and
 * its `EMC`. The glyphs and the pen adjustments are the same ones in the
 * same order, cut into several arrays: nothing moves on the page.
 */
function partsShows(font: PDFFont, parts: readonly ShowPart[]): TextShow[] {
  const shows: TextShow[] = [];
  let plain: Array<string | number> = [];
  const flush = () => {
    if (plain.length > 0) shows.push({ font, op: partsOperator(font, plain) });
    plain = [];
  };
  for (const part of parts) {
    if (typeof part !== 'object') {
      pushPart(plain, part);
      continue;
    }
    flush();
    const props = font.doc.context.obj({ ActualText: PDFHexString.fromText(part.text) }) as unknown as OperatorArg;
    shows.push(
      { font, op: PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), props]) },
      { font, op: showText(PDFHexString.of(part.hex)) },
      { font, op: PDFOperator.of(PDFOperatorNames.EndMarkedContent) },
    );
  }
  flush();
  if (shows.length === 0) shows.push({ font, op: partsOperator(font, []) });
  return shows;
}

/**
 * The parts of a text holding a space the face has no glyph for (a narrow
 * no-break space, a figure space…) or an invisible character (a word
 * joiner): painted as the canvas measured it, not as `.notdef` boxes (see
 * `fallbackSpaces.ts`). A missing space is the face's space glyph — text
 * extraction still finds a space there — moved to the browser's advance
 * for it; an invisible character is not drawn.
 */
function fallbackRun(font: PDFFont, face: FallbackFace, pieces: TextPiece[]): ShownRun {
  const toText = 1000 / face.unitsPerEm;
  const spaceGlyph = face.hasGlyphForCodePoint(0x20) ? face.glyphForCodePoint(0x20) : undefined;
  const parts: ShowPart[] = [];
  let widths = 0;
  // The ligatures of the pieces, by their glyphs' index in the whole run.
  const joined: Array<[number, number]> = [];
  let glyphs = 0;
  const glyphsOf = (shown: readonly ShowPart[]): number => shown.reduce<number>((n, part) => n + (typeof part === 'number' ? 0 : (typeof part === 'string' ? part : part.hex).length / 4), 0);
  for (const piece of pieces) {
    if ('space' in piece) {
      if (spaceGlyph) {
        // The face's space glyph, read as a space whatever the font's map
        // gives it (a no-break space set before any space, #755).
        const space = font.encodeText(' ');
        const shown = shapedRun(font, ' ', space)?.parts ?? [space.asString()];
        for (const part of shown) pushPart(parts, part);
        glyphs += glyphsOf(shown);
        pushPart(parts, tjNumber((spaceGlyph.advanceWidth - piece.space) * toText));
        widths += spaceGlyph.advanceWidth * toText;
      } else {
        pushPart(parts, tjNumber(-piece.space * toText));
      }
      continue;
    }
    const encoded = font.encodeText(piece.text);
    const shaped = shapedRun(font, piece.text, encoded);
    const shown = shaped?.parts ?? [encoded.asString()];
    for (const part of shown) pushPart(parts, part);
    for (const [at, more] of shaped?.joined ?? []) joined.push([glyphs + at, more]);
    glyphs += glyphsOf(shown);
    widths += shaped?.widths ?? font.widthOfTextAtSize(piece.text, 1000);
  }
  return shownRunOf(parts, widths, joined);
}

const runsByFont = new WeakMap<PDFFont, Map<string, ShownRun>>();

/** `text` as {@link showTextShaped} paints it, with the advance and glyph
 *  count it leaves (cached per font). Undefined when the font carries no
 *  shaper to measure it with. */
function shownRun(font: PDFFont, text: string): ShownRun | undefined {
  let cache = runsByFont.get(font);
  if (!cache) {
    cache = new Map();
    runsByFont.set(font, cache);
  }
  const key = shapingKey(text);
  const hit = cache.get(key);
  if (hit) return hit;
  const shaping = shapingFace(font);
  if (!shaping) return undefined;
  noteMissingGlyphs(font, text);
  const pieces = fallbackPieces(shaping.face, text);
  let run: ShownRun;
  if (pieces) {
    run = fallbackRun(font, shaping.face, pieces);
  } else {
    const encoded = font.encodeText(text);
    const hex = encoded.asString();
    const shaped = shapedRun(font, text, encoded);
    run = shownRunOf(shaped?.parts ?? (hex ? [hex] : []), shaped?.widths ?? font.widthOfTextAtSize(text, 1000), shaped?.joined);
  }
  if (cache.size >= ENCODE_CACHE_SLOTS) cache.clear();
  cache.set(key, run);
  return run;
}

/** How far `text` moves the pen in `font`'s face at `sizePx`, px, with
 *  `trackingPx` after every glyph (as {@link showTextShaped} paints it,
 *  each run in the file of the face that has it), and after every letter
 *  a ligature joins in a document shaped in its own language
 *  ({@link letterTrackingTj}); and how many glyphs it shows. */
export function textAdvancePx(font: PDFFont, text: string, sizePx: number, trackingPx = 0): { advance: number; glyphs: number } {
  let advance = 0;
  let glyphs = 0;
  // Letters of ligatures beyond each one's first.
  let letters = 0;
  const perLetter = trackingPx !== 0 && shapesAsCanvas();
  for (const word of wordRuns(font, text)) {
    const { font: file, text: part } = word;
    const run = inRun(word, () => shownRun(file, part));
    if (!run) {
      advance += file.widthOfTextAtSize(part, sizePx);
      glyphs += [...part].length;
      continue;
    }
    advance += (run.advance / 1000) * sizePx;
    glyphs += run.glyphs;
    if (perLetter) letters += run.letters;
  }
  return { advance: advance + (glyphs + letters) * trackingPx, glyphs };
}

/** How far (px) the characters of a segment, each at its own advance, may
 *  be from the width the layout gave the segment and still be the ones it
 *  measured. A browser's sum of advances is not the font's to the last
 *  digit: Chrome sets an em of Noto Serif JP 15.62 px wide at 15.625 px,
 *  0.135 px less over a line of 27 characters. Half a thousandth of the
 *  width covers that and stays under a kerned pair. */
function cellTolerance(widthPx: number): number {
  return Math.max(0.02, 0.0005 * Math.abs(widthPx));
}

/**
 * The characters of `text`, a segment of a line of the CJK composer
 * `widthPx` wide, each with its own advance, when the layout measured them
 * one by one and a shaper sets them otherwise together (#770); undefined
 * for any other text, which is painted as it is.
 *
 * The composer measures every CJK character alone and lets the ones that
 * advance alike share a segment, which is then one string to a renderer.
 * A face may kern inside it: Noto Serif JP sets `す。` 0.08 em closer
 * and `れ、` 0.06 em further apart, Noto Sans JP `す。` 0.1 em closer,
 * so the glyphs after the pair stood off their places and the segment
 * ended off its width. A line does not say how its segments were measured,
 * so the PDF asks its own shaper, as it does for the pieces of a word
 * (`wordPieces.ts`): the characters are painted one by one, each where the
 * one before ends, when together they are as wide as the layout measured
 * the segment ({@link cellTolerance}) and nearer to it than the string
 * shaped as the canvas shapes it. A Western run, measured whole, keeps its
 * kerning: whole, it is as wide as it was measured.
 *
 * `trackingPx` is the character spacing the segment is painted with. Only
 * in a document shaped in its own language; one that keeps the host's
 * prints its segments as it always did.
 */
export function cellPieces(font: PDFFont, text: string, widthPx: number, sizePx: number, trackingPx = 0): Array<{ text: string; width: number }> | undefined {
  if (text.length < 2 || !(sizePx > 0) || !shapesAsCanvas() || needsComplexShaping(text)) return undefined;
  const graphemes = graphemesOf(text);
  if (graphemes.length < 2) return undefined;
  const whole = Math.abs(textAdvancePx(font, text, sizePx, trackingPx).advance - widthPx);
  // Shaped whole it is where it was measured: nothing kerns inside.
  if (whole <= 0.02) return undefined;
  const pieces = graphemes.map((g) => ({ text: g, width: textAdvancePx(font, g, sizePx, trackingPx).advance }));
  let sum = 0;
  for (const piece of pieces) sum += piece.width;
  const apart = Math.abs(sum - widthPx);
  return apart <= cellTolerance(widthPx) && apart < whole ? pieces : undefined;
}

/** Below this (thousandths of the font size) the pen is left where the
 *  glyphs put it and the difference is carried to the next piece: the
 *  layout and the embedded face agree on almost every word, and the
 *  `TJ` then holds only the kerning. */
const MEASURED_TOLERANCE = 0.5;

/**
 * One show-text operator for a line's pieces (its words and spaces, each
 * with the width the layout measured it at): every piece starts where the
 * layout put it (EF-137). The face's own glyphs set each piece, a `TJ`
 * number after it moves the pen to where the next one starts, so a glyph
 * the embedded face lacks (measured by the browser in another font) or
 * any other difference between the two measures never shifts the words
 * after it. Spaces stay real space glyphs, for text extraction.
 * `trackingPx` is the character spacing (`Tc`) the line is painted with,
 * added after every glyph. Undefined when the font carries no shaper.
 */
export function measuredTextOperator(
  font: PDFFont,
  pieces: readonly { text: string; width: number }[],
  sizePx: number,
  trackingPx = 0,
): PDFOperator | undefined {
  const shows = measuredTextShows(font, pieces, sizePx, trackingPx, false);
  return shows && shows.length === 1 ? shows[0]!.op : undefined;
}

/**
 * {@link measuredTextOperator} for a face of any number of files: the
 * pieces cut into runs by file (see `faceFiles.ts`), one show-text
 * operator per stretch set in the same file. The pen carries across the
 * font switches, so every piece still starts where the layout put it. A
 * glyph the font's `/ToUnicode` map reads as other text is shown in a span
 * of its own between two of them ({@link glyphReads}).
 */
export function measuredTextShows(
  font: PDFFont,
  pieces: readonly { text: string; width: number }[],
  sizePx: number,
  trackingPx = 0,
  /** False when the caller reads the text some other way: no glyph takes
   *  a span of its own (see {@link textShows}). */
  read = true,
): TextShow[] | undefined {
  if (!(sizePx > 0)) return undefined;
  const groups: Array<{ font: PDFFont; parts: ShowPart[] }> = [];
  let group: { font: PDFFont; parts: ShowPart[] } | undefined;
  const tracking = (trackingPx / sizePx) * 1000;
  // What a ligature is owed for the letters it joins (#770).
  const letterTj = letterTrackingTj(trackingPx, sizePx);
  // How far the pen is right of where the layout wants it, in thousandths.
  let ahead = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    let advance = 0;
    for (const word of wordRuns(font, piece.text)) {
      const file = word.font;
      const run = inRun(word, () => shownRun(file, word.text));
      if (!run) return undefined;
      if (!group || group.font !== file) {
        group = { font: file, parts: [] };
        groups.push(group);
      }
      for (const part of letterTrackedParts(run, letterTj)) pushPart(group.parts, read || typeof part !== 'object' ? part : part.hex);
      advance += run.advance + run.glyphs * tracking + (letterTj !== 0 ? run.letters * letterTj : 0);
    }
    ahead += advance - (piece.width / sizePx) * 1000;
    if (i < pieces.length - 1 && Math.abs(ahead) >= MEASURED_TOLERANCE) {
      const n = tjNumber(ahead);
      if (!group) {
        group = { font, parts: [] };
        groups.push(group);
      }
      pushPart(group.parts, n);
      ahead -= n;
    }
  }
  if (groups.length === 0) groups.push({ font, parts: [] });
  return groups.flatMap((g) => partsShows(g.font, g.parts));
}

const fontKeysByPage = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();

export function fontKeyOn(page: PDFPage, font: PDFFont): PDFName {
  let keys = fontKeysByPage.get(page);
  if (!keys) {
    keys = new Map();
    fontKeysByPage.set(page, keys);
  }
  let key = keys.get(font);
  if (!key) {
    key = page.node.newFontDictionary(font.name, font.ref);
    keys.set(font, key);
  }
  return key;
}

/** Outline of the glyphs a text is drawn with (a design text's `stroke`):
 *  stroked over the fill, or alone for hollow letters. */
export interface TextOutline {
  color: Color;
  widthPx: number;
  hollow?: boolean;
}

/** `actualText`, when set, is what copying, text extraction and assistive
 *  technology read for the glyphs painted (see {@link pushTextObject}). */
export function drawTextPx(
  ctx: PageCtx,
  text: string,
  xPx: number,
  baselinePx: number,
  font: PDFFont,
  sizePx: number,
  color: Color,
  outline?: TextOutline,
  actualText?: string,
  /** Vertical text: the orientation the author gave it
   *  (`VDTLineSegment.tcy` / `orientation`). */
  orient?: ForcedOrientation,
  /** The text is one bidi run in this direction (a design text or chip run
   *  flagged `rtl`): shaped so, not cut into runs by its own letters. */
  direction?: 'ltr' | 'rtl',
): void {
  if (!text) return;
  outline ??= ctx.textOutline;
  if (ctx.vertical) {
    verticalPainter?.(ctx, text, xPx, baselinePx, font, sizePx, color, outline, actualText, orient);
    return;
  }
  // On a mirrored page the text object is turned back about the run's box,
  // which needs its advance: the face's, as the run is shown (joining
  // letters are shown untracked, see `shapedText.ts`).
  const outer = ctx.runAdvancePx;
  if (ctx.mirror) ctx.runAdvancePx = textAdvancePx(font, text, sizePx, joinsLetters(text) ? 0 : ctx.trackingPx ?? 0).advance;
  try {
    // Right-to-left and joining scripts are shaped with HarfBuzz when the
    // document loaded it (`shapedText.ts`).
    if (complexPainter?.(ctx, text, xPx, baselinePx, font, sizePx, color, outline, actualText, direction)) return;
    pushTextObject(ctx, textShows(font, text, actualText === undefined && !ctx.readSpans, false, letterTrackingTj(ctx.trackingPx ?? 0, sizePx)), xPx, baselinePx, font, sizePx, color, outline, actualText);
  } finally {
    ctx.runAdvancePx = outer;
  }
}

/** The painter of text HarfBuzz shapes (`shapedText.ts` registers it):
 *  true when it painted `text`, false to leave it to fontkit. */
type ComplexPainter = (
  ctx: PageCtx,
  text: string,
  xPx: number,
  baselinePx: number,
  font: PDFFont,
  sizePx: number,
  color: Color,
  outline?: TextOutline,
  actualText?: string,
  direction?: 'ltr' | 'rtl',
) => boolean;
let complexPainter: ComplexPainter | undefined;

/** Register the painter {@link drawTextPx} hands complex-script text to. */
export function registerComplexPainter(painter: ComplexPainter): void {
  complexPainter = painter;
}

/** The painter of vertical text (`verticalText.ts` registers it, so this
 *  module does not import it back). */
type VerticalPainter = (
  ctx: PageCtx,
  text: string,
  xPx: number,
  baselinePx: number,
  font: PDFFont,
  sizePx: number,
  color: Color,
  outline?: TextOutline,
  actualText?: string,
  orient?: ForcedOrientation,
) => void;
let verticalPainter: VerticalPainter | undefined;

/** Register the painter {@link drawTextPx} hands vertical text to. */
export function registerVerticalPainter(painter: VerticalPainter): void {
  verticalPainter = painter;
}

/**
 * Paint a line's pieces (its words and spaces, with their measured widths)
 * in one text object from `xPx`, each piece where the layout measured it
 * (see {@link measuredTextOperator}). `trackingPx` is the character spacing
 * already set for the line. Returns false, painting nothing, when the font
 * cannot be measured that way; the caller then paints the text itself.
 * `actualText` as in {@link drawTextPx}.
 */
export function drawMeasuredTextPx(
  ctx: PageCtx,
  pieces: readonly { text: string; width: number }[],
  xPx: number,
  baselinePx: number,
  font: PDFFont,
  sizePx: number,
  color: Color,
  trackingPx = 0,
  actualText?: string,
): boolean {
  if (ctx.vertical) {
    // Down the column each piece starts where the layout put it, in one
    // span that reads as the line.
    const span = actualText ?? pieces.map((p) => p.text).join('');
    if (!verticalPainter) return false;
    // The span closes the structure's open sequence: opened again inside.
    const elem = ctx.tags?.openElem;
    beginActualTextSpan(ctx, span, { font, text: pieces[0]?.text ?? '', sizePx, xPx, baselinePx });
    if (elem) ctx.tags?.content(elem);
    let x = xPx;
    for (const piece of pieces) {
      if (piece.text) verticalPainter(ctx, piece.text, x, baselinePx, font, sizePx, color);
      x += piece.width;
    }
    endActualTextSpan(ctx, { font, text: pieces[0]?.text ?? '', sizePx, xPx, baselinePx });
    return true;
  }
  const shows = measuredTextShows(font, pieces, sizePx, trackingPx, actualText === undefined && !ctx.readSpans);
  if (!shows) return false;
  // Every piece starts where the layout put it: the run is as wide as the
  // layout measured it.
  const advance = ctx.mirror ? pieces.reduce((sum, p) => sum + p.width, 0) : undefined;
  pushTextObject(ctx, shows, xPx, baselinePx, font, sizePx, color, undefined, actualText, advance);
  return true;
}

/**
 * The operators pdf-lib's `drawText` emits, around the show-text operators
 * of a text: one, or one per file of a face made of several (each after
 * its own `Tf`; the pen carries over). With `actualText` the show-text
 * operators sit in a `/Span` marked-content sequence whose `/ActualText` is
 * that text (PDF 1.7 §14.9.4), inside the text object, where readers expect
 * it: copying, text extraction and assistive technology read it instead of
 * the glyphs. The span has no MCID, so in a tagged PDF it nests in the
 * structure sequence open around it.
 *
 * On a mirrored page (`ctx.mirror`) the text matrix turns the glyphs back
 * about the run's box, `[xPx, xPx + advancePx]` (`advancePx`, else the
 * advance {@link drawTextPx} measured): the pen starts at the box's right
 * edge and runs leftwards in the flow, which the page's mirror shows
 * left to right on the sheet.
 */
export function pushTextObject(
  ctx: PageCtx,
  shows: readonly TextShow[],
  xPx: number,
  baselinePx: number,
  font: PDFFont,
  sizePx: number,
  color: Color,
  outline?: TextOutline,
  actualText?: string,
  advancePx?: number,
): void {
  const { scale, pageHeightPt } = ctx;
  outline ??= ctx.textOutline;
  const textMatrix = ctx.mirror
    ? setTextMatrix(-1, 0, 0, 1, (xPx + (advancePx ?? ctx.runAdvancePx ?? 0)) * scale, pageHeightPt - baselinePx * scale)
    : setTextMatrix(1, 0, 0, 1, xPx * scale, pageHeightPt - baselinePx * scale);
  // Text render mode 2 fills then strokes the glyphs; mode 1 only strokes.
  const outlineOps = outline && outline.widthPx > 0
    ? [
        setStrokingColor(outline.color),
        setLineWidth(outline.widthPx * scale),
        setTextRenderingMode(outline.hollow ? TextRenderingMode.Outline : TextRenderingMode.FillAndOutline),
      ]
    : [];
  // The first show's font is set with the text matrix; each later show in
  // another file of the face switches to it.
  const first = shows[0]?.font ?? font;
  const body: PDFOperator[] = [];
  let current = first;
  for (const show of shows) {
    if (show.font !== current) {
      body.push(setFontAndSize(fontKeyOn(ctx.page, show.font), sizePx * scale));
      current = show.font;
    }
    body.push(show.op);
  }
  // The operators pdf-lib's `drawText` emits, with the encoding cached.
  ctx.page.pushOperators(
    pushGraphicsState(),
    // The outline's own alpha is the stroke alpha of the glyphs.
    ...opt(alphaStateOp(ctx, alphaOf(color), outlineOps.length > 0 ? alphaOf(outline!.color) : 1)),
    ...outlineOps,
    beginText(),
    setFillingColor(color),
    setFontAndSize(fontKeyOn(ctx.page, first), sizePx * scale),
    textMatrix,
    ...(actualText === undefined ? body : withActualText(ctx, actualText, body)),
    endText(),
    popGraphicsState(),
  );
}

type OperatorArg = Parameters<typeof PDFOperator.of>[1] extends (infer A)[] | undefined ? A : never;

/** `shows` inside a `/Span` whose `/ActualText` is `text`. */
export function withActualText(ctx: PageCtx, text: string, shows: readonly PDFOperator[]): PDFOperator[] {
  // A property list (`<< /ActualText … >>`) is an inline dictionary operand
  // of `BDC`; pdf-lib types operator arguments narrowly but serialises it.
  const props = ctx.page.doc.context.obj({ ActualText: PDFHexString.fromText(text) }) as unknown as OperatorArg;
  return [
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), props]),
    ...shows,
    PDFOperator.of(PDFOperatorNames.EndMarkedContent),
  ];
}

/**
 * Open a `/Span` marked-content sequence whose `/ActualText` is `text`
 * around everything painted until {@link endActualTextSpan}: a whole line
 * set in pieces. A composed CJK line is painted segment by segment with
 * gaps between them — characters spread for justification, the space
 * between Han and Latin — which text extraction reads as word spaces
 * ("我 们 用 iPhone"); the span gives it the line as written. The tagger's
 * open sequence is closed first, and again before the span ends, so the
 * structure's sequences nest inside it.
 */
export function beginActualTextSpan(ctx: PageCtx, text: string, state: LineTextState): void {
  ctx.tags?.close();
  ctx.readSpans = (ctx.readSpans ?? 0) + 1;
  const props = ctx.page.doc.context.obj({ ActualText: PDFHexString.fromText(text) }) as unknown as OperatorArg;
  ctx.page.pushOperators(
    ...lineTextState(ctx, state),
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), props]),
  );
}

/** Where a line's text starts and what it is set in: the face and size of
 *  its first text, and that text (which file of a face made of several
 *  draws it). */
export interface LineTextState {
  font: PDFFont;
  text: string;
  sizePx: number;
  xPx: number;
  baselinePx: number;
}

/** A text object that shows nothing and leaves the line's font, size and
 *  position as the text state: every piece of a line restores the
 *  graphics state it painted in, and a reader that places an
 *  `/ActualText` with the text state in force where the span begins or
 *  ends (poppler) would otherwise give the line no height and misplace it
 *  in reading order. The font is the file the line's first text is drawn
 *  from, so nothing is embedded for it. */
function lineTextState(ctx: PageCtx, state: LineTextState): PDFOperator[] {
  const { scale, pageHeightPt } = ctx;
  const font = fileRuns(state.font, state.text)[0]?.font ?? state.font;
  return [
    beginText(),
    setFontAndSize(fontKeyOn(ctx.page, font), state.sizePx * scale),
    setTextMatrix(1, 0, 0, 1, state.xPx * scale, pageHeightPt - state.baselinePx * scale),
    endText(),
  ];
}

/** The text a composed CJK line is read as when its segments are painted
 *  apart (see {@link beginActualTextSpan}): the segments' text, when one
 *  of them carries tracking, is a Han–Latin space, is a mark that gave up
 *  blank (its glyph painted over its neighbour's box, `inkOffset`), hangs,
 *  is a ruby base (the line reads its base, not the reading painted over
 *  it), a warichu note's part (read once, upper row first) or a character
 *  with kanbun marks (read with its 送り仮名, {@link readText}); else
 *  undefined. */
export function cjkLineText(segments: readonly { text: string; tracking?: number; autospace?: boolean; inkOffset?: number; hangs?: boolean; ruby?: unknown; warichu?: unknown; kunten?: { okuri?: string } }[]): string | undefined {
  return segments.some((s) => s.autospace || s.tracking !== undefined || s.inkOffset !== undefined || s.hangs || s.ruby || s.warichu || s.kunten)
    ? segments.map(readText).join('')
    : undefined;
}

/** A segment's text as it is read: a character with kanbun marks (#430)
 *  is followed by its 送り仮名 (`學ビテ`, as kanbun is typed with them);
 *  its 返り点 are reading-order marks, left out. */
export function readText(s: { text: string; kunten?: { okuri?: string } }): string {
  return s.kunten?.okuri ? s.text + s.kunten.okuri : s.text;
}

/**
 * The character spacing (`Tc`, px) a CJK mark that gave up blank is shown
 * with (`inkOffset` set): painted `-inkOffset` before its box, its glyph
 * then advances to where its segment ends, so the box a reader gives the
 * glyph (its advance plus `Tc`) never runs over the next character's —
 * poppler read a compressed `：` over the `「` after it as a line break.
 * Undefined for any other segment, or when the font cannot measure it.
 */
export function compressedMarkSpacingPx(
  font: PDFFont,
  seg: { text: string; width: number; inkOffset?: number; inkScale?: number },
  sizePx: number,
): number | undefined {
  if (seg.inkOffset === undefined || !(sizePx > 0)) return undefined;
  let advance = 0;
  let glyphs = 0;
  for (const { font: file, text } of fileRuns(font, seg.text)) {
    const run = shownRun(file, text);
    if (!run) return undefined;
    advance += run.advance;
    glyphs += run.glyphs;
  }
  // Character spacing follows every glyph: only a mark shown as one.
  if (glyphs !== 1) return undefined;
  // A stretched glyph (`inkScale`, shown with `Tz`): the scaling applies
  // to the character spacing as well.
  return (seg.width - seg.inkOffset) / (seg.inkScale ?? 1) - (advance / 1000) * sizePx;
}

/** Close the span {@link beginActualTextSpan} opened, with the line's text
 *  state in force (see `lineTextState`). */
export function endActualTextSpan(ctx: PageCtx, state: LineTextState): void {
  ctx.tags?.close();
  ctx.readSpans = Math.max(0, (ctx.readSpans ?? 0) - 1);
  ctx.page.pushOperators(
    ...lineTextState(ctx, state),
    PDFOperator.of(PDFOperatorNames.EndMarkedContent),
  );
}

export function pushClipRect(
  ctx: PageCtx,
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
): void {
  const { scale, pageHeightPt } = ctx;
  const x = xPx * scale;
  const y = pageHeightPt - (yPx + hPx) * scale;
  const width = wPx * scale;
  const height = hPx * scale;
  // Marked content must nest inside the graphics state it was opened in.
  ctx.tags?.close();
  ctx.page.pushOperators(
    pushGraphicsState(),
    rectangle(x, y, width, height),
    clip(),
    endPath(),
  );
}

export function popClip(ctx: PageCtx): void {
  ctx.tags?.close();
  ctx.page.pushOperators(popGraphicsState());
}

/** Bézier handle length of a quarter circle, as a fraction of its radius. */
const KAPPA = 0.5522847498;

/** Path operators tracing a rounded outline given in px (top-down), in the
 *  points of the current frame. Corners of radius 0 stay square. */
function roundedOutlineOps(ctx: PageCtx, o: RoundedOutline): PDFOperator[] {
  const { scale, pageHeightPt } = ctx;
  const X = (px: number) => px * scale;
  const Y = (py: number) => pageHeightPt - py * scale;
  const { x, y, width: w, height: h } = o;
  const [tl, tr, br, bl] = o.radii;
  const k = KAPPA;
  const ops: PDFOperator[] = [moveTo(X(x + tl), Y(y)), lineTo(X(x + w - tr), Y(y))];
  if (tr > 0) ops.push(appendBezierCurve(X(x + w - tr + tr * k), Y(y), X(x + w), Y(y + tr - tr * k), X(x + w), Y(y + tr)));
  ops.push(lineTo(X(x + w), Y(y + h - br)));
  if (br > 0) ops.push(appendBezierCurve(X(x + w), Y(y + h - br + br * k), X(x + w - br + br * k), Y(y + h), X(x + w - br), Y(y + h)));
  ops.push(lineTo(X(x + bl), Y(y + h)));
  if (bl > 0) ops.push(appendBezierCurve(X(x + bl - bl * k), Y(y + h), X(x), Y(y + h - bl + bl * k), X(x), Y(y + h - bl)));
  ops.push(lineTo(X(x), Y(y + tl)));
  if (tl > 0) ops.push(appendBezierCurve(X(x), Y(y + tl - tl * k), X(x + tl - tl * k), Y(y), X(x + tl), Y(y)));
  ops.push(closePath());
  return ops;
}

/** Push a graphics state clipped to a rounded outline (px); undo with
 *  {@link popClip}. */
export function pushClipOutline(ctx: PageCtx, o: RoundedOutline): void {
  ctx.tags?.close();
  ctx.page.pushOperators(pushGraphicsState(), ...roundedOutlineOps(ctx, o), clip(), endPath());
}

/** Fill a rounded outline (px). */
export function fillOutlinePx(ctx: PageCtx, o: RoundedOutline, color: Color): void {
  ctx.page.pushOperators(
    pushGraphicsState(),
    ...opt(alphaStateOp(ctx, alphaOf(color))),
    setFillingColor(color),
    ...roundedOutlineOps(ctx, o),
    fill(),
    popGraphicsState(),
  );
}

/** The box of an inline chip (`:chip[…]`) whose segment starts at `xPx` on
 *  a line of baseline `baselinePx`: the fill, then the outline stroked
 *  inside the box edge (the text runs are painted by the caller). */
export function drawChipBoxPx(ctx: PageCtx, chip: VDTChip, xPx: number, baselinePx: number): void {
  const x = xPx + chip.marginLeft;
  const y = baselinePx - chip.ascent;
  const h = chip.ascent + chip.descent;
  const r = chip.borderRadius;
  if (chip.background) {
    fillOutlinePx(ctx, { x, y, width: chip.boxWidth, height: h, radii: [r, r, r, r] }, colorFromHex(chip.background, ctx.colorSpace));
  }
  if (chip.borderColor && chip.borderWidth > 0) {
    const half = chip.borderWidth / 2;
    const ri = Math.max(0, r - half);
    strokeOutlinePx(
      ctx,
      { x: x + half, y: y + half, width: chip.boxWidth - chip.borderWidth, height: h - chip.borderWidth, radii: [ri, ri, ri, ri] },
      colorFromHex(chip.borderColor, ctx.colorSpace),
      chip.borderWidth,
    );
  }
}

/** Stroke a rounded outline (px) `thicknessPx` wide, centred on it. */
export function strokeOutlinePx(ctx: PageCtx, o: RoundedOutline, color: Color, thicknessPx: number): void {
  ctx.page.pushOperators(
    pushGraphicsState(),
    ...opt(alphaStateOp(ctx, 1, alphaOf(color))),
    setStrokingColor(color),
    setLineWidth(Math.max(0.01, thicknessPx * ctx.scale)),
    ...roundedOutlineOps(ctx, o),
    stroke(),
    popGraphicsState(),
  );
}
