import { graphemesOf } from '../measure/graphemes';

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
 */

/** One piece of a word painted apart from the rest. */
export interface TrackedPiece {
  text: string;
  /** Where the piece starts in the word's natural shaping, px from its start. */
  offset: number;
  /** Glyphs of the word before the piece: each takes the tracking once (a
   *  ligature is one glyph, as in the PDF). */
  glyphsBefore: number;
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

/** Font string → what is known of each text set in it. */
const knownByFont = new Map<string, { otherwise: Map<string, boolean>; pieces: Map<string, readonly TrackedPiece[] | null> }>();

type Ctx = Pick<CanvasRenderingContext2D, 'font' | 'letterSpacing' | 'measureText'>;

function known(font: string): { otherwise: Map<string, boolean>; pieces: Map<string, readonly TrackedPiece[] | null> } {
  let k = knownByFont.get(font);
  if (!k) knownByFont.set(font, k = { otherwise: new Map(), pieces: new Map() });
  return k;
}

function widthAt(ctx: Ctx, text: string, spacing: number): number {
  ctx.letterSpacing = `${spacing}px`;
  return ctx.measureText(text).width;
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
  const { otherwise: words } = known(font);
  let changed = words.get(text);
  if (changed === undefined) {
    changed = probe(ctx, text);
    if (words.size >= MAX_WORDS) words.clear();
    words.set(text, changed);
  }
  return changed;
}

function piecesOf(ctx: Ctx, font: string, text: string): readonly TrackedPiece[] | null {
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
  ctx.letterSpacing = '0px';
  const natural = (from: number, to: number): number => ctx.measureText(letters.slice(from, to).join('')).width;
  let glyphs = 0;
  return groups.map((g) => {
    // Up to the piece's first letter in the natural shaping, the kerning
    // before it counted: the pieces meet as the whole word's letters do.
    const offset = g.start === 0 ? 0 : natural(0, g.start + 1) - natural(g.start, g.start + 1);
    const piece = { text: letters.slice(g.start, g.end).join(''), offset, glyphsBefore: glyphs, ligature: g.ligature };
    glyphs += g.ligature ? 1 : g.end - g.start;
    return piece;
  });
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
  const spacing = ctx.letterSpacing;
  const changed = otherwise(ctx, ctx.font, text);
  ctx.letterSpacing = spacing;
  return changed;
}

/**
 * The pieces a tracked word is painted in, in the context's font, or null
 * when it is painted whole (the browser shapes it the same under
 * letter-spacing, or the context measures none). The context's
 * `letterSpacing` is put back as it was found.
 */
export function trackedPieces(ctx: CanvasRenderingContext2D, text: string): readonly TrackedPiece[] | null {
  if (text.length < 2 || !measures(ctx)) return null;
  const font = ctx.font;
  const { pieces: words } = known(font);
  let pieces = words.get(text);
  if (pieces === undefined) {
    const spacing = ctx.letterSpacing;
    pieces = piecesOf(ctx, font, text);
    ctx.letterSpacing = spacing;
    if (words.size >= MAX_WORDS) words.clear();
    words.set(text, pieces);
  }
  return pieces;
}

/**
 * Paint a word of a tracked line with `paint` (the caller's `fillText`) at
 * `x`, `y`. `tracking` is the context's `letterSpacing` on entry, px, and
 * on return. A word that would lose its ligatures to it is painted in its
 * {@link trackedPieces}; any other with one `paint`.
 */
export function fillTrackedWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  paint: (text: string, x: number, y: number) => void,
): void {
  const pieces = tracking !== 0 ? trackedPieces(ctx, text) : null;
  if (!pieces) {
    paint(text, x, y);
    return;
  }
  for (const piece of pieces) {
    if (piece.ligature) ctx.letterSpacing = '0px';
    paint(piece.text, x + piece.offset + tracking * piece.glyphsBefore, y);
    if (piece.ligature) ctx.letterSpacing = `${tracking}px`;
  }
}
