/**
 * A text painted as wide as it was measured, whatever the context painted
 * before (#770).
 *
 * Chrome's canvas keeps the words it shaped, per context, font, language
 * and a few attributes, under the word's text alone (`measure/canvas.ts`
 * tells the whole of it). A word shapes two ways: in a string of Latin-1
 * characters held one byte each it is all Latin script; in a string that
 * holds a wider character, or that V8 still holds two bytes a character
 * (a slice of 13 characters or more of such a text, a string that came
 * through a structured clone of one), each word is taken alone and a word
 * with no letter is drawn by the font's default rules. The first shape to
 * enter the cache answers for both. Measured on Chrome 154, Noto Serif SC
 * at 10 px in English: `2016` is 22 px wide alone on a fresh context and
 * 21.44 px once a line holding `2016` and a Han character was painted
 * there; the cache outlives `canvas.width = …`, so it is the page's for
 * as long as its canvas lives. Of 44 strings painted in eight orders on
 * one canvas, 19 changed width with the order in that face, 10 in Amiri.
 *
 * The measurer of a document shaped in its own language has a context per
 * kind of string. A page has one canvas, so the painter keeps two caches
 * on it. The word spacing is part of the cache's key, and one of
 * `1e-9px` moves nothing: 52 224 measures (51 faces, web and system, two
 * languages, four sizes, both directions, with and without a
 * letter-spacing) give the widths and the ink boxes of `0px` to the last
 * bit, and 126 paintings the same pixels. A string with a character past
 * U+00FF is handed over under that spacing, any other under `0px`,
 * rebuilt one byte a character. So each string is set as a context that
 * never painted anything sets it, which is what the layout measured; a
 * document in its host's language, measured on one context word by word,
 * is painted the same way. The page sets no other word spacing.
 *
 * (`fontKerning = 'normal'` and `textRendering = 'optimizeLegibility'`
 * key a second cache too and shape a web face as the defaults do, but not
 * a system face: Avenir Next sets `To AV Ty.` 40.64 px wide at 10 px
 * under `'auto'` and 40.04 px under `'normal'`, and a kana of a fallback
 * face is kerned under `'normal'` only.)
 *
 * The spacing is set before every call. Inside a saved state it reads
 * `""` (`contextState.ts`), but a value set there is taken, and
 * `restore()` brings the outer one back: nothing has to carry it. A
 * canvas given a size starts at `0px` again.
 *
 * Every `fillText`, `strokeText` and `measureText` of the paint code goes
 * through here (`contextText.test.ts` scans the sources for a bare one):
 * a measure taken on the painting context must read the cache the text is
 * painted from. `mirrorFrame.ts` wraps the context's own methods for a
 * mirrored page and is called from here like the context.
 */

/** A character past Latin-1: a string that holds one is two bytes a
 *  character to the browser. */
const WIDE_RE = /[^\u0000-ÿ]/;

/** The word spacing that keys the cache of the strings with a character
 *  past Latin-1: too small to move a glyph (a float of 32 bits holds an
 *  advance to 1e-7 of its size), another value than `0px` to the cache. */
const WIDE_SPACING = '1e-9px';
const NARROW_SPACING = '0px';

/** What the calls below ask of a context. */
type TextContext = Pick<CanvasRenderingContext2D, 'fillText' | 'strokeText' | 'measureText'>;

/**
 * `text` as it is handed to `ctx`, the context set to the word cache of
 * its kind: as it is under the word spacing of the wide strings when it
 * holds a character past U+00FF, else one byte a character under `0px`.
 * A context without the attribute (an older browser, a test's stub) takes
 * the string all the same.
 */
export function handedText(ctx: object, text: string): string {
  const wide = WIDE_RE.test(text);
  if ('wordSpacing' in ctx) (ctx as { wordSpacing: string }).wordSpacing = wide ? WIDE_SPACING : NARROW_SPACING;
  if (wide) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) out += text[i];
  return out;
}

/** `ctx.fillText(text, x, y)`, the text set as a fresh context sets it. */
export function fillContextText(ctx: Pick<TextContext, 'fillText'>, text: string, x: number, y: number): void {
  ctx.fillText(handedText(ctx, text), x, y);
}

/** `ctx.strokeText(text, x, y)`, as {@link fillContextText}. */
export function strokeContextText(ctx: Pick<TextContext, 'strokeText'>, text: string, x: number, y: number): void {
  ctx.strokeText(handedText(ctx, text), x, y);
}

/** `ctx.measureText(text)`: the metrics {@link fillContextText} paints
 *  `text` at, in the context's font, language, spacing and direction. */
export function measureContextText(ctx: Pick<TextContext, 'measureText'>, text: string): TextMetrics {
  return ctx.measureText(handedText(ctx, text));
}

/** The advance {@link fillContextText} paints `text` at, px. */
export function contextTextWidth(ctx: Pick<TextContext, 'measureText'>, text: string): number {
  return ctx.measureText(handedText(ctx, text)).width;
}

/** Leave a context at the word spacing a canvas has when it is given its
 *  size, `0px`: what the host paints on the page afterwards reads the
 *  cache of the Latin-1 strings, as on a canvas nothing was painted on.
 *  Nothing is read back: inside a saved state the context would answer
 *  `""` (`contextState.ts`). */
export function resetWordSpacing(ctx: object): void {
  if ('wordSpacing' in ctx) (ctx as { wordSpacing: string }).wordSpacing = NARROW_SPACING;
}
