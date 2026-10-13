import { bidiClassOf, needsBidi } from '../bidi';
import { graphemesOf } from '../measure/graphemes';
import { joiningScriptIn } from '../measure/joining';
import { paintAsOneRun } from './mirrorFrame';
import { letterSpacingOf, setLetterSpacing } from './contextState';
import { contextTextWidth } from './contextText';

/**
 * Tracked words keep their ligatures (#663).
 *
 * A tracked word is measured as its natural width plus the tracking times
 * its letters (`measure/rich.ts`, `knuthPlass/tracking.ts`), and its natural
 * width counts the ligatures of the face (fi, fl, ffi…). Painted with the
 * context's `letterSpacing`, the browser shapes it without them (CSS Text:
 * no optional ligatures where the letter-spacing is not zero): "first" in
 * Newsreader comes out 4.5 px wider at 40 px than the place the layout
 * holds for it, and runs into the word space after it. The canvas has no
 * way to ask for the ligatures back, so such a word is painted in pieces:
 * each ligature alone with no letter-spacing, the letters between them
 * tracked, every piece where the natural shaping puts it. The PDF does the
 * same by construction (it shapes the word and spaces its glyphs).
 *
 * Which words: the ones whose width at a letter-spacing, less that
 * letter-spacing, is not their natural width. A word the browser shapes
 * the same either way (nearly all of them) is painted as before, with one
 * `fillText`.
 *
 * The same holds for any tracked text painted with one `fillText` (#703):
 * a line or a run of a design text (running heads, openers, callout
 * titles, balloon lettering) and the sideways Latin run of a vertical
 * line come through here as a word does.
 *
 * Three rules of direction (#685, #703):
 * - the pieces are one run. On a right-to-left page, painted through a
 *   mirror that turns every `fillText` back about its own box
 *   (`mirrorFrame.ts`), the word is turned once, about the box it was
 *   measured in, and its pieces are set inside it from its left end, as on
 *   a left-to-right page. Turned one by one they stood in the mirror's
 *   order: "five" read "vefi";
 * - a word that holds a letter of a joining script (Arabic…) is never cut,
 *   whoever asks: painted in pieces it loses its joins. Nor is a text in
 *   two directions (a Hebrew word with a number or a Latin letter in it):
 *   its pieces would not stand in one order;
 * - a right-to-left word of a script that does not join (Hebrew) is cut
 *   like any other, where the painter set the context right to left for
 *   it (`fillSegmentWord`, `paintRunInDirection`): its pieces are set from
 *   the right end of its box, each painted right to left.
 *
 * The tracking of a ligature (#770). The layout counts the tracking once
 * a letter: a word is its natural width and the tracking times its
 * letters, and that is what the browser paints wherever the
 * letter-spacing dissolves nothing (Geist's `fi` is one glyph as wide as
 * `f` and `i`: under a letter-spacing the two letters are set apart, each
 * with the tracking after it). A ligature painted alone advanced by one
 * tracking, as one glyph, so a word that held one ended a tracking short
 * of its box for each letter the ligature had joined: `shift` in Source
 * Serif 4 at 19.58 px on a line justified with 0.39 px a letter, box
 * 43.37 px, painted 42.98 px, and `efit` on a line tightened by 0.34 px
 * ran 0.34 px over the word after it. In a document shaped in its own
 * language ({@link setLetterTracking}) the piece after a ligature starts
 * the tracking of every letter before it further on, the ligature's
 * letters each counted: the word ends where its box does, and the HTML
 * and the PDF set it the same. A document that keeps its host's language
 * is painted as it was, and so is a right-to-left word of any document
 * (a Hebrew face with a ligature): one tracking a ligature in the three
 * outputs.
 */

/** One piece of a word painted apart from the rest. */
export interface TrackedPiece {
  text: string;
  /** Where the piece starts in the word's natural shaping, px from its
   *  start: its left end, or its right end for a right-to-left word. */
  offset: number;
  /** Glyphs of the word before the piece: each takes the tracking once (a
   *  ligature is one glyph, as in the PDF of a document that keeps its
   *  host's language). */
  glyphsBefore: number;
  /** Letters (graphemes) of the word before the piece, the letters of a
   *  ligature each counted: what the layout counted the tracking of. */
  lettersBefore: number;
  /** A ligature: painted with no letter-spacing. */
  ligature: boolean;
}

/** Letter-spacing the words are probed with, px. */
const PROBE = 1;
/** Least difference, px, between a word's natural width and its width
 *  under letter-spacing (the spacing taken off) that counts as another
 *  shaping: above the noise of `measureText`, below any ligature. */
const TOLERANCE = 0.05;
/** Words remembered per font before the memory starts over. */
const MAX_WORDS = 8192;

/** A word painted in pieces. */
interface TrackedWord {
  pieces: readonly TrackedPiece[];
  /** The word's natural width, px: its ligatures counted, no tracking. */
  natural: number;
  /** Its letters (graphemes): each was measured with the tracking after it. */
  letters: number;
  /** A right-to-left word: its pieces run from the right end of its box. */
  rtl: boolean;
}

/** What is known of each text set in a font. */
interface Known {
  otherwise: Map<string, boolean>;
  words: Map<string, TrackedWord | null>;
}

/** Font string → what is known of each text set in it. */
const knownByFont = new Map<string, Known>();

/** Whether a ligature takes the tracking of each of its letters (see
 *  {@link setLetterTracking}). */
let letterTracking = false;

/** Give a ligature of a tracked word the tracking of every letter it
 *  joins from now on (`on`), as the layout counted it, or of one glyph as
 *  up to postext 1.29: the page painter says which for the document it
 *  paints (`bodyText.shapingLanguage`, through `setSegmentLanguages`). */
export function setLetterTracking(on: boolean): void {
  letterTracking = on;
}

type Ctx = Pick<CanvasRenderingContext2D, 'font' | 'letterSpacing' | 'measureText'>;

/** Bidi classes a right-to-left run holds at one level whatever stands
 *  beside them: its letters, their marks, and the neutral characters that
 *  take the run's direction. A digit, a Latin letter or a bidi control
 *  makes a second level. */
const ONE_LEVEL_RTL: ReadonlySet<string> = new Set(['R', 'AL', 'NSM', 'WS', 'ON', 'CS', 'ES', 'ET']);

function known(ctx: object, font: string): Known {
  // A face ligates otherwise under a language (no `fi` in Turkish): the
  // context's own is part of the key (#764).
  const lang = (ctx as { lang?: unknown }).lang;
  const key = typeof lang === 'string' && lang !== 'inherit' ? `${lang}\u0000${font}` : font;
  let k = knownByFont.get(key);
  if (!k) knownByFont.set(key, k = { otherwise: new Map(), words: new Map() });
  return k;
}

/** The direction `text` runs in when it may be painted in pieces at all
 *  (see the module comment), else null: left to right with no
 *  right-to-left letter in it, right to left when it is one run of a
 *  script that does not join. */
function divisible(text: string): 'ltr' | 'rtl' | null {
  if (joiningScriptIn(text)) return null;
  if (!needsBidi(text)) return 'ltr';
  for (const ch of text) {
    if (!ONE_LEVEL_RTL.has(bidiClassOf(ch.codePointAt(0)!))) return null;
  }
  return 'rtl';
}

function widthAt(ctx: Ctx, text: string, spacing: number): number {
  setLetterSpacing(ctx, spacing);
  return contextTextWidth(ctx, text);
}

/** {@link shapedOtherwise}, measured: the context's `letterSpacing` is
 *  left at any value. */
function probe(ctx: Ctx, text: string): boolean {
  const natural = widthAt(ctx, text, 0);
  const one = widthAt(ctx, text, PROBE);
  const two = widthAt(ctx, text, 2 * PROBE);
  // What one more unit of spacing adds: the spacing after each letter.
  const step = two - one;
  // A measurer that takes no letter-spacing (a test stub, an old browser).
  if (!(step > PROBE / 2)) return false;
  return Math.abs(one - step - natural) > TOLERANCE;
}

function otherwise(ctx: Ctx, font: string, text: string): boolean {
  const { otherwise: words } = known(ctx, font);
  let changed = words.get(text);
  if (changed === undefined) {
    changed = probe(ctx, text);
    if (words.size >= MAX_WORDS) words.clear();
    words.set(text, changed);
  }
  return changed;
}

function wordOf(ctx: Ctx, font: string, text: string): TrackedWord | null {
  const direction = divisible(text);
  if (!direction) return null;
  const letters = graphemesOf(text);
  if (letters.length < 2 || !otherwise(ctx, font, text)) return null;
  // Two neighbours that shape otherwise under letter-spacing are a
  // ligature; a third joins them the same way (f + f + i).
  const groups: { start: number; end: number; ligature: boolean }[] = [];
  let ligatures = 0;
  for (let k = 0; k < letters.length;) {
    let end = k + 1;
    while (end < letters.length && otherwise(ctx, font, letters[end - 1]! + letters[end]!)) end++;
    const ligature = end - k > 1;
    const last = groups[groups.length - 1];
    if (!ligature && last && !last.ligature) last.end = end;
    else groups.push({ start: k, end, ligature });
    if (ligature) ligatures++;
    k = end;
  }
  // Shaped otherwise as a whole but by no pair of neighbours: left as it was.
  if (ligatures === 0) return null;
  setLetterSpacing(ctx, 0);
  const natural = (from: number, to: number): number => contextTextWidth(ctx, letters.slice(from, to).join(''));
  let glyphs = 0;
  const pieces = groups.map((g) => {
    // Up to the piece's first letter in the natural shaping, the kerning
    // before it counted: the pieces meet as the whole word's letters do.
    const offset = g.start === 0 ? 0 : natural(0, g.start + 1) - natural(g.start, g.start + 1);
    const piece = { text: letters.slice(g.start, g.end).join(''), offset, glyphsBefore: glyphs, lettersBefore: g.start, ligature: g.ligature };
    glyphs += g.ligature ? 1 : g.end - g.start;
    return piece;
  });
  return { pieces, natural: natural(0, letters.length), letters: letters.length, rtl: direction === 'rtl' };
}

/** {@link trackedPieces} with the word's measures. A word is cut only
 *  where the context paints in its direction: a right-to-left word in a
 *  context set right to left, any other in one that is not (a run of
 *  brackets painted right to left is mirrored and reordered, never cut). */
function trackedWord(ctx: CanvasRenderingContext2D, text: string): TrackedWord | null {
  if (text.length < 2 || !measures(ctx)) return null;
  const font = ctx.font;
  const { words } = known(ctx, font);
  let word = words.get(text);
  if (word === undefined) {
    const spacing = letterSpacingOf(ctx);
    word = wordOf(ctx, font, text);
    setLetterSpacing(ctx, spacing);
    if (words.size >= MAX_WORDS) words.clear();
    words.set(text, word);
  }
  if (word && word.rtl !== ('direction' in ctx && ctx.direction === 'rtl')) return null;
  return word;
}

/** Whether the context can be asked: it has a `letterSpacing` and measures. */
function measures(ctx: CanvasRenderingContext2D): boolean {
  return 'letterSpacing' in ctx && typeof ctx.measureText === 'function';
}

/**
 * Whether the browser shapes `text`, in the context's font, otherwise once
 * a letter-spacing is set: its width at a letter-spacing, that spacing
 * taken off, is not its natural width (it holds a ligature the
 * letter-spacing turns off). False where the context measures no
 * letter-spacing. The context's `letterSpacing` is put back as it was
 * found.
 */
export function shapedOtherwise(ctx: CanvasRenderingContext2D, text: string): boolean {
  if (text.length < 2 || !measures(ctx)) return false;
  const spacing = letterSpacingOf(ctx);
  const changed = otherwise(ctx, ctx.font, text);
  setLetterSpacing(ctx, spacing);
  return changed;
}

/**
 * The pieces a tracked word is painted in, in the context's font and
 * direction, or null when it is painted whole (the browser shapes it the
 * same under letter-spacing, the context measures none, the word holds a
 * joining letter or text in two directions, or the context paints the
 * other way). The context's `letterSpacing` is put back as it was found.
 */
export function trackedPieces(ctx: CanvasRenderingContext2D, text: string): readonly TrackedPiece[] | null {
  return trackedWord(ctx, text)?.pieces ?? null;
}

/**
 * Paint a word of a tracked line, or any tracked text set as one run (a
 * line or a run of a design text, a sideways run of a vertical line), with
 * `paint` (the caller's `fillText`) at `x`, `y`: its left end on a
 * left-to-right page, the start of its box in a mirrored frame. `tracking`
 * is the context's `letterSpacing` on entry, px, and on return. A text
 * that would lose its ligatures to it is painted in its
 * {@link trackedPieces}, as one run (`paintAsOneRun`): its box is the one
 * the frame turns a text painted whole about, its natural width and the
 * tracking after each letter. A right-to-left word (the context set right
 * to left and aligned on its left edge by the caller) has its pieces set
 * from the right end of that box. Any other text with one `paint`.
 * Returns the advance of a text painted in pieces, the width it was
 * measured at, and undefined for one painted whole.
 */
export function fillTrackedWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  paint: (text: string, x: number, y: number) => void,
): number | undefined {
  const word = tracking !== 0 ? trackedWord(ctx, text) : null;
  if (!word) {
    paint(text, x, y);
    return undefined;
  }
  const width = word.natural + tracking * word.letters;
  paintAsOneRun(ctx, x, width, () => {
    const align = ctx.textAlign;
    // Each piece of a right-to-left word from its own right end.
    if (word.rtl) ctx.textAlign = 'right';
    for (const piece of word.pieces) {
      // A right-to-left word keeps one tracking a ligature, as in the
      // HTML and the PDF.
      const at = piece.offset + tracking * (letterTracking && !word.rtl ? piece.lettersBefore : piece.glyphsBefore);
      if (piece.ligature) setLetterSpacing(ctx, 0);
      paint(piece.text, word.rtl ? x + width - at : x + at, y);
      if (piece.ligature) setLetterSpacing(ctx, tracking);
    }
    if (word.rtl) ctx.textAlign = align;
  });
  return width;
}
