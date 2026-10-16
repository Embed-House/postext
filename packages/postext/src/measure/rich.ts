import { FORCED_BREAK, measureForcedBreaks } from './hardBreaks';
import { placeTab, type TabLeaderPlacement, type TabRun, type TabStopPx } from './tabs';
import type { TabStopAlign } from '../types';
import type { VDTAnnotationRun, VDTChip, VDTChipRun, VDTLine, VDTLineSegment, VDTSegmentMarks } from '../vdt';
import { uprightArabicSpans, uprightFace } from '../uprightArabic';
import { createBoundingBox } from '../vdt';
import type { MathRender } from '../math/types';
import type { InlineSpan } from '../parse';
import { getHyphenationRulesKey, hyphenateByDictionary, hyphenateText, softHyphenBreaks, withoutSlashJoints } from '../hyphenate';
import {
  richTokensToItems,
  computeBreakpoints,
  reconstructRichLines,
} from '../knuthPlass';
import { SOFT_HYPHEN } from './types';
import { lineStartAt, lineWidthAt, lineWidthFunction, markInsetLines, uniformMeasureFrom, type MeasuredBlock, type MeasureBlockOptions } from './types';
import { cleanSoftHyphens, getMeasureLanguage, measureTextWidth, normalSpaceWidthFor, setMeasureLanguage, withMeasureLanguage } from './canvas';
import { spanShapingLanguage } from './spanLanguage';
import { isRuntLastLine } from './runts';
import { hasOverfullLine } from './plain';
import { justifiedSpaceRatios } from './spaceRatios';
import { quoteFamily } from './font';
import { findPxSize, splitAtFontSize, withPxSize } from './fontString';
import { trimChipLineEdges } from './chipEdges';
import { directChipRuns, measuresRunsAsPainted, paintedRunWidth } from '../design/bidiText';
import { cjkJoinBreaks, hasCJK } from './cjk';
import { composeCjkParagraph, cjkWordBreaks, composesAsCjk, composesDashRow, spanMarks, type CjkWordBreaks } from './cjkCompose';
import { getCjkComposition } from './cjkPunctuation';
import { graphemeCount, graphemesOf } from './graphemes';
import { CENTRAL, sideMarkerRun } from './cjkAnnotate';
import { fontEm, getMeasureRegion, getMeasureUprightDigits, getMeasureWritingMode, lineBaselineOffset, mayHoldVerticalCell, measuringVertically, verticalTextWidth, withMeasureWritingMode } from './vertical';
import { latinReader, uprightDigitCandidates } from '../writingMode';
import { sliceSpan } from '../parse/links';
import type { CjkRegion } from '../types';
import { NO_BREAK_SPACES, WORDS_AND_SPACES_RE, isBlankText, isBreakingSpace, isBreakingSpaceRun, refLabelPieces } from './spaces';
import { breaksAfterDash, breaksAfterHardHyphen, hasCompound, isDash, raggedStretchPx } from './breakRules';
import { GEMINATE_DOT, endsInsideGeminate, withLineEndHyphen } from './geminate';
import { insideJoiningWord, joiningScriptIn, wordLetterSpacing } from './joining';
import { applyLineDirections, applySegmentLanguages, getMeasureArabicNumbers, getMeasureDirection, spanLanguages } from './bidiLines';
import { TATWEEL, justifyLinesWithKashida, kashidaCapacity } from './kashida';
import { needsBidi, resolveParagraph, spanIsolates, type BidiIsolate, type BidiParagraph } from '../bidi';
import { cutDoubledMarks, faceReadsScript, getMeasureScriptContext, isDoubledMark, isLetterless, pieceScriptContext, resolveScriptContext, rtlTextWidth, scriptAt, scriptContextUntracked, scriptTextWidth, wordPieceScript, type ScriptContext } from './script';

export interface RichBreakPoint {
  charIndex: number;
  widthBefore: number;
  /** The line ends on the character before `charIndex` as it is — a hard
   *  hyphen the word already carries — and no hyphen is added. */
  bare?: boolean;
  /** A soft hyphen typed in the source: the author's own break, taken like
   *  a dictionary syllable (a hyphen is added) but never held back by the
   *  hyphenation zone of ragged text or its two-line cap. */
  author?: boolean;
  /** A break inside a run with no spaces that is no hyphenation point:
   *  between two ideographs, or after a dash between two words. The line
   *  ends as it is, nothing is added, and no hyphenation penalty applies. */
  free?: boolean;
  /** Taken only by the greedy breaker (ragged lines, and justified ones
   *  without optimal line breaking), as pretext's breaker takes it on plain
   *  paragraphs; Knuth–Plass does not break here on either path. */
  greedyOnly?: boolean;
  /** A `free` break next to a CJK character: the line it ends is not
   *  `hyphenated`, so the column-end hyphen rules leave it alone. */
  cjk?: boolean;
  /** A syllable break inside a Catalan `l·l`: the hyphen takes the place of
   *  the middle dot (`il-` | `lusió`), whose width, here, the line ending
   *  at this break gives back. In a document shaped in its own language
   *  it is what the text up to the dot is narrower than the text with it
   *  (`col` against `col·`): the head is then as wide as `col` and its
   *  hyphen, the two texts painted (#770). */
  replacesWidth?: number;
  /** Knuth–Plass, in a document shaped in its own language (#770): what
   *  the rest of the word, set from this break at a line's start as a text
   *  of its own, is wider than the pieces after the break measured inside
   *  the word (negative: narrower). See {@link RichToken.ownPieces}. */
  restShift?: number;
}

export interface RichToken {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Superscript / subscript token: measured and painted with `scriptFont`
   *  (the span font at the script size) and painted `baselineShift` px
   *  below the baseline (negative: above). */
  script?: 'sup' | 'sub';
  scriptFont?: string;
  baselineShift?: number;
  /** The Arabic words of a slanted style set upright (`InlineSpan.upright`):
   *  the face they are measured and painted in, the span's with its slant
   *  taken off. */
  faceFont?: string;
  /** An inline footnote marker at a size of its own
   *  (`footnotes.markerSize`): the font it is measured and painted with,
   *  on the baseline. */
  markerFont?: string;
  /** One of a subscript and a superscript set over each other (see
   *  {@link stackedScriptPairs}): the `first` has width 0, the `second`
   *  the pair's advance. Neither is ever broken or hyphenated. */
  stacked?: 'first' | 'second';
  /** Small capitals: `text` keeps its own case (hyphenation reads it) and
   *  `width` is the synthesised small caps' (see {@link smallCapsWidth});
   *  the line's segments are split into capital runs once it is broken. */
  smallCaps?: boolean;
  kind: 'text' | 'space';
  width: number;
  breakPoints?: RichBreakPoint[];
  hyphenWidth?: number;
  /** The break points are bare (a URL / DOI broken after a slash or before
   *  a dot): the line ends without a hyphen and nothing is appended. */
  bareBreaks?: boolean;
  /** When present, this token is an atomic math formula. `text` is a single
   *  `\uFFFC` placeholder and `width` is the math render's widthPx. */
  mathRender?: MathRender;
  /** When present, this token is an inline `:ref{\u2026}` to a resource. `text`
   *  already carries the resolved label; the token is atomic (never wraps
   *  apart) and the id flows onto the segment so renderers can colour/link it. */
  refResourceId?: string;
  /** The reference names an anchor (#262): `refResourceId` is its id. */
  refAnchor?: true;
  /** The book page index the anchor landed on, when known. */
  refPageIndex?: number;
  /** A later piece of a reference whose label breaks at its spaces (#702,
   *  {@link refLabelTokens}): a word after the first, or a space between
   *  two of them. Its segment is flagged `refContinues`. */
  refContinues?: true;
  /** A footnote marker (`[^id]`): atomic like a reference; the id flows
   *  onto the segment. */
  footnoteId?: string;
  /** A footnote marker set in the line gap (`footnotes.markerPosition:
   *  'side'`): what is painted there; the token is 0 wide (see
   *  `VDTLineSegment.sideMarker`). */
  sideRuns?: VDTAnnotationRun[];
  /** A footnote marker set flush with the right side of a vertical line
   *  (`footnotes.markerPosition: 'right'`): how far its baseline moves
   *  across the line (negative: right), px, for its em box at
   *  `markerFont` to end where the line's does. */
  markerShift?: number;
  /** True when this token belongs to a caption's numbered label. Flows to the
   *  segment so renderers can apply the label colour. */
  captionLabel?: boolean;
  /** {@link InlineSpan.labelTab}: a space whose width {@link setLabelTabs}
   *  sets. */
  labelTab?: 'lead' | 'gap';
  /** When present, this token is an inline colour swatch (`:swatch{…}`): an
   *  atomic square of `width` px, filled with `color` (hex) when resolved. */
  swatch?: { color?: string };
  /** When present, this token is an inline chip (`:chip[…]`): an atomic box
   *  of `width` px (margins included) with its own text runs. */
  chip?: VDTChip;
  /** The chip style's gap (px), read when the word spaces around the chip
   *  are sized (see {@link applyChipGaps}). */
  chipGap?: number;
  /** A space inside inline code (`InlineSpan.codeSpace`, #845): the line
   *  may break at it, but justification neither stretches nor shrinks it. */
  fixedGlue?: true;
  /** Vertical text: a `:tcy[…]` run, one upright cell of one em (see
   *  `VDTLineSegment.tcy`). */
  tcy?: true;
  /** Vertical text: a `:upright[…]` or `:sideways[…]` run (see
   *  `VDTLineSegment.orientation`). */
  orientation?: 'upright' | 'sideways';
  /** The token ends on a dash a line may end after, and the next token
   *  touches it: a run in another style, as in `riddles—*and*` (see
   *  {@link markDashJoins}). The line may break between the two. */
  dashJoin?: boolean;
  /** Chinese marks on the token's text (#193), for the segment. */
  cjkMarks?: VDTSegmentMarks;
  /** Characters the layout added (a book title's 《》). */
  inserted?: boolean;
  /** One word of a joining script set in more than one style
   *  (`كتا**ب**`), joined from the runs its spans cut it into (see
   *  {@link joinStyledRuns}): each run's text and style, in order. The
   *  token is measured whole, in the style of its longest run (`bold`,
   *  `italic`), and becomes one segment painted as one shaped word
   *  (`VDTLineSegment.runs`). */
  runs?: { text: string; bold?: boolean; italic?: boolean }[];
  /** How far kashidas may widen this word, px: its box's stretch in
   *  Knuth–Plass (`measure/kashida.ts`). Absent on any other token. */
  kashida?: number;
  /** A tab (#622, `InlineSpan.tab`): a `space` token whose width the line
   *  breaker sets where its line has got to (`measure/tabs.ts`); `stop` is
   *  the one-off stop of `:tab{at=…}`. Never skipped at a line's start nor
   *  trimmed at its end. */
  tab?: { stop?: TabStopPx };
  /** A tab placed at its stop: the stop (see `VDTLineSegment.tab`) and its
   *  leader (see {@link setTabbedLine}). */
  tabPlaced?: { align: TabStopAlign; at: number };
  tabLeader?: TabLeaderPlacement;
  /** A word with no letter, in a face that draws punctuation by script
   *  (#725, `measure/script.ts`): the script it was measured in and is
   *  painted in (`VDTLineSegment.scriptContext`); `scriptRtl` when it was
   *  measured as a right-to-left word (its bidi level is odd). `scriptRtl`
   *  alone: a right-to-left word with letters in such a face, measured in
   *  a context set right to left, as it is painted (`rtlTextWidth`).
   *  Absent on every other token. */
  scriptContext?: ScriptContext;
  scriptRtl?: true;
  /** The language of the run this word is of, when the run names its own
   *  and the document is shaped in its own (`:ltr[…]{lang=en}`, #764): what
   *  is measured of the word later (a cut, a piece) is measured in it. */
  lang?: string;
  /** A word with a letter that may be painted in pieces with none
   *  (`10.1006/ijhc.2001`): the script in force where its text starts,
   *  which such a piece takes when no letter stands before it in the text
   *  (`pieceScriptContext`). */
  wordScript?: ScriptContext;
  /** In a document shaped in its own language (#770): the two halves of
   *  this word, broken at a line end, are each measured as the text
   *  painted. The rest that opens the next line is measured from the break
   *  on (`lar`, not `instal·lar` less `instal·`), and its later pieces as
   *  that text grows by them ({@link ownRest}). The value is the tracking
   *  each of its characters was measured with, px. Absent in a document
   *  that keeps the host's language, and on a word that holds CJK
   *  characters (measured unit by unit, so its rest is already its own). */
  ownPieces?: number;
}

/** Whether a resolved swatch colour can fill the square: a six- or
 *  eight-digit hex (`#rrggbb`, `#rrggbbaa`) or an `rgb()` / `rgba()`
 *  colour. Anything else leaves the swatch an empty outline. */
export function isSwatchFill(color: string): boolean {
  return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^rgba?\([^()]*\)$/i.test(color);
}

/** Side of an inline colour swatch: three quarters of the font size (the
 *  height of a capital), read from the `px` size of the CSS font string. */
export function swatchSidePx(font: string): number {
  const m = findPxSize(font);
  const size = m ? Number(m.value) : 16;
  return Math.max(1, size * 0.75);
}

export function pickSpanFont(
  bold: boolean,
  italic: boolean,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): string {
  if (bold && italic) return boldItalicFont;
  if (bold) return boldFont;
  if (italic) return italicFont;
  return normalFont;
}

/** Superscripts and subscripts are set at this fraction of the text size
 *  (the compositor's default). */
export const SCRIPT_SIZE_RATIO = 0.583;
/** A superscript rises this fraction of the text size: a third of an em,
 *  as browsers raise `vertical-align: super`. */
export const SUPERSCRIPT_SHIFT_RATIO = 0.333;
/** A subscript drops this fraction of the text size (EF-80): 0.15 em, the
 *  drop TeX gives a subscript alone (σ16 of its text fonts, MathJax's
 *  `$T_0$`), which keeps a figure inside the descender line. It used to
 *  drop as far as a superscript rises, and hung below the descenders. */
export const SUBSCRIPT_SHIFT_RATIO = 0.15;
/** A subscript stacked under a superscript (`T~0~^2^`) drops this fraction
 *  of the text size instead: 0.25 em, TeX's drop for a subscript with a
 *  superscript over it (σ17, 0.247 em), which clears room between the two. */
export const STACKED_SUBSCRIPT_SHIFT_RATIO = 0.25;
/** `font` at `scale` times its size. */
export function scaledFont(font: string, scale: number): string {
  return withPxSize(font, (size) => parseFloat(size) * scale);
}

/** The font a script token is measured and painted with (`font` at the
 *  script size) and its baseline shift in px (negative: up). `stacked`: a
 *  subscript with a superscript set over it, which drops further. */
export function scriptMetrics(font: string, script: 'sup' | 'sub', stacked = false): { font: string; baselineShift: number } {
  const m = findPxSize(font);
  const size = m ? parseFloat(m.value) : 0;
  const scaled = withPxSize(font, () => size * SCRIPT_SIZE_RATIO);
  const ratio = script === 'sup'
    ? -SUPERSCRIPT_SHIFT_RATIO
    : stacked ? STACKED_SUBSCRIPT_SHIFT_RATIO : SUBSCRIPT_SHIFT_RATIO;
  return { font: scaled, baselineShift: size * ratio };
}

/**
 * The subscripts and superscripts to stack (EF-80): a subscript and a
 * superscript that touch, with nothing between them (`T~0~^2^`, or
 * `T^2^~0~`), are set one over the other, as TeX sets `T_0^2`, not one after
 * the other. `scripts[i]` is the script of the i-th run of a line or word
 * (undefined for anything else); returns the index of the first run of each
 * pair. A run pairs once: after `x~a~^b^~c~` the `c` follows the pair.
 *
 * Stacked runs are painted at the same pen position: the first advances
 * nothing (its width becomes 0 and it is flagged `stacked`), the second
 * carries the pair's advance, the wider of the two — so every renderer that
 * paints runs one after another by their widths sets them stacked, and the
 * widths still add up to the line's.
 */
export function stackedScriptPairs(scripts: readonly ('sup' | 'sub' | undefined)[]): number[] {
  const firsts: number[] = [];
  for (let i = 0; i + 1 < scripts.length; i++) {
    const a = scripts[i];
    const b = scripts[i + 1];
    if (a && b && a !== b) {
      firsts.push(i);
      i++;
    }
  }
  return firsts;
}

/** Font a token is measured with: its span font, or the script font of a
 *  superscript / subscript. */
function tokenFont(
  t: { bold: boolean; italic: boolean; scriptFont?: string; faceFont?: string },
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): string {
  return t.scriptFont ?? t.faceFont ?? pickSpanFont(t.bold, t.italic, normalFont, boldFont, italicFont, boldItalicFont);
}

/** The script, small-caps and Chinese-mark fields a token derived from
 *  another (a split, a hyphenated head) carries on. */
function scriptOf(t: { script?: 'sup' | 'sub'; scriptFont?: string; baselineShift?: number; faceFont?: string; smallCaps?: boolean; cjkMarks?: VDTSegmentMarks; inserted?: boolean; scriptContext?: ScriptContext; scriptRtl?: true; lang?: string }): Pick<RichToken, 'script' | 'scriptFont' | 'baselineShift' | 'faceFont' | 'smallCaps' | 'cjkMarks' | 'inserted' | 'scriptContext' | 'scriptRtl' | 'lang'> {
  return {
    ...(t.script ? { script: t.script, scriptFont: t.scriptFont, baselineShift: t.baselineShift } : {}),
    ...(t.faceFont ? { faceFont: t.faceFont } : {}),
    ...(t.smallCaps ? { smallCaps: true } : {}),
    ...(t.cjkMarks ? { cjkMarks: t.cjkMarks } : {}),
    ...(t.inserted ? { inserted: true } : {}),
    // The pieces of a word with no letter are shaped in its script (#725).
    ...(t.scriptContext ? { scriptContext: t.scriptContext } : {}),
    ...(t.scriptRtl ? { scriptRtl: true as const } : {}),
    // And the pieces of a word of a run in another language in it (#764).
    ...(t.lang !== undefined ? { lang: t.lang } : {}),
  };
}

/** The script fields of the piece `[from, to)` of `token`, a head or a
 *  tail of it: the token's own when it is a word with no letter, or one
 *  measured right to left; else, for a word with a letter that may have
 *  pieces with none (`RichToken.wordScript`), the script of the piece when
 *  it holds no letter (it is then measured and painted in it), or the
 *  script in force where it starts, for the pieces cut from it later. */
function pieceScriptFields(token: Pick<RichToken, 'text' | 'scriptContext' | 'scriptRtl' | 'wordScript'>, from: number, to: number): Pick<RichToken, 'scriptContext' | 'scriptRtl' | 'wordScript'> {
  if (token.wordScript === undefined) return {};
  const script = pieceScriptContext(token.text, from, to, token.wordScript);
  if (script) return { scriptContext: script };
  const start = scriptAt(token.text, from, token.wordScript);
  return start ? { wordScript: start } : {};
}

/** The width of a word of a joining script (Arabic…), always painted
 *  right to left: measured so too in a face that draws its punctuation by
 *  script (#725, `rtlTextWidth`), so the bracket or the stop at its edge
 *  takes the forms it is painted in, and in every face in a document
 *  shaped in its own language (#770, see `rtlTextWidth`); as any text
 *  otherwise. */
function rtlWordWidth(text: string, font: string): number {
  return getMeasureScriptContext().enabled && !measuringVertically() && (faceReadsScript(font) || getMeasureLanguage() !== undefined) ? rtlTextWidth(text, font) : textWidth(text, font, false);
}

/** How a token's text is measured: in its script when it is a word with
 *  no letter given one (#725), else as any text (`textWidth`). */
function tokenTextWidth(token: Pick<RichToken, 'scriptContext' | 'scriptRtl' | 'smallCaps' | 'wordScript' | 'lang'>, font: string): (text: string) => number {
  // A word of a run in another language is measured in it (#764).
  if (token.lang !== undefined) {
    const { lang, ...rest } = token;
    const inner = tokenTextWidth(rest, font);
    return (text) => withMeasureLanguage(lang, () => inner(text));
  }
  const script = token.scriptContext;
  if (script) return (text) => (text === '' ? 0 : scriptTextWidth(text, font, script, token.scriptRtl === true));
  // A right-to-left word of a face that draws punctuation by script.
  if (token.scriptRtl) return (text) => (text === '' ? 0 : rtlTextWidth(text, font));
  // What opens a word before its first letter is measured in its script.
  const word = token.wordScript;
  if (word) return (text) => (isLetterless(text) ? scriptTextWidth(text, font, word, false) : textWidth(text, font, token.smallCaps));
  return (text) => textWidth(text, font, token.smallCaps);
}

/** How many characters of the rest of a word are measured with what
 *  follows the break (see {@link ownRest}): past any kerned pair,
 *  ligature or contextual form a face draws across one cut. */
const REST_WINDOW = 32;

/**
 * The rest of a word from the break at `from`, measured as the text a
 * line opens with (#770): the function gives the width of the word's
 * characters `[from, to)` set as a text of their own, `lead` (the hyphen
 * a compound repeats at the line's start) before them, with the tracking
 * the word was measured with.
 *
 * Up to postext 1.29 that rest was the whole word less what stayed on the
 * line above, and its pieces what the whole word grew by. The browser
 * measured those strings whole, so whatever the face draws across the
 * break stayed in the rest's box, and nothing paints it there. Crimson
 * Pro sets the dot of a Catalan `l·l` 0.586 em wide: `instal·lar` broken
 * as `instal-` | `lar` left `lar` a box of 28.54 px at 20 px for a text
 * painted 21.62 px wide. EB Garamond's `of-` | `fice` left 24.7 px for
 * 25.9 (the `ffi` ligature undone by the break), and Fira Sans's `lar`
 * 20.74 px for 24.36 (its `l·` ligature). Measured in Chrome 154.
 *
 * The pieces after the break are measured as that text grows, so a rest
 * that breaks again is right too, and the pieces a line carries add up to
 * the text painted. Only the first {@link REST_WINDOW} characters are
 * measured from the break; a piece that ends past them is what the word
 * grew by from there on, which no break before it changes. A word many
 * lines long then costs what a line of it does.
 *
 * `token` is the word as it stands (itself the rest of an earlier break,
 * or the whole word); a document that keeps the host's language never
 * asks.
 */
function ownRest(token: RichToken, from: number, font: string, lead = ''): (to: number) => number {
  const text = token.text;
  const spacing = token.ownPieces ?? 0;
  const tracked = (width: number, piece: string): number => (spacing === 0 ? width : width + spacing * graphemeCount(piece));
  const whole = tokenTextWidth(token, font);
  const before = (idx: number): number => (idx >= text.length ? token.width : tracked(whole(text.slice(0, idx)), text.slice(0, idx)));
  const rest = tokenTextWidth({ ...scriptOf(token), ...pieceScriptFields(token, from, text.length) }, font);
  const own = (piece: string): number => tracked(rest(piece), piece);
  let end = Math.min(text.length, from + REST_WINDOW);
  // Not between the two halves of a character outside the BMP.
  if (end < text.length && (text.charCodeAt(end) & 0xFC00) === 0xDC00) end++;
  let window: number | undefined;
  let anchor: number | undefined;
  return (to) => {
    if (to <= end) return own(lead + text.slice(from, to));
    window ??= own(lead + text.slice(from, end));
    anchor ??= before(end);
    return window + before(to) - anchor;
  };
}

/** The break points of `token` after `at`, for its rest measured as a
 *  text of its own (`width`, see {@link ownRest}): each as far into that
 *  text as it is, the dot of an `l·l` measured there too. */
function ownRestBreaks(token: RichToken, at: number, width: (to: number) => number, shift = 0): RichBreakPoint[] {
  return (token.breakPoints ?? [])
    .filter((b) => b.charIndex > at)
    .map((b) => {
      const { restShift: _shift, ...rest } = b;
      void _shift;
      const widthBefore = width(b.charIndex);
      return {
        ...rest,
        charIndex: b.charIndex - at + shift,
        widthBefore,
        ...(b.replacesWidth !== undefined ? { replacesWidth: widthBefore - width(b.charIndex - 1) } : {}),
      };
    });
}

/**
 * Knuth–Plass in a document shaped in its own language (#770): give each
 * break point of the words measured so ({@link RichToken.ownPieces}) what
 * the rest of its word is wider, opening the next line as a text of its
 * own, than the pieces after the break add up to
 * (`RichBreakPoint.restShift`). `lead`: the hyphen a compound repeats at
 * that line's start (`repeatHyphen`) is part of the text measured, and its
 * own width, which the breaker counts apart, is taken off.
 * One measure a break point, two for a rest longer than
 * {@link REST_WINDOW} characters.
 */
function markRestShifts(tokens: readonly RichToken[], fontOf: (token: RichToken) => string, repeatHyphen: boolean): void {
  for (const token of tokens) {
    if (token.ownPieces === undefined || !token.breakPoints) continue;
    const font = fontOf(token);
    for (const bp of token.breakPoints) {
      if (bp.greedyOnly) continue;
      const repeated = repeatHyphen && bp.bare === true && !token.bareBreaks;
      const own = ownRest(token, bp.charIndex, font, repeated ? '-' : '')(token.text.length);
      bp.restShift = own - (repeated ? token.hyphenWidth ?? 0 : 0) - (token.width - bp.widthBefore);
    }
  }
}

/** Small capitals are synthesised, the same way on every backend: a
 *  lowercase letter is set as its capital at this fraction of the text
 *  size, while capitals, digits and punctuation keep the full size — the
 *  ratio browsers use for a face without real small caps. */
export const SMALL_CAPS_SIZE_RATIO = 0.7;

/** `font` at the small-caps size. */
export function smallCapsFont(font: string): string {
  return withPxSize(font, (size) => parseFloat(size) * SMALL_CAPS_SIZE_RATIO);
}

/** A lowercase letter with a one-unit capital (`ß` and the like, whose
 *  capital is longer, stay as they are so the text keeps its length). */
function smallCapsLowered(ch: string): string | undefined {
  const up = ch.toUpperCase();
  return up !== ch && up.length === 1 ? up : undefined;
}

/** A text cut into runs of full-size characters and of lowercase letters
 *  (`small`, already set as capitals). */
export function smallCapsRuns(text: string): { text: string; small: boolean }[] {
  const runs: { text: string; small: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const up = smallCapsLowered(ch);
    const small = up !== undefined;
    const last = runs[runs.length - 1];
    if (last && last.small === small) last.text += up ?? ch;
    else runs.push({ text: up ?? ch, small });
  }
  return runs;
}

/** Advance of `text` set in small capitals from `font` (per-character
 *  tracking not included). */
export function smallCapsWidth(text: string, font: string): number {
  let small: string | undefined;
  let w = 0;
  for (const run of smallCapsRuns(text)) {
    w += measureTextWidth(run.text, run.small ? (small ??= smallCapsFont(font)) : font);
  }
  return w;
}

/** Advance of `text` in `font`, set in small capitals when `smallCaps`.
 *  In vertical text (`measuringVertically`) a character that stands in a
 *  cell of its own advances its cell (`verticalTextWidth`), as the
 *  renderers paint it, and so does a short number set in one cell
 *  (`cjk.uprightDigits`) and a Japanese pair of !? marks
 *  (`mayHoldVerticalCell`). */
export function textWidth(text: string, font: string, smallCaps: boolean | undefined): number {
  if (measuringVertically() && mayHoldVerticalCell(text)) {
    return verticalTextWidth(text, font, (run) => (smallCaps ? smallCapsWidth(run, font) : measureTextWidth(run, font)));
  }
  return smallCaps ? smallCapsWidth(text, font) : measureTextWidth(text, font);
}

/** Segments that still carry the small-caps flag of their token. */
export type PendingSegment = VDTLineSegment & { smallCaps?: boolean };

/**
 * Split every small-caps segment of the broken lines into runs painted as
 * they were measured: capitals at the segment's font, lowercase letters as
 * capitals at the small-caps size (a `fontString` of their own). The last
 * run absorbs any rounding so the segment keeps its measured width, and the
 * line text follows the painted case (the same length, so source maps
 * hold).
 */
export function expandSmallCaps(
  lines: VDTLine[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  letterSpacingPx: number,
): void {
  for (const line of lines) {
    const segs = line.segments as PendingSegment[] | undefined;
    if (!segs || !segs.some((s) => s.smallCaps)) continue;
    // A leader (#622) is no text of the line.
    const spelled = (list: readonly VDTLineSegment[]) => list.filter((s) => !s.leader).map((s) => s.text).join('');
    const before = spelled(segs);
    const out: VDTLineSegment[] = [];
    for (const seg of segs) {
      if (!seg.smallCaps) { out.push(seg); continue; }
      const rest: PendingSegment = { ...seg };
      delete rest.smallCaps;
      const runs = smallCapsRuns(seg.text);
      if (seg.kind !== 'text' || !runs.some((r) => r.small)) {
        out.push({ ...rest, text: runs.map((r) => r.text).join('') });
        continue;
      }
      const base = seg.fontString ?? pickSpanFont(!!seg.bold, !!seg.italic, normalFont, boldFont, italicFont, boldItalicFont);
      const small = smallCapsFont(base);
      let used = 0;
      runs.forEach((run, i) => {
        const font = run.small ? small : base;
        const width = i === runs.length - 1
          ? seg.width - used
          : measureTextWidth(run.text, font) + (letterSpacingPx + (line.letterSpacing ?? 0) + (seg.tracking ?? 0)) * graphemeCount(run.text);
        used += width;
        // Capitals keep the segment's own font (none for a plain run).
        const piece: VDTLineSegment = { ...rest, text: run.text, width };
        if (run.small || seg.fontString) piece.fontString = font;
        else delete piece.fontString;
        // A reference stays one reference: the later runs continue it.
        if (i > 0 && seg.refResourceId !== undefined) piece.refContinues = true;
        out.push(piece);
      });
    }
    line.segments = out;
    if (line.text === before) line.text = spelled(out);
  }
}

/** The text band of a chip box around the baseline, as fractions of the
 *  chip's font size: from the ascenders down past the descenders; the
 *  vertical padding and border grow it. */
export const CHIP_ASCENT_RATIO = 0.8;
export const CHIP_DESCENT_RATIO = 0.25;

/** `font` set in `family` (when given) at `sizePx`: the style and weight
 *  words of the CSS shorthand are kept. */
function withFace(font: string, family: string | undefined, sizePx: number): string {
  const m = splitAtFontSize(font);
  if (!m) return font;
  return `${m.prefix}${sizePx}px ${family ? quoteFamily(family) : m.family}`;
}

/**
 * One atomic token for an inline chip: its words measured run by run (the
 * span font — plus the chip style's bold / italic — at the chip's family
 * and size), boxed by the horizontal padding and border. The box height is
 * the chip's text band plus the vertical padding and border; it never
 * enters the line height. A chip span without a resolved box sets as bare
 * text.
 */
export function chipToken(
  span: InlineSpan,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  letterSpacingPx: number,
): RichToken {
  const chip = span.chip!;
  const box = chip.box;
  const sizeMatch = findPxSize(normalFont);
  const sizePx = box?.fontSizePx ?? (sizeMatch ? parseFloat(sizeMatch.value) : 16);
  const runs: VDTChipRun[] = [];
  // The script of each run, and the unscaled font of a subscript's (which
  // drops further when a superscript is stacked over it).
  const runScripts: ('sup' | 'sub' | undefined)[] = [];
  const runBaseFonts: string[] = [];
  for (const s of chip.spans) {
    if (s.text.length === 0) continue;
    const bold = s.bold || span.bold || !!box?.bold;
    const italic = s.italic || span.italic || !!box?.italic;
    // A word the chip's face has no letters for keeps the text's (#845).
    const base = withFace(pickSpanFont(bold, italic, normalFont, boldFont, italicFont, boldItalicFont), s.textFace ? undefined : box?.fontFamily, sizePx);
    let font = base;
    let baselineShift: number | undefined;
    if (s.script) {
      const m = scriptMetrics(font, s.script);
      font = m.font;
      baselineShift = m.baselineShift;
    }
    // Small capitals (the chip's own words or the text around the chip):
    // one run per capital / lowered stretch.
    const smallCaps = !!(s.smallCaps || span.smallCaps);
    const pieces = smallCaps
      ? smallCapsRuns(s.text).map((r) => ({ text: r.text, font: r.small ? smallCapsFont(font) : font }))
      : [{ text: s.text, font }];
    for (const piece of pieces) {
      runs.push({
        text: piece.text,
        fontString: piece.font,
        // A run of a joining script takes no tracking (`measure/joining.ts`).
        width: measureTextWidth(piece.text, piece.font) + wordLetterSpacing(piece.text, letterSpacingPx) * graphemeCount(piece.text),
        ...(bold ? { bold: true } : {}),
        ...(italic ? { italic: true } : {}),
        ...(baselineShift !== undefined ? { baselineShift } : {}),
      });
      runScripts.push(smallCaps ? undefined : s.script);
      runBaseFonts.push(base);
    }
  }
  // A subscript and a superscript that touch are stacked (EF-80).
  for (const i of stackedScriptPairs(runScripts)) {
    const first = runs[i]!;
    const second = runs[i + 1]!;
    const sub = runScripts[i] === 'sub' ? i : i + 1;
    runs[sub]!.baselineShift = scriptMetrics(runBaseFonts[sub]!, 'sub', true).baselineShift;
    second.width = Math.max(first.width, second.width);
    first.width = 0;
    first.stacked = true;
  }
  // Right-to-left runs cut where the direction changes, and their order
  // (`VDTChip.order`).
  // In a document shaped in its own language each is as wide as it is
  // painted, in its own direction, and the chip as wide as its runs (#770,
  // `measuresRunsAsPainted`).
  const asPainted = measuresRunsAsPainted();
  const directed = directChipRuns(
    runs,
    (t, f, rtl) => (asPainted ? paintedRunWidth(t, f, rtl) : measureTextWidth(t, f)) + wordLetterSpacing(t, letterSpacingPx) * graphemeCount(t),
    asPainted,
    box?.direction,
  );
  const textWidth = (asPainted ? directed.runs : runs).reduce((sum, r) => sum + r.width, 0);
  const paddingX = box?.paddingXPx ?? 0;
  const paddingY = box?.paddingYPx ?? 0;
  // A style may pad the top and the bottom apart (EF-172).
  const paddingTop = box?.paddingTopPx ?? paddingY;
  const paddingBottom = box?.paddingBottomPx ?? paddingY;
  const borderWidth = box?.borderWidthPx ?? 0;
  const boxWidth = textWidth + (paddingX + borderWidth) * 2;
  const ascent = sizePx * CHIP_ASCENT_RATIO + paddingTop + borderWidth;
  const descent = sizePx * CHIP_DESCENT_RATIO + paddingBottom + borderWidth;
  return {
    text: span.text,
    bold: span.bold,
    italic: span.italic,
    captionLabel: span.captionLabel,
    kind: 'text',
    width: boxWidth,
    chip: {
      styleId: box?.styleId ?? '',
      runs: directed.runs,
      ...(directed.order ? { order: directed.order } : {}),
      marginLeft: 0,
      marginRight: 0,
      boxWidth,
      ascent,
      descent,
      paddingX,
      borderWidth,
      borderRadius: Math.min(box?.borderRadiusPx ?? 0, (ascent + descent) / 2, boxWidth / 2),
      ...(box?.background ? { background: box.background } : {}),
      ...(box?.borderColor ? { borderColor: box.borderColor } : {}),
      ...(box?.color ? { color: box.color } : {}),
      ...(chip.joinNext ? { joinNext: true } : {}),
      // The words' source (#857), while the runs read as written.
      ...(chip.sourceOffsets && directed.runs.reduce((n, r) => n + r.text.length, 0) === chip.sourceOffsets.length ? { sourceOffsets: chip.sourceOffsets } : {}),
    },
    chipGap: box?.gapPx ?? 0,
  };
}

const LEADING_NO_BREAK_RE = new RegExp(`^[${NO_BREAK_SPACES}]+`);
const TRAILING_NO_BREAK_RE = new RegExp(`[${NO_BREAK_SPACES}]+$`);

/** A chip keeps at least its style's `gap` to a neighbour across a word
 *  space: a narrower space is topped up by a margin inside the chip's own
 *  advance (so justification, which stretches spaces only, never eats it).
 *  Between two chips the shortfall is shared, so the pair ends up exactly
 *  `gap` apart. Glued neighbours (punctuation) get nothing. A no-break
 *  space is a word space too, though it rides inside the word it glues:
 *  `noBreakWidth` measures the run of them a word opens or closes with. */
function applyChipGaps(tokens: RichToken[], noBreakWidth: (token: RichToken, run: string) => number): void {
  for (let i = 0; i < tokens.length; i++) {
    const space = tokens[i]!;
    // A tab makes its own room (#622), and a space inside inline code is
    // the code's own.
    if (space.kind !== 'space' || space.tab || space.fixedGlue) continue;
    const left = tokens[i - 1]?.chip ? tokens[i - 1]! : undefined;
    const right = tokens[i + 1]?.chip ? tokens[i + 1]! : undefined;
    if (!left && !right) continue;
    const gap = Math.max(left?.chipGap ?? 0, right?.chipGap ?? 0);
    const shortfall = gap - space.width;
    if (shortfall <= 0) continue;
    const share = left && right ? shortfall / 2 : shortfall;
    if (left) tokens[i - 1] = withChipMargins(left, 0, share);
    if (right) tokens[i + 1] = withChipMargins(right, share, 0);
  }
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]!;
    if (word.kind !== 'text' || word.chip || word.mathRender || word.swatch || word.refResourceId !== undefined || word.footnoteId !== undefined) continue;
    const lead = LEADING_NO_BREAK_RE.exec(word.text)?.[0];
    const trail = TRAILING_NO_BREAK_RE.exec(word.text)?.[0];
    const left = lead && tokens[i - 1]?.chip ? tokens[i - 1]! : undefined;
    const right = trail && tokens[i + 1]?.chip ? tokens[i + 1]! : undefined;
    if (!left && !right) continue;
    if (lead === word.text && left && right) {
      // Nothing but no-break spaces between two chips: they share it.
      const shortfall = Math.max(left.chipGap ?? 0, right.chipGap ?? 0) - word.width;
      if (shortfall > 0) {
        tokens[i - 1] = withChipMargins(left, 0, shortfall / 2);
        tokens[i + 1] = withChipMargins(right, shortfall / 2, 0);
      }
      continue;
    }
    if (left) {
      const shortfall = (left.chipGap ?? 0) - noBreakWidth(word, lead!);
      if (shortfall > 0) tokens[i - 1] = withChipMargins(left, 0, shortfall);
    }
    if (right) {
      const shortfall = (right.chipGap ?? 0) - noBreakWidth(word, trail!);
      if (shortfall > 0) tokens[i + 1] = withChipMargins(right, shortfall, 0);
    }
  }
}

function withChipMargins(token: RichToken, addLeft: number, addRight: number): RichToken {
  const chip = token.chip!;
  return {
    ...token,
    width: token.width + addLeft + addRight,
    chip: { ...chip, marginLeft: chip.marginLeft + addLeft, marginRight: chip.marginRight + addRight },
  };
}

/**
 * Tokenize inline spans into word/space tokens with bold/italic flags and measured widths.
 */
/** A word that is a URL or a bare DOI: never hyphenated by the dictionary,
 *  but breakable at its own joints so a long link cannot force an
 *  unfillable line. */
export const URL_LIKE_RE = /^(?:(?:https?|ftp):\/\/|www\.|10\.\d{4,}\/)\S+$/i;

/** Break opportunities inside a URL, following the usual editorial rule:
 *  after a slash (never inside the `//` of the scheme) or before a dot,
 *  hyphen or query/fragment punctuation, so the punctuation opens the next
 *  line and no hyphen is added. Never within the first few characters. */
export function urlBreakIndices(text: string): number[] {
  const out: number[] = [];
  for (let i = 4; i < text.length - 1; i++) {
    const prev = text[i - 1]!;
    const ch = text[i]!;
    if (prev === '/' && ch !== '/' && text[i - 2] !== '/') out.push(i);
    else if ('.?#&=_~%-'.includes(ch) && prev !== '/' && !'.?#&=_~%-'.includes(prev)) out.push(i);
  }
  return out;
}

interface SoftBreak {
  /** Offset into the word as laid out. */
  index: number;
  /** Typed in the source rather than found by the dictionary. */
  author: boolean;
}

/**
 * A word as laid out (its soft hyphens removed) and the breaks its soft
 * hyphens mark: the dictionary's when `hyphenate` is on, and the author's
 * own — the U+00AD the source carries between two letters or digits
 * (`softHyphenBreaks`), which the dictionary leaves as they are (it does not
 * hyphenate a word that already has them). The zero-width
 * space the dictionary puts after a slash is dropped: the rich breaker does
 * not break there, and it must not reach the line text. `byDictionary`
 * leaves the document's rules out (#699): every point of the patterns.
 */
function syllabify(word: string, hyphenate: boolean, byDictionary = false): { clean: string; soft: SoftBreak[] } {
  // A word of a joining script is never divided, not even at a soft hyphen
  // its author typed: its letters connect (`measure/joining.ts`).
  if (joiningScriptIn(word)) return { clean: word.includes(SOFT_HYPHEN) ? word.split(SOFT_HYPHEN).join('') : word, soft: [] };
  const hyphenated = hyphenate ? withoutSlashJoints(word, byDictionary ? hyphenateByDictionary(word) : hyphenateText(word)) : word;
  if (!hyphenated.includes(SOFT_HYPHEN)) return { clean: hyphenated, soft: [] };
  let clean = '';
  const soft: SoftBreak[] = [];
  let j = 0;
  for (let i = 0; i < hyphenated.length; i++) {
    const ch = hyphenated[i]!;
    // A soft hyphen the dictionary inserted is not the source's character.
    const fromSource = j < word.length && ch === word[j];
    if (fromSource) j++;
    if (ch !== SOFT_HYPHEN) clean += ch;
    // One the author typed at the word's edge or next to punctuation is no
    // break (#700).
    else if (!fromSource || softHyphenBreaks(word, j - 1)) soft.push({ index: clean.length, author: fromSource });
  }
  return { clean, soft };
}

/** Break opportunities inside a word (`clean`, the text as laid out):
 *  - after each soft hyphen, the dictionary's or the author's (`soft`); a
 *    hyphen is added when the line ends there;
 *  - after a hard hyphen between two letters — "enseñanza-aprendizaje" —
 *    where the line ends on the hyphen the word already carries;
 *  - after an em or en dash: with `dashBreaks`, one set closed between words
 *    as `breaksAfterDash` reads it ("say—that’s", "riddles.—I"), for both
 *    breakers — `touching` is the end (the last two characters) of the word
 *    run this word touches, with no space in between, which a dash at the
 *    start of the word needs; without it, one between two letters
 *    ("largas—separadas"), for the greedy breaker only, as pretext breaks a
 *    plain paragraph there;
 *  - next to CJK characters, under the line-break rules of the document's
 *    `cjk.lineBreak` (`cjk`: the word's units, measured once each, whose
 *    running sums give the widths before its breaks). */
function wordBreakPoints(
  clean: string,
  soft: SoftBreak[],
  font: string,
  letterSpacingPx: number,
  smallCaps?: boolean,
  dashBreaks = false,
  touching?: string,
  cjk?: CjkWordBreaks,
  /** How the word's pieces are measured when not as any text: in the
   *  script of a word with no letter (#725). */
  measure?: (text: string) => number,
  /** A document shaped in its own language (#770): the head of a break
   *  inside an `l·l` is as wide as the text painted, `col` and its hyphen.
   *  Taking the dot's own width off `col·` is short of it where the face
   *  draws the two together: Lora ligates `l·`, and left `col-` 1.32 px
   *  narrower than painted at 20 px (36.14 px for 37.46); Fira Sans,
   *  0.2 px. */
  ownHeads = false,
): RichBreakPoint[] {
  const widthBefore = cjk
    ? cjk.widthBefore
    : (idx: number): number => (measure ? measure(clean.slice(0, idx)) : textWidth(clean.slice(0, idx), font, smallCaps)) + (letterSpacingPx === 0 ? 0 : letterSpacingPx * graphemeCount(clean.slice(0, idx)));
  const byIndex = new Map<number, RichBreakPoint>();
  const add = (bp: Omit<RichBreakPoint, 'widthBefore'>): void => {
    if (bp.charIndex <= 0 || bp.charIndex >= clean.length) return;
    // One break per position; the word's own hyphen wins over a soft one.
    const existing = byIndex.get(bp.charIndex);
    if (existing && !(bp.bare && !existing.bare)) return;
    byIndex.set(bp.charIndex, { ...bp, widthBefore: widthBefore(bp.charIndex) });
  };
  // The character at `k`, reading back into the run this word touches.
  const charAt = (k: number): string | undefined => (k >= 0 ? clean[k] : touching?.[touching.length + k]);
  for (let i = dashBreaks ? 0 : 1; i < clean.length - 1; i++) {
    const ch = clean[i]!;
    if (ch !== '-' && !isDash(ch)) continue;
    if (dashBreaks && ch !== '-') {
      if (breaksAfterDash(charAt(i - 1), ch, clean[i + 1], charAt(i - 2))) add({ charIndex: i + 1, free: true });
      continue;
    }
    if (i === 0 || !breaksAfterHardHyphen(clean[i - 1], clean[i + 1])) continue;
    add(ch === '-' ? { charIndex: i + 1, bare: true } : { charIndex: i + 1, free: true, greedyOnly: true });
  }
  for (const s of soft) {
    const geminate = endsInsideGeminate(clean.slice(0, s.index))
      ? { replacesWidth: ownHeads ? widthBefore(s.index) - widthBefore(s.index - 1) : textWidth(GEMINATE_DOT, font, smallCaps) + letterSpacingPx }
      : {};
    add(s.author ? { charIndex: s.index, author: true, ...geminate } : { charIndex: s.index, ...geminate });
  }
  if (cjk) for (const idx of cjk.breaks) add({ charIndex: idx, free: true, cjk: true });
  return [...byIndex.values()].sort((a, b) => a.charIndex - b.charIndex);
}

/**
 * A word wider than the whole line (a table cell, a narrow column): divide
 * it at the last no-break space that leaves a head that fits ("300 000 |
 * 000", nothing added), else at the last syllable that fits — the
 * dictionary's, a hyphen added — or, when none does, at the last character
 * that fits, so no word ever runs past its measure. A cut next to a hyphen
 * the word carries falls after it and adds none (`hard`): never "fisica-" |
 * "-universitaria" nor "fisica--". Null when not even one character fits,
 * or, with `syllablesOnly`, when no no-break space or syllable does.
 *
 * A word of a joining script (Arabic…) is never cut between its letters,
 * and no hyphen marks a cut in it: only at a no-break space, or where it
 * touches a run of another script (`ABCكتاب`), with nothing added. Null
 * when no such place fits: the word then runs past the measure, and the
 * line says so (`VDTLine.wordOverflow`).
 */
export function emergencySplit(
  token: RichToken,
  font: string,
  letterSpacingPx: number,
  lineMaxWidth: number,
  syllablesOnly = false,
): { head: RichToken; tail: RichToken; hard?: boolean } | null {
  const text = token.text;
  if (text.length < 2) return null;
  // Styled runs of one Arabic word (`RichToken.runs`) are one shaped word.
  if (token.runs) return null;
  const joining = joiningScriptIn(text);
  // The word was measured untracked (`wordLetterSpacing`): its pieces too.
  // So was a word with no letter shaped in the Arabic script (#725).
  const spacing = joining || scriptContextUntracked(token.scriptContext) ? 0 : letterSpacingPx;
  const hyphenW = measureTextWidth('-', font) + spacing;
  const measure = tokenTextWidth(token, font);
  const widthBefore = (idx: number): number => measure(text.slice(0, idx)) + (spacing === 0 ? 0 : spacing * graphemeCount(text.slice(0, idx)));
  const flags = { bold: token.bold, italic: token.italic, captionLabel: token.captionLabel, ...scriptOf(token) };
  // In a document shaped in its own language the rest is measured as the
  // text that opens the next line (#770, `ownRest`), with the tracking
  // this division measures the word with.
  const own = getMeasureLanguage() !== undefined && !measuringVertically() && !hasCJK(text) ? { ...token, ownPieces: spacing } : undefined;
  const restFrom = (at: number): RichToken => (own ? tailAfter(own, at, 0, font) : tailAfter(token, at, widthBefore(at)));
  // A group glued by no-break spaces too wide for any line: the space is
  // the least bad place to part it (EF-66). The line ends before it and the
  // next one opens after it.
  for (let idx = text.length - 2; idx >= 1; idx--) {
    if (!NO_BREAK_SPACES.includes(text[idx]!) || NO_BREAK_SPACES.includes(text[idx - 1]!)) continue;
    const headWidth = widthBefore(idx);
    if (headWidth > lineMaxWidth) continue;
    return {
      head: { ...flags, ...pieceScriptFields(token, 0, idx), text: text.slice(0, idx), kind: 'text', width: headWidth },
      tail: { ...restFrom(idx + 1), ...flags, ...pieceScriptFields(token, idx + 1, text.length) },
    };
  }
  // No hyphen where the cut falls next to an ideograph, or right after a
  // hyphen of the text.
  const afterHyphen = (idx: number): boolean => text[idx - 1] === '-';
  const markW = (idx: number): number => (joining || afterHyphen(idx) || hasCJK(text.slice(idx - 1, idx + 1)) ? 0 : hyphenW);
  const fits = (idx: number): boolean => widthBefore(idx) + markW(idx) <= lineMaxWidth;
  // The longest prefix that fits without its mark, found by doubling then
  // halving (prefix widths grow with their length): no cut past it fits,
  // so a word many lines long costs what one line of it does, not a
  // measurement of every prefix.
  let reach = 0;
  let over = text.length;
  for (let step = 1; reach + step < text.length; step *= 2) {
    if (widthBefore(reach + step) > lineMaxWidth) {
      over = reach + step;
      break;
    }
    reach += step;
  }
  while (over - reach > 1) {
    const mid = (reach + over) >> 1;
    if (widthBefore(mid) <= lineMaxWidth) reach = mid;
    else over = mid;
  }
  let at = 0;
  // The dictionary's syllables, as offsets into the text: `syllabify` maps
  // them past anything else the dictionary might put in.
  const { clean, soft } = syllabify(text, true);
  if (clean === text) {
    for (const s of soft) {
      if (s.index > 0 && s.index <= reach && fits(s.index)) at = s.index;
    }
  }
  // A word the document keeps whole (`hyphenation.exceptions`, capitalised
  // words, cited names) is still divided when it is wider than its measure:
  // at its entry's points above, else at the dictionary's syllables (#699).
  if (at === 0 && getHyphenationRulesKey() !== '') {
    const whole = syllabify(text, true, true);
    if (whole.clean === text) {
      for (const s of whole.soft) {
        if (s.index > 0 && s.index <= reach && fits(s.index)) at = s.index;
      }
    }
  }
  if (at === 0 && !syllablesOnly) {
    for (let idx = reach; idx >= 1; idx--) {
      // Not right before a hyphen of the text: the next line would open
      // on it.
      if (text[idx] === '-') continue;
      // Never between the letters of a word of a joining script.
      if (joining && insideJoiningWord(text, idx)) continue;
      if (fits(idx)) { at = idx; break; }
    }
  }
  if (at === 0) return null;
  const mark = markW(at) > 0 ? '-' : '';
  // A syllable inside an `l·l`: the hyphen takes the dot's place.
  const geminate = mark !== '' && endsInsideGeminate(text.slice(0, at));
  return {
    head: geminate
      ? { ...flags, text: withLineEndHyphen(text.slice(0, at)), kind: 'text', width: widthBefore(at - 1) + markW(at) }
      : { ...flags, ...pieceScriptFields(token, 0, at), text: text.slice(0, at) + mark, kind: 'text', width: widthBefore(at) + markW(at) },
    tail: { ...restFrom(at), ...flags, ...pieceScriptFields(token, at, text.length) },
    ...(afterHyphen(at) ? { hard: true } : {}),
  };
}

/** What is left of `token` after a cut at `at` (`cutWidth` px in): its text
 *  and width from there, the break points after the cut moved with it, and
 *  what they need (the hyphen's width; a web address's joints stay bare),
 *  so the next line breaks the rest where it could break the whole.
 *  With `font`, for a word whose halves are measured as the texts painted
 *  (`RichToken.ownPieces`, #770): the rest and its break points are
 *  measured from the cut on ({@link ownRest}), and `cutWidth` is not read. */
function tailAfter(token: RichToken, at: number, cutWidth: number, font?: string): RichToken {
  const own = font !== undefined && token.ownPieces !== undefined ? ownRest(token, at, font) : undefined;
  const residual = own
    ? ownRestBreaks(token, at, own)
    : (token.breakPoints ?? [])
      .filter((b) => b.charIndex > at)
      .map((b) => ({ ...b, charIndex: b.charIndex - at, widthBefore: b.widthBefore - cutWidth }));
  return {
    text: token.text.slice(at),
    bold: token.bold,
    italic: token.italic,
    kind: 'text',
    width: own ? own(token.text.length) : token.width - cutWidth,
    ...(residual.length > 0 ? { breakPoints: residual, hyphenWidth: token.hyphenWidth } : {}),
    ...(token.bareBreaks ? { bareBreaks: true } : {}),
    ...(token.dashJoin ? { dashJoin: true } : {}),
    ...(own ? { ownPieces: token.ownPieces } : {}),
  };
}

/** For each character of the spans' joined text, whether it sits in a
 *  compound: a run of text between breaking spaces with a hyphen between
 *  two letters (see `hasCompound`). */
function compoundMask(spans: readonly InlineSpan[]): boolean[] {
  const text = spans.map((s) => s.text).join('');
  const mask = new Array<boolean>(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    if (isBreakingSpace(text[i])) { i++; continue; }
    let j = i;
    while (j < text.length && !isBreakingSpace(text[j])) j++;
    if (hasCompound(text.slice(i, j))) mask.fill(true, i, j);
    i = j;
  }
  return mask;
}

/** The script fields of a span's tokens (the font at the script size, and
 *  the shift), none for text that is no superscript or subscript. */
export function spanScriptFields(
  span: InlineSpan,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): Pick<RichToken, 'script' | 'scriptFont' | 'baselineShift'> {
  if (!span.script) return {};
  const base = pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
  const m = scriptMetrics(base, span.script);
  return { script: span.script, scriptFont: m.font, baselineShift: m.baselineShift };
}

/** Whether a span sets something other than its text: a `:ref` or a
 *  note marker (its label), a chip, a swatch or a formula. The orientation
 *  marks of vertical text leave such a span as it is. */
export function setsObject(span: InlineSpan): boolean {
  return span.ref !== undefined || span.footnote !== undefined || span.chip !== undefined || span.swatch !== undefined || span.math !== undefined || span.mathRender !== undefined;
}

/** A stand-in for what a span sets other than its text (a chip, a
 *  formula, a swatch, a reading, a warichu note), or sets upright: no
 *  Latin text to a number beside it. */
const NOT_LATIN = '\uFFFC';
/** A stand-in for a note marker or a reference: looked past, as a space
 *  is (`printed in 49[^1] copies`). */
const LOOKED_PAST = '\u200B';

/**
 * Vertical text: `spans` with each short number that runs with Latin text
 * (`latinReader`: `printed in 49 and 32 copies`) set sideways, as
 * `:sideways[…]` sets it, where the words it runs with lie past a space or
 * in another span (#222). A line keeps each word of a vertical paragraph in
 * a segment of its own, and a segment alone would read such a number
 * without its neighbours and stand it upright (`uprightDigitRuns`): the
 * number is measured and painted sideways as the paragraph reads it,
 * also one whose marks touch it (`(49)`, `49,`): the words those lead to
 * may lie in another segment. A piece of the paragraph never reads a
 * number as Latin that the paragraph stands upright (`latinReader`), so
 * the numbers left alone read alike in every segment. Nothing changes
 * when `digits` is 0 or no span holds a digit.
 */
export function sidewaysNumberSpans(spans: InlineSpan[], digits: number, region: CjkRegion): InlineSpan[] {
  if (!(digits > 0)) return spans;
  const numbered = (s: InlineSpan): boolean => /[0-9]/.test(s.text) && !setsObject(s) && !s.ruby && !s.kunten && !s.warichu && !s.combineUpright && !s.orientation && !s.script;
  if (!spans.some(numbered)) return spans;
  // The paragraph as graphemes; a note marker or a reference is looked
  // past, and a span that sets something else than its text (a formula, a
  // chip, a reading, a warichu note) or that the author set upright is one
  // character that is not Latin.
  const all: string[] = [];
  const firsts: number[] = [];
  for (const s of spans) {
    firsts.push(all.length);
    if (s.footnote !== undefined || s.ref !== undefined) all.push(LOOKED_PAST);
    else if (setsObject(s) || s.ruby || s.kunten || s.warichu || s.combineUpright || s.orientation === 'upright') all.push(NOT_LATIN);
    else for (const g of graphemesOf(s.text)) all.push(g);
  }
  const latin = latinReader(all, region);
  let out: InlineSpan[] | undefined;
  spans.forEach((s, k) => {
    const own = numbered(s) ? graphemesOf(s.text) : undefined;
    const cuts: Array<[number, number]> = [];
    if (own) {
      for (const [i, n] of uprightDigitCandidates(own, digits)) {
        const from = firsts[k]! + i;
        if (latin(from, from + n)) cuts.push([i, i + n]);
      }
    }
    if (!own || cuts.length === 0) {
      out?.push(s);
      return;
    }
    out ??= spans.slice(0, k);
    const offset: number[] = [0];
    for (const g of own) offset.push(offset[offset.length - 1]! + g.length);
    let at = 0;
    for (const [a, b] of cuts) {
      if (offset[a]! > at) out.push(sliceSpan(s, at, offset[a]!));
      out.push({ ...sliceSpan(s, offset[a]!, offset[b]!), orientation: 'sideways' });
      at = offset[b]!;
    }
    if (at < s.text.length) out.push(sliceSpan(s, at));
  });
  return out ?? spans;
}

/**
 * The one token of a span that is set as a whole, or undefined for text:
 * - an inline `:ref` or a footnote marker: the resolved label (already in
 *   `text`) as one box that never wraps apart. Kind 'text' keeps the
 *   generic layout and renderers treating it as a word; `refResourceId` /
 *   `footnoteId` flow onto the segment for link colouring and PDF links;
 * - a chip: a box with its own runs, never broken or hyphenated inside;
 * - a swatch: one square the size of a capital;
 * - a formula: one box with the render's `widthPx`. Kind 'text' (not
 *   'space'), so trimming a line's trailing spaces never drops it.
 */
export function atomicSpanToken(
  span: InlineSpan,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  letterSpacingPx: number,
): RichToken | undefined {
  // Vertical text: a run the author set upright or sideways is one unit a
  // line never breaks inside (tate-chu-yoko one em, upright letters one em
  // each, a sideways run its horizontal width). A reference, a note
  // marker, a chip, a swatch or a formula keeps its own setting.
  if ((span.combineUpright || span.orientation) && measuringVertically() && span.text.length > 0 && !setsObject(span)) {
    const font = pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
    const em = fontEm(font);
    const count = span.combineUpright ? 1 : graphemeCount(span.text);
    const track = letterSpacingPx === 0 ? 0 : letterSpacingPx * count;
    return {
      text: span.text,
      bold: span.bold,
      italic: span.italic,
      captionLabel: span.captionLabel,
      kind: 'text',
      width: (span.combineUpright ? em : span.orientation === 'upright' ? em * count : measureTextWidth(span.text, font)) + track,
      ...(span.combineUpright ? { tcy: true as const } : { orientation: span.orientation! }),
    };
  }
  if (span.footnote?.place) return placedMarkerToken(span, span.footnote.place, pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont), letterSpacingPx);
  if (span.ref || span.footnote) {
    const scriptFields = spanScriptFields(span, normalFont, boldFont, italicFont, boldItalicFont);
    const scale = span.footnote?.scale;
    const markerFont = !span.script && scale !== undefined && scale > 0 && Math.abs(scale - 1) > 1e-6
      ? scaledFont(pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont), scale)
      : undefined;
    const refFont = scriptFields.scriptFont ?? markerFont ?? pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
    return {
      text: span.text,
      bold: span.bold,
      italic: span.italic,
      captionLabel: span.captionLabel,
      ...scriptFields,
      ...(markerFont ? { markerFont } : {}),
      ...(span.smallCaps ? { smallCaps: true } : {}),
      kind: 'text',
      width: textWidth(span.text, refFont, span.smallCaps) + (letterSpacingPx === 0 ? 0 : wordLetterSpacing(span.text, letterSpacingPx) * graphemeCount(span.text)),
      ...(span.ref ? { refResourceId: span.ref.resourceId, ...(span.ref.anchor ? { refAnchor: true as const } : {}), ...(span.ref.pageIndex !== undefined ? { refPageIndex: span.ref.pageIndex } : {}) } : {}),
      ...(span.footnote ? { footnoteId: span.footnote.id } : {}),
    };
  }
  if (span.labelTab) {
    const font = pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
    return {
      text: span.text,
      bold: span.bold,
      italic: span.italic,
      kind: 'text',
      width: textWidth(span.text, font, false) + (letterSpacingPx === 0 ? 0 : wordLetterSpacing(span.text, letterSpacingPx) * graphemeCount(span.text)),
      labelTab: span.labelTab,
    };
  }
  if (span.chip) return chipToken(span, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
  if (span.swatch) {
    const swatchFont = pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
    return {
      text: span.text,
      bold: span.bold,
      italic: span.italic,
      captionLabel: span.captionLabel,
      kind: 'text',
      width: swatchSidePx(swatchFont),
      swatch: isSwatchFill(span.swatch.color) ? { color: span.swatch.color } : {},
    };
  }
  if (span.math && span.mathRender) {
    return {
      text: span.text,
      bold: span.bold,
      italic: span.italic,
      captionLabel: span.captionLabel,
      kind: 'text',
      width: span.mathRender.widthPx,
      mathRender: span.mathRender,
    };
  }
  return undefined;
}

/**
 * The tokens of a reference whose label is words (`ref.breakable`, #702):
 * one per piece of the label (`refLabelPieces`: a word, with the number that
 * keeps to it, or a run of breaking spaces), or undefined for a label that
 * is one token ({@link atomicSpanToken}). A word is built as the whole
 * label is — the reference's font, no dictionary points, never divided —
 * and a space is an ordinary space of the line: a legal break, stretched
 * and shrunk with the others. Every piece carries the reference, so the
 * link has no holes; every piece after the first is flagged
 * `refContinues`, so the reference stays one position in the source. A
 * no-break space inside the label glues, as anywhere.
 */
export function refLabelTokens(
  span: InlineSpan,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  letterSpacingPx: number,
): RichToken[] | undefined {
  if (!span.ref?.breakable || span.footnote) return undefined;
  // A number, a Roman numeral or a single letter keeps to the word before
  // it: `Fig. 1a` is one piece, its space set as text.
  const parts = refLabelPieces(span.text);
  if (!parts) return undefined;
  const tokens: RichToken[] = [];
  for (const part of parts) {
    const token = atomicSpanToken({ ...span, text: part }, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
    if (!token) return undefined;
    if (isBreakingSpaceRun(part)) {
      token.kind = 'space';
      // A space has no capitals to shrink.
      delete token.smallCaps;
    }
    if (tokens.length > 0) token.refContinues = true;
    tokens.push(token);
  }
  return tokens;
}

/**
 * A footnote marker set apart from the text (`footnotes.markerPosition`,
 * JLReq §4.2.3), at its size (`span.footnote.scale` of `font`, the text's):
 * - `'side'`: an interlinear 合印 in the line gap over the text before it,
 *   a token 0 wide whose run is painted there ({@link sideMarkerRun});
 * - `'right'` (vertical text): an inline marker taking its advance down
 *   the line, its em box moved across to end where the line's ends, on
 *   the right (行右小書き).
 * Either is never broken from the text it marks (the CJK composer glues a
 * note marker to the unit before it; Latin text has no break point there).
 */
function placedMarkerToken(span: InlineSpan, place: 'side' | 'right', font: string, letterSpacingPx: number): RichToken {
  const scale = span.footnote?.scale ?? 1;
  const markerFont = Math.abs(scale - 1) > 1e-6 ? scaledFont(font, scale) : font;
  const em = fontEm(font);
  const base = {
    text: span.text,
    bold: span.bold,
    italic: span.italic,
    kind: 'text' as const,
    footnoteId: span.footnote!.id,
    markerFont,
  };
  if (place === 'side') return { ...base, width: 0, sideRuns: [sideMarkerRun(span.text, markerFont, em)] };
  // The marker's em box is centred `CENTRAL` of its em above its baseline,
  // the line's on the line's axis: moving it by the difference of the two
  // half-ems puts both boxes' right ends together.
  const markEm = fontEm(markerFont);
  const track = letterSpacingPx === 0 ? 0 : wordLetterSpacing(span.text, letterSpacingPx) * graphemeCount(span.text);
  return { ...base, width: textWidth(span.text, markerFont, false) + track, markerShift: -(em - markEm) * (CENTRAL + 0.5) };
}

/** The segment a token (or the part of one on a line) sets: its kind, text
 *  (soft hyphens removed), width and every flag the renderers read. Small
 *  capitals stay flagged until {@link expandSmallCaps} splits them. */
export function tokenSegment(t: RichToken): PendingSegment {
  const seg = {
    kind: t.mathRender ? 'math' : t.swatch ? 'swatch' : t.chip ? 'chip' : t.kind,
    text: cleanSoftHyphens(t.text),
    width: t.width,
    bold: t.bold || undefined,
    italic: t.italic || undefined,
    ...(t.mathRender ? { mathRender: t.mathRender } : {}),
    ...(t.swatch ? { swatch: t.swatch } : {}),
    ...(t.chip ? { chip: t.chip } : {}),
    ...(t.refResourceId !== undefined ? { refResourceId: t.refResourceId, ...(t.refAnchor ? { refAnchor: true as const } : {}), ...(t.refPageIndex !== undefined ? { refPageIndex: t.refPageIndex } : {}), ...(t.refContinues ? { refContinues: true } : {}) } : {}),
    ...(t.footnoteId !== undefined ? { footnoteId: t.footnoteId } : {}),
    ...(t.captionLabel ? { captionLabel: true } : {}),
    ...(t.labelTab || t.tab ? { labelTab: true as const } : {}),
    ...(t.script ? { script: t.script, fontString: t.scriptFont, baselineShift: t.baselineShift } : {}),
    ...(t.markerFont && !t.script ? { fontString: t.markerFont } : {}),
    ...(t.sideRuns ? { sideMarker: { runs: t.sideRuns } } : {}),
    ...(t.markerShift !== undefined ? { baselineShift: t.markerShift } : {}),
    ...(t.faceFont && !t.script ? { fontString: t.faceFont } : {}),
    ...(t.stacked === 'first' ? { stacked: true } : {}),
    ...(t.smallCaps ? { smallCaps: true } : {}),
  } as PendingSegment;
  // The fields of vertical and Chinese text, last, when set.
  if (t.tcy) seg.tcy = true;
  if (t.orientation) seg.orientation = t.orientation;
  if (t.cjkMarks) seg.cjkMarks = t.cjkMarks;
  if (t.inserted) seg.inserted = true;
  if (t.runs) seg.runs = t.runs;
  if (t.scriptContext) seg.scriptContext = t.scriptContext;
  return seg;
}

/**
 * Widen the spaces of a bibliography label (#290) so the entry's text
 * starts `columnPx` from the line's start: the gap after the label takes
 * what the label leaves of the column (its own width at least), or, with
 * a space before the label, that space takes it and the label ends against
 * the gap. `items` are a paragraph's tokens or units in order; `setWidth`
 * writes a new width.
 */
export function setLabelTabs<T extends { width: number }>(
  items: readonly T[],
  tabOf: (item: T) => 'lead' | 'gap' | undefined,
  columnPx: number,
  setWidth: (item: T, width: number) => void,
): void {
  const gapAt = items.findIndex((t) => tabOf(t) === 'gap');
  if (gapAt < 0) return;
  const leadAt = items.findIndex((t, i) => i < gapAt && tabOf(t) === 'lead');
  let label = 0;
  for (let i = leadAt + 1; i < gapAt; i++) label += items[i]!.width;
  const gap = items[gapAt]!;
  if (leadAt >= 0) setWidth(items[leadAt]!, Math.max(0, columnPx - gap.width - label));
  else setWidth(gap, Math.max(gap.width, columnPx - label));
}

function tokenizeSpans(
  spans: InlineSpan[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  shouldHyphenate: boolean,
  letterSpacingPx = 0,
  /** `MeasureBlockOptions.breakAfterDashes`. */
  dashBreaks = false,
  /** `MeasureBlockOptions.hyphenateCompounds === false`: the dictionary
   *  leaves the words of a compound whole. */
  keepCompounds = false,
  /** Whether the spans hold CJK characters (`hasCJK` of their text): only
   *  then is each word looked into. */
  cjkText = true,
  /** The paragraph's bidi levels (`measure/bidiLines.ts`), when it has
   *  right-to-left text: a word whose level changes inside it (`ABC،`,
   *  `و١٤٤٥`, `(API)` in Arabic) is cut there into words that touch, each
   *  measured as it is painted, as a run of its own direction. */
  bidi?: BidiParagraph,
  /** `keep-all` is in force for the block (its own `cjkWordBreak`, else
   *  the document's `cjk.wordBreak`): a word that holds CJK characters does
   *  not break between two letters (#705). */
  keepAll = false,
): RichToken[] {
  const tokens: RichToken[] = [];
  // Which characters of the joined text sit in a compound, a word (across
  // runs: "*after*-dinner") with a hyphen between two letters.
  const inCompound = keepCompounds && shouldHyphenate ? compoundMask(spans) : undefined;
  let spanStart = 0;
  // Tracking: every character (spaces included) advances `letterSpacingPx`
  // more, exactly as canvas `letterSpacing` / CSS `letter-spacing` / PDF `Tc`
  // paint it, so measured widths stay in step with the renderers. A word of
  // a joining script takes none: the renderers paint it untracked too.
  const track = (text: string): number => (letterSpacingPx === 0 ? 0 : wordLetterSpacing(text, letterSpacingPx) * graphemeCount(text));
  /** The script fields of a span's tokens (font at the script size, shift). */
  // The span's own face: its style's, unslanted for the Arabic words of a
  // slanted style (`uprightArabic.ts`).
  const faceOf = (span: InlineSpan): string => {
    const face = pickSpanFont(span.bold, span.italic, normalFont, boldFont, italicFont, boldItalicFont);
    return span.upright ? uprightFace(face) : face;
  };
  const scriptFieldsOf = (span: InlineSpan): Pick<RichToken, 'script' | 'scriptFont' | 'baselineShift' | 'faceFont'> => {
    if (!span.script) return span.upright ? { faceFont: faceOf(span) } : {};
    const m = scriptMetrics(faceOf(span), span.script);
    return { script: span.script, scriptFont: m.font, baselineShift: m.baselineShift };
  };
  const spanFont = (span: InlineSpan): string => scriptFieldsOf(span).scriptFont ?? faceOf(span);
  // A word with no letter takes the script of the text around it (#725),
  // in a face that draws its punctuation by script; the paragraph's text
  // and isolates are read when the first such word turns up.
  const scriptState = getMeasureScriptContext();
  // A document shaped in its own language measures the two halves of a
  // word broken at a line end as the texts painted (#770).
  const ownPieces = getMeasureLanguage() !== undefined && !measuringVertically();
  let paragraphText: string | undefined;
  let isolates: BidiIsolate[] | undefined;
  // `script` undefined: a word with letters. Right to left, it is measured
  // as it is painted (`rtlTextWidth`); left to right, the pieces of it
  // that hold no letter are measured and painted in `pieces`, the script
  // they have inside it (`wordPieceScript`).
  const contextOf = !scriptState.enabled || measuringVertically()
    ? undefined
    : (word: string, at: number, length: number, font: string): { script: ScriptContext | undefined; rtl: boolean; pieces?: ScriptContext } | undefined => {
        const rtl = bidi !== undefined && (bidi.levels[at]! & 1) === 1;
        // A face whose marks are the same in every script: no word of it
        // is given one, and a right-to-left word is still measured as it
        // is painted in a document shaped in its own language (#770).
        if (!faceReadsScript(font)) return rtl && getMeasureLanguage() !== undefined && !hasCJK(word) ? { script: undefined, rtl } : undefined;
        if (hasCJK(word)) return undefined;
        if (!isLetterless(word)) {
          if (rtl) return { script: undefined, rtl };
          const pieces = wordPieceScript(word);
          return pieces ? { script: undefined, rtl, pieces } : undefined;
        }
        // The Chinese or Japanese document's own ellipsis and dash.
        if (!rtl && scriptState.hanMarks && isDoubledMark(word)) return { script: 'Hani', rtl };
        paragraphText ??= bidi?.text ?? spans.map((sp) => sp.text).join('');
        isolates ??= spans.some((sp) => sp.direction) ? spanIsolates(spans) : [];
        const script = resolveScriptContext(paragraphText, at, at + length, rtl, isolates, scriptState.script);
        return script ? { script, rtl } : rtl ? { script: undefined, rtl } : undefined;
      };

  /** How a word in the context `contextOf` gave it is measured: whole
   *  (`whole`, undefined: as any text) and up to one of its breaks
   *  (`upTo`), the tracking it takes, and the fields its token carries. */
  const scriptMeasure = (context: ReturnType<NonNullable<typeof contextOf>>, font: string, sc: boolean): {
    whole?: (text: string) => number;
    upTo?: (text: string) => number;
    untracked: boolean;
    fields: Pick<RichToken, 'scriptContext' | 'scriptRtl' | 'wordScript'>;
  } => {
    if (!context) return { untracked: false, fields: {} };
    const { script, rtl, pieces } = context;
    const whole = script ? (text: string): number => (text === '' ? 0 : scriptTextWidth(text, font, script, rtl))
      : rtl ? (text: string): number => (text === '' ? 0 : rtlTextWidth(text, font))
      : undefined;
    // What stands before the word's first letter is measured in its
    // script; from that letter on, a shaper gives the text that script.
    const upTo = pieces
      ? (text: string): number => (text === '' ? 0 : isLetterless(text) ? scriptTextWidth(text, font, pieces, false) : textWidth(text, font, sc))
      : whole;
    return {
      ...(whole ? { whole } : {}),
      ...(upTo ? { upTo } : {}),
      untracked: scriptContextUntracked(script),
      fields: { ...(script ? { scriptContext: script } : {}), ...(rtl ? { scriptRtl: true as const } : {}), ...(pieces ? { wordScript: pieces } : {}) },
    };
  };

  for (const span of spans) {
    // A run that names its language (`:ltr[…]{lang=en}`) is measured in it,
    // in a document shaped in its own (#764); its tokens say so, for what
    // is measured of them later (a cut, a piece).
    const ownLanguage = spanShapingLanguage(span);
    const spanTokensFrom = tokens.length;
    const languageBefore = getMeasureLanguage();
    if (ownLanguage !== undefined) setMeasureLanguage(ownLanguage);
    try {
    const spanBase = spanStart;
    spanStart += span.text.length;
    // A tab (#622): its width is set where its line gets to it.
    // Tab characters in a row are one character of the text that goes on
    // that many stops: the later ones have no text.
    if (span.tab) {
      const tab = span.tab.px ? { stop: span.tab.px } : {};
      for (let k = 0; k < Math.max(1, span.tab.count ?? 1); k++) {
        tokens.push({ text: k === 0 ? span.text : '', bold: span.bold, italic: span.italic, kind: 'space', width: 0, tab });
      }
      continue;
    }
    // A reference whose label is words: one token per word and space (#702).
    const label = refLabelTokens(span, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
    if (label) {
      tokens.push(...label);
      continue;
    }
    const atomic = atomicSpanToken(span, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
    if (atomic) {
      tokens.push(atomic);
      continue;
    }
    const font = spanFont(span);
    // A space inside inline code (#845): as wide as the code face's own
    // spaces once the two pieces around it are one box, less the paddings
    // and borders the two pieces' boxes have on that side, which the joined
    // box drops (so an empty one, after a hyphen, is that much narrower
    // than nothing). A line may end there, but justification leaves it be.
    if (span.codeSpace) {
      const box = span.codeSpace;
      const codeFont = withFace(normalFont, box.fontFamily, box.fontSizePx);
      const inner = 2 * (box.paddingXPx + box.borderWidthPx);
      tokens.push({ text: span.text, bold: span.bold, italic: span.italic, kind: 'space', width: measureTextWidth(span.text, codeFont) - inner, fixedGlue: true });
      continue;
    }
    // A fixed space is set as text: no break, no justification glue.
    if (span.fixedSpace) {
      if (span.text.length > 0) {
        tokens.push({ text: span.text, bold: span.bold, italic: span.italic, kind: 'text', width: textWidth(span.text, font, false) + track(span.text) });
      }
      continue;
    }
    // Chinese marks (#193) ride on the span's words like its script.
    const marks = spanMarks(span, getMeasureWritingMode() === 'vertical-rl');
    const scriptFields = {
      ...scriptFieldsOf(span),
      ...(marks ? { cjkMarks: marks } : {}),
      ...(span.inserted ? { inserted: true } : {}),
    };
    // Small capitals: the words keep their case (hyphenation reads it) and
    // measure as they will be painted.
    const sc = !!span.smallCaps;
    const scFields = sc ? { smallCaps: true } : {};

    // Split on word boundaries while preserving spaces. Each word is
    // hyphenated on its own (the dictionary works word by word anyway), so
    // its soft hyphens can be told apart from the ones the source carries.
    // A no-break space is no boundary: it stays inside the word it glues
    // ("37 °C"), which the line then never breaks at (EF-66).
    const matched = span.text.match(WORDS_AND_SPACES_RE);
    if (!matched) continue;
    const levelled = bidi ? cutAtLevels(matched, spanBase, bidi) : matched;
    // In a Chinese or Japanese document a word with no letter is cut
    // around its doubled ellipses and dashes: the document's own marks,
    // set as Han text whatever sentence cites them (`cutDoubledMarks`).
    const parts = contextOf && scriptState.hanMarks && faceReadsScript(font)
      ? levelled.flatMap((part) => (isBreakingSpaceRun(part) ? undefined : cutDoubledMarks(part)) ?? [part])
      : levelled;

    let partStart = spanBase;
    for (const part of parts) {
      const partAt = partStart;
      partStart += part.length;
      const isSpace = isBreakingSpaceRun(part);
      if (!isSpace && URL_LIKE_RE.test(part.replace(/\u00AD/g, '')) && !(letterSpacingPx !== 0 && joiningScriptIn(part))) {
        const clean = part.replace(/\u00AD/g, '');
        // An address is one script run: its pieces with no letter
        // (`10.1006/`, `.2001`) are measured in the script they have in
        // it, and an address with no letter at all in its context's (#725).
        const inScript = scriptMeasure(contextOf?.(clean, partAt, part.length, font), font, sc);
        const spacing = inScript.untracked ? 0 : letterSpacingPx;
        const upTo = inScript.upTo ?? ((text: string): number => textWidth(text, font, sc));
        const breakPoints: RichBreakPoint[] = urlBreakIndices(clean).map((charIndex) => ({
          charIndex,
          widthBefore: upTo(clean.slice(0, charIndex)) + (spacing === 0 ? 0 : spacing * graphemeCount(clean.slice(0, charIndex))),
        }));
        tokens.push({
          text: clean,
          bold: span.bold,
          italic: span.italic,
          captionLabel: span.captionLabel,
          ...scriptFields,
          ...scFields,
          ...inScript.fields,
          kind: 'text',
          width: (inScript.whole ? inScript.whole(clean) : textWidth(clean, font, sc)) + (inScript.untracked ? 0 : track(clean)),
          ...(breakPoints.length > 0 ? { breakPoints, hyphenWidth: 0, bareBreaks: true } : {}),
          // The rest of an address divided at a joint is measured as the
          // text that opens the next line (#770).
          ...(ownPieces && breakPoints.length > 0 ? { ownPieces: spacing } : {}),
        });
        continue;
      }
      const { clean, soft } = isSpace ? { clean: part, soft: [] } : syllabify(part, shouldHyphenate && inCompound?.[partAt] !== true);
      // The characters this word touches, for a dash that opens it
      // ("**riddles.**—I", "*\"no\"*—and"): the end of a word run just
      // before, no space in between.
      const before = tokens[tokens.length - 1];
      const touching = dashBreaks && before && before.kind === 'text' && !before.mathRender && !before.swatch && !before.chip
        ? before.text.slice(-2)
        : undefined;
      // A word that holds CJK characters: measured unit by unit, once each.
      const cjk = cjkText && !isSpace && hasCJK(clean) ? cjkWordBreaks(clean, font, sc, letterSpacingPx, undefined, keepAll) : undefined;
      // A word of a joining script is measured untracked, its break points
      // (after a hyphen or a dash it carries) too.
      // A word with no letter: measured in the script of its context, its
      // pieces at a break too (#725). In the Arabic script it takes no
      // tracking, as the Arabic words around it take none.
      // A word with a letter: its pieces with no letter (`COVID-` | `19`)
      // in the script they have inside it.
      const measured = scriptMeasure(contextOf && !isSpace && !cjk ? contextOf(clean, partAt, part.length, font) : undefined, font, sc);
      const untracked = measured.untracked;
      const wordSpacing = isSpace ? letterSpacingPx : untracked ? 0 : wordLetterSpacing(clean, letterSpacingPx);
      const inScript = measured.whole;
      const contextFields = measured.fields;
      const breakPoints = isSpace ? [] : wordBreakPoints(clean, soft, font, wordSpacing, sc, dashBreaks, touching, cjk, measured.upTo, ownPieces && !cjk);
      if (breakPoints.length > 0) {
        tokens.push({
          text: clean,
          bold: span.bold,
          italic: span.italic,
          captionLabel: span.captionLabel,
          ...scriptFields,
          ...scFields,
          ...contextFields,
          kind: 'text',
          width: cjk ? cjk.width : (inScript ? inScript(clean) : textWidth(clean, font, sc)) + (untracked ? 0 : track(clean)),
          breakPoints,
          hyphenWidth: measureTextWidth('-', font) + letterSpacingPx,
          // A word that holds CJK characters is measured unit by unit:
          // its rest is already the text that opens the next line.
          ...(ownPieces && !cjk ? { ownPieces: wordSpacing } : {}),
        });
      } else {
        // A word of a joining script loses the soft hyphens it may not
        // break at (`syllabify`); any other keeps its text as written.
        const word = clean !== part && !isSpace && joiningScriptIn(part) ? clean : part;
        tokens.push({
          text: word,
          bold: span.bold,
          italic: span.italic,
          captionLabel: span.captionLabel,
          ...scriptFields,
          ...(isSpace ? {} : scFields),
          ...contextFields,
          kind: isSpace ? 'space' : 'text',
          width: (inScript ? inScript(word) : textWidth(word, font, sc && !isSpace)) + (untracked ? 0 : track(word)),
        });
      }
    }
    } finally {
      if (ownLanguage !== undefined) {
        setMeasureLanguage(languageBefore);
        if (ownLanguage !== languageBefore) for (let k = spanTokensFrom; k < tokens.length; k++) tokens[k]!.lang = ownLanguage;
      }
    }
  }

  // A word of a joining script cut into runs by a style change is one
  // word again (only text that holds such a script is looked at).
  if (spans.length > 1) joinStyledRuns(tokens, normalFont, boldFont, italicFont, boldItalicFont);
  if (tokens.some((t) => t.script)) stackScriptTokens(tokens, normalFont, boldFont, italicFont, boldItalicFont);
  if (tokens.some((t) => t.chip)) {
    applyChipGaps(tokens, (t, run) => measureTextWidth(run, tokenFont(t, normalFont, boldFont, italicFont, boldItalicFont)) + (letterSpacingPx === 0 ? 0 : letterSpacingPx * graphemeCount(run)));
  }
  if (dashBreaks) markDashJoins(tokens);
  return tokens;
}

/** A token that may be one run of a word set in several styles: plain
 *  text, nothing set as a whole (a reference, a note marker, a chip, a
 *  formula, a swatch), no script, small capitals, vertical run or marks. */
function isStyledRunPart(t: RichToken | undefined): t is RichToken {
  return t !== undefined && t.kind === 'text' && !t.mathRender && !t.swatch && !t.chip && t.refResourceId === undefined
    && t.footnoteId === undefined && !t.labelTab && !t.script && !t.stacked && !t.smallCaps && !t.tcy && !t.orientation
    && !t.cjkMarks && !t.inserted && !t.runs;
}

/** Whether two runs that touch (no space between) are pieces of one word
 *  of a joining script: the cut between them falls between two of its
 *  letters, or before a mark (see `insideJoiningWord`). */
function joinsAcross(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.charCodeAt(a.length - 1) < 0x0600 && b.charCodeAt(0) < 0x0600) return false;
  return insideJoiningWord(a + b, a.length);
}

/**
 * Join the runs a style change cuts a word of a joining script into
 * (`كتا**ب**`, a coloured letter or vowel sign in a primer) back into one
 * token. Measured in pieces, each piece would be shaped alone: the letters
 * at the cut would take their isolated or final forms, the widths would be
 * off by a fifth or more (engine-ltr-audit §1.4), and the renderers would
 * paint a broken word. The token is measured whole in the style of its
 * longest run (an approximation when the runs differ in weight, never in
 * joining) and keeps each run's text and style (`runs`), so the renderers
 * shape the word once and give each run its style. It never breaks.
 */
function joinStyledRuns(
  tokens: RichToken[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): void {
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!isStyledRunPart(tokens[i])) continue;
    // Each next run is read against the whole word so far: a run of marks
    // alone (`ب**َ**يت`, a coloured fatha) has no letter of its own to join
    // from, the letter it sits on does.
    let j = i + 1;
    let word = tokens[i]!.text;
    while (j < tokens.length && isStyledRunPart(tokens[j]) && joinsAcross(word, tokens[j]!.text)) {
      word += tokens[j]!.text;
      j++;
    }
    if (j === i + 1) continue;
    const parts = tokens.slice(i, j);
    const runs: { text: string; bold?: boolean; italic?: boolean }[] = [];
    let dominant = parts[0]!;
    let most = -1;
    for (const p of parts) {
      const last = runs[runs.length - 1];
      if (last && !!last.bold === p.bold && !!last.italic === p.italic) last.text += p.text;
      else runs.push({ text: p.text, ...(p.bold ? { bold: true } : {}), ...(p.italic ? { italic: true } : {}) });
      const n = graphemeCount(p.text);
      if (n > most) { most = n; dominant = p; }
    }
    const text = parts.map((p) => p.text).join('');
    const merged: RichToken = {
      text,
      bold: dominant.bold,
      italic: dominant.italic,
      ...(parts[0]!.captionLabel ? { captionLabel: true } : {}),
      kind: 'text',
      width: rtlWordWidth(text, tokenFont(dominant, normalFont, boldFont, italicFont, boldItalicFont)),
      ...(dominant.faceFont ? { faceFont: dominant.faceFont } : {}),
      ...(runs.length > 1 ? { runs } : {}),
      ...(parts[parts.length - 1]!.dashJoin ? { dashJoin: true } : {}),
    };
    tokens.splice(i, j - i, merged);
  }
}

/** The words of a span (`parts`, starting at `from` in the paragraph) cut
 *  where their bidi level changes, never between two letters of a joining
 *  script. Spaces are left whole. */
function cutAtLevels(parts: readonly string[], from: number, bidi: BidiParagraph): string[] {
  const out: string[] = [];
  let at = from;
  for (const part of parts) {
    const start = at;
    at += part.length;
    if (isBreakingSpaceRun(part)) {
      out.push(part);
      continue;
    }
    let piece = 0;
    for (let k = 1; k < part.length; k++) {
      if (bidi.levels[start + k] === bidi.levels[start + k - 1] || insideJoiningWord(part, k)) continue;
      const c = part.charCodeAt(k);
      if (c >= 0xDC00 && c <= 0xDFFF) continue;
      out.push(part.slice(piece, k));
      piece = k;
    }
    out.push(part.slice(piece));
  }
  return out;
}

/** A run of words a dash break may read across: not a formula, a swatch,
 *  a chip or one of two stacked scripts. */
function isWordRun(t: RichToken | undefined): t is RichToken {
  return t !== undefined && t.kind === 'text' && !t.mathRender && !t.swatch && !t.chip && !t.stacked;
}

/** Flag `dashJoin` on each word run that ends on a closed dash (as
 *  `breaksAfterDash` reads it) touched by the next word run: the dash
 *  closes one run and the next one opens in another style ("riddles—*and*",
 *  "say—**that**"). A dash inside a run, or opening one, is a break point
 *  of its own word (see {@link wordBreakPoints}). */
function markDashJoins(tokens: RichToken[]): void {
  for (let t = 0; t + 1 < tokens.length; t++) {
    const a = tokens[t]!;
    const b = tokens[t + 1]!;
    if (!isWordRun(a) || !isWordRun(b) || a.refResourceId !== undefined) continue;
    const dash = a.text[a.text.length - 1];
    if (!isDash(dash)) continue;
    // The dash and the two characters before it, read back into the run
    // before when this one is shorter.
    const tail = (isWordRun(tokens[t - 1]) ? tokens[t - 1]!.text.slice(-2) : '') + a.text.slice(-3);
    if (breaksAfterDash(tail[tail.length - 2], dash!, b.text[0], tail[tail.length - 3])) a.dashJoin = true;
  }
}

/** Set every subscript and superscript that touch one over the other (see
 *  {@link stackedScriptPairs}): the first token of a pair advances nothing,
 *  the second the pair's advance; the subscript drops to its stacked
 *  position; neither keeps a break point, so the pair never parts. Words
 *  only: a script reference, or one in small capitals, sets as it is. */
function stackScriptTokens(
  tokens: RichToken[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): void {
  const scripts = tokens.map((t) => (
    t.kind === 'text' && t.script && !t.smallCaps && t.refResourceId === undefined && t.footnoteId === undefined && !t.chip && !t.mathRender && !t.swatch
      ? t.script
      : undefined
  ));
  for (const i of stackedScriptPairs(scripts)) {
    const pair = [tokens[i]!, tokens[i + 1]!];
    for (const t of pair) {
      delete t.breakPoints;
      delete t.hyphenWidth;
      delete t.bareBreaks;
    }
    const sub = pair[0]!.script === 'sub' ? pair[0]! : pair[1]!;
    sub.baselineShift = scriptMetrics(pickSpanFont(sub.bold, sub.italic, normalFont, boldFont, italicFont, boldItalicFont), 'sub', true).baselineShift;
    pair[1]!.width = Math.max(pair[0]!.width, pair[1]!.width);
    pair[0]!.width = 0;
    pair[0]!.stacked = 'first';
    pair[1]!.stacked = 'second';
  }
}

/** Ragged hyphenation: at most this many lines in a row end on a
 *  dictionary syllable (a "ladder" of hyphens down the edge). */
const MAX_RAGGED_HYPHEN_RUN = 2;

/** Width of the spaces a line's tokens end with (trimmed when it is set). */
function trailingSpaceWidth(tokens: RichToken[]): number {
  let w = 0;
  for (let k = tokens.length - 1; k >= 0 && tokens[k]!.kind === 'space'; k--) w += tokens[k]!.width;
  return w;
}

/** How many of a line's last tokens touch the next one with no space in
 *  between (two runs of one word, "**Nota**:"): the line may not break
 *  inside that group. */
function gluedTailLength(tokens: RichToken[]): number {
  let k = 0;
  for (let i = tokens.length - 1; i >= 0 && tokens[i]!.kind !== 'space'; i--) k++;
  return k;
}

/** A token the emergency division may cut: a word, not an atomic box nor
 *  one of two stacked scripts. */
function isDivisible(token: RichToken): boolean {
  return token.kind === 'text' && !token.mathRender && !token.swatch && !token.chip && token.refResourceId === undefined && token.footnoteId === undefined && !token.stacked;
}

/** Cut a word at one of its break points: the head ends the line (with
 *  `mark`, `markWidth` px wide, appended — or in place of the middle dot of
 *  an `l·l`), the tail keeps the break points after the cut. */
function splitToken(token: RichToken, bp: RichBreakPoint, mark: string, markWidth: number, font?: string): { head: RichToken; tail: RichToken } {
  const flags = { bold: token.bold, italic: token.italic, captionLabel: token.captionLabel, ...scriptOf(token) };
  // The rest measured as the text that opens the next line (#770).
  const own = font !== undefined && token.ownPieces !== undefined ? ownRest(token, bp.charIndex, font) : undefined;
  const residual = own
    ? ownRestBreaks(token, bp.charIndex, own)
    : (token.breakPoints ?? [])
      .filter((b) => b.charIndex > bp.charIndex)
      .map((b) => ({ ...b, charIndex: b.charIndex - bp.charIndex, widthBefore: b.widthBefore - bp.widthBefore }));
  return {
    head: mark !== '' && bp.replacesWidth !== undefined
      ? { ...flags, text: withLineEndHyphen(token.text.slice(0, bp.charIndex)), kind: 'text', width: bp.widthBefore - bp.replacesWidth + markWidth }
      : { ...flags, ...pieceScriptFields(token, 0, bp.charIndex), text: token.text.slice(0, bp.charIndex) + mark, kind: 'text', width: bp.widthBefore + markWidth },
    tail: {
      ...flags,
      ...pieceScriptFields(token, bp.charIndex, token.text.length),
      text: token.text.slice(bp.charIndex),
      kind: 'text',
      width: own ? own(token.text.length) : token.width - bp.widthBefore,
      ...(residual.length > 0 ? { breakPoints: residual, hyphenWidth: token.hyphenWidth } : {}),
      ...(token.bareBreaks ? { bareBreaks: true } : {}),
      ...(token.dashJoin ? { dashJoin: true } : {}),
      ...(own ? { ownPieces: token.ownPieces } : {}),
    },
  };
}

/** `token` (the tail of a compound broken after its hyphen) opening with
 *  that hyphen repeated, `hyphenWidth` px wide; its break points move with
 *  it. */
function withLeadingHyphen(token: RichToken, hyphenWidth: number, font?: string): RichToken {
  // A word measured as the text painted (#770): the hyphen is part of the
  // text the line opens with, and the word is measured with it.
  if (font !== undefined && token.ownPieces !== undefined) {
    const own = ownRest(token, 0, font, '-');
    const breakPoints = ownRestBreaks(token, 0, own, 1);
    const { breakPoints: _points, ...rest } = token;
    void _points;
    return { ...rest, text: `-${token.text}`, width: own(token.text.length), ...(breakPoints.length > 0 ? { breakPoints } : {}) };
  }
  return {
    ...token,
    text: `-${token.text}`,
    width: token.width + hyphenWidth,
    ...(token.breakPoints
      ? { breakPoints: token.breakPoints.map((bp) => ({ ...bp, charIndex: bp.charIndex + 1, widthBefore: bp.widthBefore + hyphenWidth })) }
      : {}),
  };
}

/** The latest break inside a line's last `glued` tokens that adds nothing
 *  to the line — between ideographs, after a dash, a hard hyphen, a URL
 *  joint — with the token's position in the line. `join`: the break falls
 *  after that whole token, at a dash that closes it (`dashJoin`); the
 *  group's last token joins the token that did not fit. */
function lastPlainBreakInGroup(
  lineTokens: RichToken[],
  glued: number,
): { at: number; token: RichToken; bp: RichBreakPoint } | { at: number; join: true } | null {
  for (let at = lineTokens.length - 1; at >= lineTokens.length - glued; at--) {
    const token = lineTokens[at]!;
    if (token.dashJoin) return { at, join: true };
    const points = token.breakPoints ?? [];
    for (let k = points.length - 1; k >= 0; k--) {
      const bp = points[k]!;
      if (token.bareBreaks || bp.bare || bp.free) return { at, token, bp };
    }
  }
  return null;
}

/** The latest syllable (the dictionary's or the author's soft hyphen)
 *  inside a line's last `glued` tokens where the line, with the hyphen it
 *  adds, still fits `lineMaxWidth`, with the token's position in the
 *  line. */
function lastSyllableInGroup(lineTokens: RichToken[], glued: number, lineMaxWidth: number): { at: number; token: RichToken; bp: RichBreakPoint } | null {
  let before = 0;
  for (let k = 0; k < lineTokens.length - glued; k++) before += lineTokens[k]!.width;
  const widthsBefore: number[] = [];
  for (let at = lineTokens.length - glued; at < lineTokens.length; at++) {
    widthsBefore[at] = before;
    before += lineTokens[at]!.width;
  }
  for (let at = lineTokens.length - 1; at >= lineTokens.length - glued; at--) {
    const token = lineTokens[at]!;
    if (!isDivisible(token) || token.bareBreaks) continue;
    const points = token.breakPoints ?? [];
    for (let k = points.length - 1; k >= 0; k--) {
      const bp = points[k]!;
      if (bp.bare || bp.free || bp.greedyOnly) continue;
      if (widthsBefore[at]! + bp.widthBefore + (token.hyphenWidth ?? 0) - (bp.replacesWidth ?? 0) <= lineMaxWidth) return { at, token, bp };
    }
  }
  return null;
}

/**
 * Measure a rich text block with mixed font weights.
 * Uses canvas measureText for per-token measurement and greedy line-breaking.
 * A text of nothing but whitespace, no-break spaces included, sets no line.
 */
export function measureRichBlock(
  spans: InlineSpan[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  maxWidthPx: number,
  lineHeightPx: number,
  options?: MeasureBlockOptions,
): MeasuredBlock {
  const plainText = spans.map((s) => s.text).join('');
  if (plainText.trim() === '') {
    return { lines: [], totalHeight: 0 };
  }
  return measureRichText(spans, plainText, normalFont, boldFont, italicFont, boldItalicFont, maxWidthPx, lineHeightPx, options);
}

/**
 * {@link measureRichBlock} for a paragraph of a table cell, or a piece of a
 * caption or a note: a text of nothing but no-break spaces sets a line of
 * them, as CommonMark reads a line holding U+00A0 (EF-154). Ordinary
 * whitespace, and a lone zero-width U+FEFF, still set none (see
 * {@link isBlankText}). The body keeps {@link measureRichBlock}'s rule, as
 * its parser drops such a paragraph too.
 */
export function measureRichSnippet(
  spans: InlineSpan[],
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  maxWidthPx: number,
  lineHeightPx: number,
  options?: MeasureBlockOptions,
): MeasuredBlock {
  const plainText = spans.map((s) => s.text).join('');
  if (isBlankText(plainText)) {
    return { lines: [], totalHeight: 0 };
  }
  return measureRichText(spans, plainText, normalFont, boldFont, italicFont, boldItalicFont, maxWidthPx, lineHeightPx, options);
}

function measureRichText(
  spans: InlineSpan[],
  plainText: string,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  maxWidthPx: number,
  lineHeightPx: number,
  options: MeasureBlockOptions | undefined,
): MeasuredBlock {
  // A writing mode asked for this text alone (`options.writingMode`): every
  // width below reads it.
  if (options?.writingMode !== undefined && options.writingMode !== getMeasureWritingMode()) {
    const opts = options;
    return withMeasureWritingMode(opts.writingMode!, () => measureRichText(spans, plainText, normalFont, boldFont, italicFont, boldItalicFont, maxWidthPx, lineHeightPx, opts));
  }
  // Forced line breaks (#620): the text between two of them is broken on
  // its own, by whichever breaker sets it, and the pieces stacked
  // (`measure/hardBreaks.ts`).
  if (plainText.includes(FORCED_BREAK)) {
    return measureForcedBreaks(spans, maxWidthPx, lineHeightPx, options, (piece, opts) =>
      measureRichText(piece, piece.map((s) => s.text).join(''), normalFont, boldFont, italicFont, boldItalicFont, maxWidthPx, lineHeightPx, opts));
  }
  // Tabs (#622) are word spaces in vertical text.
  if (measuringVertically() && spans.some((sp) => sp.tab)) spans = tabsAsSpaces(spans);
  // Vertical text: a short number inside a Latin sentence runs sideways
  // with it, read against the whole paragraph (#222).
  if (measuringVertically()) spans = sidewaysNumberSpans(spans, getMeasureUprightDigits(), getMeasureRegion());
  // Arabic letters are never slanted (#376, `uprightArabic.ts`).
  spans = uprightArabicSpans(spans, italicFont, boldItalicFont, normalFont, boldFont);
  // Chinese, Japanese or Korean text: its own composer, which breaks
  // between characters under the document's line-break rules and spreads
  // justified lines between them — also text with no two CJK letters in a
  // row (价¥5,999。好, 第1条、第2条). A Latin paragraph that only quotes a
  // few CJK words stays here, with a break allowed next to their characters.
  // So is a paragraph with ruby, a warichu note or kanbun marks (#194,
  // #195, #430), which the composer alone lays out.
  // The paragraph is looked at for CJK text once (`cjkText`); a Latin one
  // then never looks into its words.
  // A paragraph with a tab (#622) is set by the line breaker below, which
  // breaks Chinese and Japanese words between their characters under the
  // document's rules; one with ruby, a warichu note or kanbun marks keeps
  // the composer, its tabs set as word spaces.
  const cjkText = hasCJK(plainText);
  const annotated = spans.some((s) => s.ruby || s.warichu || s.kunten);
  const hasTabs = spans.some((s) => s.tab);
  // A row of dashes alone in a Chinese or Japanese document is one rule
  // (#680): the composer's too.
  const dashRow = !cjkText && !hasTabs && plainText.length > 1 && composesDashRow(plainText, options?.cjkComposition);
  if ((cjkText && composesAsCjk(plainText) && !hasTabs) || annotated || dashRow) {
    return composeCjkParagraph(hasTabs ? tabsAsSpaces(spans) : spans, normalFont, boldFont, italicFont, boldItalicFont, maxWidthPx, lineHeightPx, options);
  }

  const shouldHyphenate = options?.hyphenate ?? false;
  // Each line's start: its indent past its inset beside a picture (#627).
  const indentOf = (li: number): number => lineStartAt(options, li);
  const textAlign = options?.textAlign ?? 'left';
  const letterSpacingPx = options?.letterSpacingPx ?? 0;
  const hyphenationZonePx = shouldHyphenate ? options?.hyphenationZonePx : undefined;
  // A paragraph with right-to-left text: its levels, read once, cut its
  // words where they change direction and give its lines their order.
  const bidi = paragraphBidi(spans, plainText, options);
  // The languages the paragraph's isolates name (`:ltr[…]{lang=en}`), set
  // on the segments of their text (`VDTLineSegment.lang`).
  const languages = spans.some((sp) => sp.direction?.lang !== undefined || sp.direction?.outer !== undefined) ? spanLanguages(spans) : [];
  // `keep-all` holds in a Latin paragraph that quotes CJK characters as it
  // does in one the composer sets (#705).
  const keepAll = cjkText && (options?.cjkWordBreak !== undefined ? options.cjkWordBreak === 'keep-all' : (options?.cjkComposition ?? getCjkComposition()).keepAll === true);
  const tokens = tokenizeSpans(spans, normalFont, boldFont, italicFont, boldItalicFont, shouldHyphenate, letterSpacingPx, options?.breakAfterDashes === true, options?.hyphenateCompounds === false, cjkText, bidi, keepAll);
  if (options?.labelColumnPx !== undefined) setLabelTabs(tokens, (t) => t.labelTab, options.labelColumnPx, (t, w) => { t.width = w; });
  const repeatHyphen = options?.repeatHyphen === true;
  // Words whose halves at a line end are measured as the texts painted, in
  // a document shaped in its own language (#770, `RichToken.ownPieces`):
  // the font each is measured in, and the pieces of the rest of one that
  // opens a line, for the lines Knuth–Plass sets (`reconstructRichLines`).
  const ownTokens = tokens.some((t) => t.ownPieces !== undefined);
  const fontOfToken = (t: RichToken): string => tokenFont(t, normalFont, boldFont, italicFont, boldItalicFont);
  const ownFont = (t: RichToken): string | undefined => (t.ownPieces !== undefined ? fontOfToken(t) : undefined);
  const restPieces = (tokenIndex: number, from: number, cuts: readonly number[], lead: string): number[] => {
    const token = tokens[tokenIndex]!;
    const width = ownRest(token, from, fontOfToken(token), lead);
    let before = 0;
    return cuts.map((to) => {
      const upTo = width(to);
      const piece = upTo - before;
      before = upTo;
      return piece;
    });
  };
  const hasSmallCaps = tokens.some((t) => t.smallCaps);
  const normalSpaceWidth = textAlign === 'justify' ? normalSpaceWidthFor(normalFont) + letterSpacingPx : 0;

  if (tokens.length === 0) {
    return { lines: [], totalHeight: 0 };
  }

  // Kashida justification (#375): a justified paragraph with Arabic words.
  const kashida = textAlign === 'justify' && options?.kashida && bidi ? options.kashida : undefined;
  if (kashida) markKashidaCapacity(tokens, kashida, normalFont, boldFont, italicFont, boldItalicFont);
  const fontOf = (seg: VDTLineSegment) => seg.fontString ?? pickSpanFont(!!seg.bold, !!seg.italic, normalFont, boldFont, italicFont, boldItalicFont);
  const withKashida = (lines: VDTLine[]) => {
    if (!kashida) return;
    justifyLinesWithKashida(lines, (li) => {
      return lineWidthAt(maxWidthPx, options, li);
    }, normalSpaceWidth, kashida, (seg, text) => rtlWordWidth(text, fontOf(seg)));
  };

  // Knuth-Plass optimal line breaking path. A Latin paragraph quoting CJK
  // words takes it too: the breaks next to their characters are free
  // penalties, as a hyphenation point that adds nothing. Ragged text takes
  // it too with `optimalRagged`: its word spaces keep their width and each
  // line gets the ragged stretch instead.
  const ragged = textAlign !== 'justify';
  // A paragraph that holds a tab is set line by line (#622): a tab's width
  // depends on where its line starts.
  if (options?.optimal && (!ragged || options.optimalRagged) && !hasTabs) {
    const maxStretchRatio = ragged ? 1 : options.maxStretchRatio ?? 1.5;
    const minShrinkRatio = ragged ? 1 : options.minShrinkRatio ?? 0.8;
    // The runt threshold counts word spaces on ragged text too.
    const spaceWidth = ragged ? normalSpaceWidthFor(normalFont) + letterSpacingPx : normalSpaceWidth;
    // The rest of a word broken at a line end, as the text painted (#770).
    if (ownTokens) markRestShifts(tokens, fontOfToken, repeatHyphen);
    const items = richTokensToItems(tokens, spaceWidth, maxStretchRatio, minShrinkRatio, repeatHyphen);
    const lineWidthFn = lineWidthFunction(maxWidthPx, options);
    const lineIndentFn = indentOf;
    const runtPenalty = options.runtPenalty ?? 0;
    const runtMinWidth = runtPenalty > 0
      ? (options.runtMinCharacters ?? 0) * spaceWidth
      : 0;
    const trackingPerChar = ragged ? 0 : options.justifyTrackingPx ?? 0;
    const breaks = computeBreakpoints(items, {
      lineWidth: lineWidthFn,
      normalSpaceWidth: spaceWidth,
      maxStretchRatio,
      minShrinkRatio,
      runtPenalty,
      runtMinWidth,
      runtGraded: options.runtGraded === true,
      ...(options.avoidHyphenAtLines ? { avoidHyphenAtLines: options.avoidHyphenAtLines } : {}),
      ...(options.keepBreaks?.path === 'rich' ? { fixedBreaks: options.keepBreaks.at } : {}),
      looseness: options.looseness ?? 0,
      lineWidthUniformFrom: uniformMeasureFrom(options.restWidths, options.lineIndentsPx, options.lineInsets),
      trackingPerChar,
      ...(ragged ? { raggedStretch: raggedStretchPx(normalFont) } : {}),
      ...(ragged && hyphenationZonePx !== undefined ? { hyphenationZone: hyphenationZonePx } : {}),
    });
    if (breaks.length > 0) {
      const kpLines = reconstructRichLines(
        items, breaks, tokens, lineHeightPx,
        lineWidthFn, lineIndentFn, normalSpaceWidth, textAlign,
        trackingPerChar, lineBaselineOffset(lineHeightPx, normalFont),
        ownTokens ? restPieces : undefined,
      );
      if (!hasOverfullLine(kpLines, lineWidthFn, ragged)) {
        if (hasSmallCaps) expandSmallCaps(kpLines, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
        if (bidi) withDirections(kpLines, bidi, normalFont, boldFont, italicFont, boldItalicFont);
        if (languages.length > 0) applySegmentLanguages(kpLines, plainText, languages);
        withKashida(kpLines);
        markInsetLines(kpLines, maxWidthPx, options);
        return {
          lines: kpLines,
          totalHeight: kpLines.length * lineHeightPx,
          ...(isRuntLastLine(kpLines, runtMinWidth) ? { lastLineRunt: true } : {}),
          breaks: { path: 'rich', at: breaks },
        };
      }
    }
    // Fallback to greedy if K-P produced no breaks, or a line past the
    // measure (a word wider than it: the greedy breaker divides it)
  }

  const lines: VDTLine[] = [];
  const baselineOffset = lineBaselineOffset(lineHeightPx, normalFont);
  let y = 0;
  let tokenIdx = 0;
  let lineIndex = 0;
  // Lines in a row that ended on a dictionary syllable (ragged hyphenation).
  let syllableRun = 0;
  // The line before broke after a compound's hyphen, which this one repeats
  // (`repeatHyphen`).
  let repeatPending = false;
  // Tabs (#622): a leader is measured in the paragraph's face, tracked as
  // its words are; a tab past the last stop is a word space.
  const leaderWidth = (text: string): number => measureTextWidth(text, normalFont) + (letterSpacingPx === 0 ? 0 : letterSpacingPx * graphemeCount(text));
  const tabSpaceWidth = hasTabs ? normalSpaceWidthFor(normalFont) + letterSpacingPx : 0;
  // A word space a line may start or end at (a tab is none).
  const isBreakSpace = (t: RichToken): boolean => t.kind === 'space' && !t.tab;

  while (tokenIdx < tokens.length) {
    const lineIndent = indentOf(lineIndex);
    const lineMaxWidth = lineWidthAt(maxWidthPx, options, lineIndex);

    const lineTokens: RichToken[] = [];
    let lineWidth = 0;
    let lineHyphenated = false;
    let lineSyllable = false;
    // The line ends after a hyphen the word carries (EF-140).
    let lineHardHyphen = false;
    // A word of a joining script wider than the line runs past it.
    let lineWordOverflow = false;
    // The line holds a tab placed at a stop (#622).
    let lineTabbed = false;

    // Consume leading spaces at line start (skip them)
    while (tokenIdx < tokens.length && isBreakSpace(tokens[tokenIdx]!)) {
      tokenIdx++;
    }
    // The compound's hyphen, repeated: the tail it broke from opens the
    // line with it, measured.
    const lineRepeated = repeatPending && tokens[tokenIdx]?.kind === 'text';
    if (lineRepeated) {
      const tail = tokens[tokenIdx]!;
      tokens[tokenIdx] = withLeadingHyphen(tail, tail.hyphenWidth ?? measureTextWidth('-', tokenFont(tail, normalFont, boldFont, italicFont, boldItalicFont)) + letterSpacingPx, ownFont(tail));
    }
    repeatPending = false;
    // This line ends after a compound's hyphen the next one repeats.
    let lineRepeatNext = false;
    // Tabs (#622): the stop the line's last tab took, and that tab's place
    // among the line's tokens.
    let tabUsedPos = -Infinity;
    let lastTabAt = -1;

    // Greedy: add tokens until we overflow
    while (tokenIdx < tokens.length) {
      let token = tokens[tokenIdx]!;

      if (token.tab) {
        const x = lineIndent + lineWidth;
        const placement = placeTab(
          x,
          tabRun(tokens, tokenIdx, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx),
          { start: lineIndent, end: lineIndent + lineMaxWidth, measure: maxWidthPx, usedPos: tabUsedPos },
          options?.tabs,
          token.tab.stop,
          leaderWidth,
        );
        if (placement.kind === 'stop' || (placement.kind === 'overrun' && !lineTokens.some((t) => t.kind !== 'space'))) {
          // At its stop; or opening its line with no stop the text after
          // it fits: it takes no room.
          const width = placement.kind === 'stop' ? placement.width : 0;
          lineTokens.push({
            ...token,
            width,
            tabPlaced: placement.kind === 'stop' ? { align: placement.align, at: placement.pos } : { align: 'start', at: x },
            ...(placement.kind === 'stop' && placement.leader ? { tabLeader: placement.leader } : {}),
          });
          lineWidth += width;
          tokenIdx++;
          if (placement.kind === 'stop') tabUsedPos = placement.pos;
          lastTabAt = lineTokens.length - 1;
          lineTabbed = true;
          continue;
        }
        if (placement.kind === 'overrun') {
          // An end, centre or decimal stop the text before it has passed
          // takes that text's last word down with it; a start stop breaks
          // the line before the tab.
          if (placement.align !== 'start') {
            let k = lineTokens.length - 1;
            while (k > lastTabAt + 1 && !(lineTokens[k]!.kind === 'space' && !lineTokens[k]!.tab)) k--;
            if (k > lastTabAt + 1 && lineTokens.slice(lastTabAt + 1, k).some((t) => t.kind !== 'space')) {
              tokenIdx -= lineTokens.length - k;
              while (lineTokens.length > k) lineWidth -= lineTokens.pop()!.width;
            }
          }
          break;
        }
        // Past the last stop with no default stops: a word space, none at
        // the line's start.
        if (!lineTokens.some((t) => t.kind !== 'space')) {
          tokenIdx++;
          continue;
        }
        const { tab: _tab, ...space } = token;
        void _tab;
        token = { ...space, width: tabSpaceWidth, labelTab: 'gap' };
      }

      // The text a tab sent to its stop fits as measured: rounding in the
      // sums is no overflow (#622).
      if (lineWidth + token.width <= lineMaxWidth + (lineTabbed ? 0.01 : 0)) {
        lineTokens.push(token);
        lineWidth += token.width;
        tokenIdx++;
        continue;
      }

      // Doesn't fit. Try to split at a break point (a soft hyphen, a hard
      // hyphen inside the word, a URL joint, a dash, between ideographs).
      if (token.kind === 'text' && token.breakPoints && token.breakPoints.length > 0) {
        const remaining = lineMaxWidth - lineWidth;
        const plainBreak = (bp: RichBreakPoint): boolean => token.bareBreaks === true || bp.bare === true || bp.free === true;
        const markW = (bp: RichBreakPoint): number => (plainBreak(bp) ? 0 : (token.hyphenWidth ?? 0));
        // Hyphenation zone (ragged text): a dictionary syllable is taken only
        // when the word, sent whole to the next line, would leave more than
        // the zone empty at the end of this one, and never on a third line
        // in a row. The word's own joints (a hard hyphen, a URL's, a dash),
        // breaks between ideographs and the author's soft hyphens are always
        // candidates.
        const syllables = hyphenationZonePx === undefined
          || (syllableRun < MAX_RAGGED_HYPHEN_RUN
            && lineMaxWidth - (lineWidth - trailingSpaceWidth(lineTokens)) > hyphenationZonePx);
        let chosen: RichBreakPoint | null = null;
        for (const bp of token.breakPoints) {
          if (!syllables && !plainBreak(bp) && !bp.author) continue;
          if (bp.widthBefore + markW(bp) - (plainBreak(bp) ? 0 : bp.replacesWidth ?? 0) <= remaining) chosen = bp;
          else break;
        }
        if (chosen) {
          const mark = plainBreak(chosen) ? '' : '-';
          const split = splitToken(token, chosen, mark, markW(chosen), ownFont(token));
          lineTokens.push(split.head);
          lineWidth += split.head.width;
          lineHyphenated = chosen.cjk !== true;
          lineSyllable = mark !== '' && !chosen.author;
          lineHardHyphen = chosen.bare === true;
          lineRepeatNext = repeatHyphen && chosen.bare === true && !token.bareBreaks;
          tokens[tokenIdx] = split.tail;
          break;
        }
      }

      // A word wider than the whole line: divide it rather than let it run
      // past the measure (syllable first, then character).
      if (lineTokens.length === 0 && isDivisible(token) && token.width > lineMaxWidth) {
        const font = tokenFont(token, normalFont, boldFont, italicFont, boldItalicFont);
        const split = emergencySplit(token, font, letterSpacingPx, lineMaxWidth);
        if (split) {
          lineTokens.push(split.head);
          lineWidth += split.head.width;
          lineHyphenated = true;
          lineHardHyphen = split.hard === true;
          lineRepeatNext = repeatHyphen && split.hard === true && !token.bareBreaks;
          tokens[tokenIdx] = split.tail;
          break;
        }
      }

      // The token touches the line's last one with no space between (a word
      // set in two runs, a parenthesis before a bold word): the line may not
      // break there, except between two ideographs.
      const glued = token.kind !== 'space' ? gluedTailLength(lineTokens) : 0;
      if (glued > 0) {
        const prev = lineTokens[lineTokens.length - 1]!;
        const font = tokenFont(token, normalFont, boldFont, italicFont, boldItalicFont);
        if (token.stacked !== 'second' && token.footnoteId === undefined && token.refResourceId === undefined && cjkJoinBreaks(prev.text, token.text)) {
          // The line ends between two runs, next to a CJK character: no
          // space is consumed and nothing is added.
          break;
        }
        // The group's latest plain break (between ideographs, a dash, a
        // hard hyphen) ends the line: kinsoku keeps 。 off the next line's
        // start by taking the ideograph before it along.
        const back = lastPlainBreakInGroup(lineTokens, glued);
        if (back && 'join' in back) {
          // After the dash that closes a run: the runs after it go down.
          const keep = back.at + 1;
          tokenIdx -= lineTokens.length - keep;
          while (lineTokens.length > keep) lineWidth -= lineTokens.pop()!.width;
          lineHyphenated = true;
          break;
        }
        if (back) {
          const origIdx = tokenIdx - (lineTokens.length - back.at);
          while (lineTokens.length > back.at) lineWidth -= lineTokens.pop()!.width;
          const split = splitToken(back.token, back.bp, '', 0, ownFont(back.token));
          lineTokens.push(split.head);
          lineWidth += split.head.width;
          tokens[origIdx] = split.tail;
          tokenIdx = origIdx;
          lineHyphenated = back.bp.cjk !== true;
          lineHardHyphen = back.bp.bare === true;
          lineRepeatNext = repeatHyphen && back.bp.bare === true && !back.token.bareBreaks;
          break;
        }
        if (glued < lineTokens.length) {
          // Send the whole group down: the line ends at the space before it.
          for (let k = 0; k < glued; k++) lineWidth -= lineTokens.pop()!.width;
          tokenIdx -= glued;
          break;
        }
        // The group opens the line, so it is wider than the line: divide this
        // word at a syllable where the line ends.
        if (isDivisible(token)) {
          const split = emergencySplit(token, font, letterSpacingPx, lineMaxWidth - lineWidth, true);
          if (split) {
            lineTokens.push(split.head);
            lineWidth += split.head.width;
            lineHyphenated = true;
            lineHardHyphen = split.hard === true;
            lineRepeatNext = repeatHyphen && split.hard === true && !token.bareBreaks;
            tokens[tokenIdx] = split.tail;
            break;
          }
        }
        // Or at the last syllable of the group's own words, so the tail goes
        // down with what touches it: the full stop after **osmosis** never
        // opens a line alone (EF-73). When there is none, the line ends where
        // the runs meet, as before.
        const syllable = lastSyllableInGroup(lineTokens, glued, lineMaxWidth);
        if (syllable) {
          const origIdx = tokenIdx - (lineTokens.length - syllable.at);
          while (lineTokens.length > syllable.at) lineWidth -= lineTokens.pop()!.width;
          const split = splitToken(syllable.token, syllable.bp, '-', syllable.token.hyphenWidth ?? 0, ownFont(syllable.token));
          lineTokens.push(split.head);
          lineWidth += split.head.width;
          tokens[origIdx] = split.tail;
          tokenIdx = origIdx;
          lineHyphenated = true;
          lineSyllable = true;
          break;
        }
      }

      // Two stacked scripts never part (EF-80): the line ends before the
      // pair, or takes it whole when the pair opens it.
      if (token.stacked === 'second' && lineTokens[lineTokens.length - 1]?.stacked === 'first') {
        if (lineTokens.length > 1) {
          lineWidth -= lineTokens.pop()!.width;
          tokenIdx--;
        } else {
          lineTokens.push(token);
          lineWidth += token.width;
          tokenIdx++;
        }
        break;
      }

      // No viable split. If line is empty, force-fit this token; else break to next line.
      if (lineTokens.length === 0) {
        // A word of a joining script wider than the line is never cut: it
        // runs past the measure, and the line says so.
        if (token.width > lineMaxWidth && token.kind === 'text' && joiningScriptIn(token.text)) lineWordOverflow = true;
        lineTokens.push(token);
        lineWidth += token.width;
        tokenIdx++;
      }
      break;
    }

    if (lineTokens.length === 0) break;
    syllableRun = lineSyllable ? syllableRun + 1 : 0;
    repeatPending = lineRepeatNext;

    // Trim trailing spaces from line tokens (a tab stays: a rule to the
    // line's end is a form's blank)
    while (lineTokens.length > 0 && isBreakSpace(lineTokens[lineTokens.length - 1]!)) {
      lineWidth -= lineTokens[lineTokens.length - 1]!.width;
      lineTokens.pop();
    }

    // Check if this is the last line
    // Skip remaining leading spaces to check if there's more content
    let peekIdx = tokenIdx;
    while (peekIdx < tokens.length && isBreakSpace(tokens[peekIdx]!)) {
      peekIdx++;
    }
    const isLastLine = peekIdx >= tokens.length;

    // Build segments for justified rendering
    let segments: VDTLineSegment[] = trimChipLineEdges(lineTokens.map(tokenSegment));
    if (lineTabbed) segments = setTabbedLine(segments, lineTokens, lineMaxWidth, textAlign, isLastLine);

    const lineText = lineTokens.map((t) => cleanSoftHyphens(t.text)).join('');
    const contentWidth = segments.reduce((sum, t) => sum + t.width, 0);

    // A tabbed line is set as measured: its widths are final.
    const spaceRatios = lineTabbed || textAlign !== 'justify' || isLastLine ? {} : justifiedSpaceRatios(segments, lineMaxWidth, normalSpaceWidth);

    lines.push({
      text: lineText,
      bbox: createBoundingBox(lineIndent, y, contentWidth, lineHeightPx),
      baseline: y + baselineOffset,
      hyphenated: lineHyphenated,
      ...(lineHyphenated && lineHardHyphen ? { hardHyphen: true } : {}),
      ...(lineRepeated && lineText.startsWith('-') ? { repeatedHyphen: true } : {}),
      segments,
      isLastLine,
      ...spaceRatios,
      ...(lineWordOverflow ? { wordOverflow: true as const } : {}),
      ...(lineTabbed ? { tabbed: true as const, ...(textAlign === 'justify' ? { ragged: true } : {}) } : {}),
    });

    y += lineHeightPx;
    lineIndex++;
  }

  if (hasSmallCaps) expandSmallCaps(lines, normalFont, boldFont, italicFont, boldItalicFont, letterSpacingPx);
  if (bidi) withDirections(lines, bidi, normalFont, boldFont, italicFont, boldItalicFont);
  if (languages.length > 0) applySegmentLanguages(lines, plainText, languages);
  withKashida(lines);
  markInsetLines(lines, maxWidthPx, options);
  return { lines, totalHeight: y };
}

/** The text a tab at `at` sends to its stop (#622): the tokens after it up
 *  to the next tab or the paragraph's end, spaces at either end left out. */
function tabRun(
  tokens: readonly RichToken[],
  at: number,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
  letterSpacingPx: number,
): TabRun {
  let from = at + 1;
  while (from < tokens.length && tokens[from]!.kind === 'space' && !tokens[from]!.tab) from++;
  let to = from;
  while (to < tokens.length && !tokens[to]!.tab) to++;
  while (to > from && tokens[to - 1]!.kind === 'space') to--;
  let width = 0;
  for (let k = from; k < to; k++) width += tokens[k]!.width;
  return {
    width,
    decimalWidth: (char: string) => {
      if (char.length === 0) return undefined;
      let before = 0;
      for (let k = from; k < to; k++) {
        const t = tokens[k]!;
        const idx = t.kind === 'text' && !t.mathRender && !t.chip && !t.swatch ? t.text.indexOf(char) : -1;
        if (idx >= 0) {
          const head = cleanSoftHyphens(t.text.slice(0, idx));
          const font = tokenFont(t, normalFont, boldFont, italicFont, boldItalicFont);
          return before + textWidth(head, font, t.smallCaps) + (letterSpacingPx === 0 ? 0 : wordLetterSpacing(head, letterSpacingPx) * graphemeCount(head));
        }
        before += t.width;
      }
      return undefined;
    },
  };
}

/**
 * The segments of a line holding a tab at its stop (#622): each tab with a
 * leader becomes the tab's space up to the leader, the leader (`leader`,
 * no character of the text) and the gap after it (an empty space). In a
 * justified paragraph the word spaces after the line's last tab take the
 * slack, the line not being the paragraph's last (the renderers set the
 * line as it is: it is `ragged`); in a centred or right-aligned one an empty
 * space fills the line to its measure, so it is set from its start side as
 * its stops are.
 */
function setTabbedLine(
  segments: VDTLineSegment[],
  lineTokens: readonly RichToken[],
  lineMaxWidth: number,
  textAlign: string,
  isLastLine: boolean,
): VDTLineSegment[] {
  const out: VDTLineSegment[] = [];
  let lastTab = -1;
  segments.forEach((seg, i) => {
    const token = lineTokens[i];
    if (token?.tab) lastTab = out.length;
    const placed = token?.tabPlaced;
    const leader = token?.tabLeader;
    const tabSeg = placed ? { ...seg, tab: { align: placed.align, at: placed.at } } : seg;
    if (!token?.tab || !leader) {
      out.push(tabSeg);
      return;
    }
    out.push({ ...tabSeg, width: Math.max(0, leader.end - leader.width) });
    out.push({ kind: 'text', text: leader.text, width: leader.width, leader: leader.rule ? 'rule' : 'text' });
    const after = seg.width - leader.end;
    if (after > 0) out.push({ kind: 'space', text: '', width: after, labelTab: true });
    lastTab = out.length - 1;
  });
  const natural = out.reduce((sum, seg) => sum + seg.width, 0);
  const slack = lineMaxWidth - natural;
  if (slack > 0.01 && textAlign === 'justify' && !isLastLine) {
    const spaces = out.map((seg, k) => (k > lastTab && seg.kind === 'space' && !seg.labelTab ? k : -1)).filter((k) => k >= 0);
    if (spaces.length > 0) {
      const share = slack / spaces.length;
      for (const k of spaces) out[k] = { ...out[k]!, width: out[k]!.width + share };
    }
  } else if (slack > 0.01 && (textAlign === 'center' || textAlign === 'right')) {
    out.push({ kind: 'space', text: '', width: slack, labelTab: true });
  }
  return out;
}

/** `spans` with their tabs (#622) set as word spaces: vertical text, and a
 *  paragraph the CJK composer sets for its ruby, warichu or kanbun marks. */
export function tabsAsSpaces(spans: readonly InlineSpan[]): InlineSpan[] {
  return spans.map((s) => {
    if (!s.tab) return s;
    const { tab: _tab, ...rest } = s;
    void _tab;
    return { ...rest, text: ' ' };
  });
}

/** Give each Arabic word of a justified paragraph its kashida capacity
 *  (`RichToken.kashida`), which Knuth–Plass counts as the stretch of its
 *  box. A word in pieces (styled runs of a Latin word, a reference label, a
 *  footnote marker) takes none. */
function markKashidaCapacity(
  tokens: RichToken[],
  options: NonNullable<MeasureBlockOptions['kashida']>,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): void {
  for (const t of tokens) {
    if (t.kind !== 'text' || t.inserted || t.mathRender || t.swatch || t.chip || t.refResourceId !== undefined || t.footnoteId !== undefined || t.script) continue;
    if (!joiningScriptIn(t.text)) continue;
    const font = tokenFont(t, normalFont, boldFont, italicFont, boldItalicFont);
    const capacity = kashidaCapacity(t.text, options, measureTextWidth(TATWEEL, font));
    if (capacity > 0) t.kashida = capacity;
  }
}

/** A paragraph's bidi levels (UAX #9, with its inline `:rtl[…]` /
 *  `:ltr[…]` isolates), when it is set right to left, holds a
 *  right-to-left letter or sets a right-to-left isolate; undefined for any
 *  other, which is measured as it always was. */
function paragraphBidi(spans: readonly InlineSpan[], plainText: string, options: MeasureBlockOptions | undefined): BidiParagraph | undefined {
  const base = options?.direction ?? getMeasureDirection();
  const isolated = spans.some((s) => s.direction?.dir === 'rtl');
  if (base !== 'rtl' && !isolated && !needsBidi(plainText)) return undefined;
  return resolveParagraph(plainText, base, spans.some((s) => s.direction) ? spanIsolates(spans) : undefined, getMeasureArabicNumbers() ? { arabicNumbers: true } : undefined);
}

/** The directions of a paragraph's lines (`measure/bidiLines.ts`). A piece
 *  of a segment is measured in its font. */
function withDirections(
  lines: VDTLine[],
  bidi: BidiParagraph,
  normalFont: string,
  boldFont: string,
  italicFont: string,
  boldItalicFont: string,
): void {
  applyLineDirections(lines, bidi, (seg, piece) =>
    textWidth(piece, seg.fontString ?? pickSpanFont(!!seg.bold, !!seg.italic, normalFont, boldFont, italicFont, boldItalicFont), false));
}
