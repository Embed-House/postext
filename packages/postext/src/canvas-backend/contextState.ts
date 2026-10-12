/**
 * What a painting context does not keep, or does not tell (#764).
 *
 * Measured on Chrome 131 and 154, on a DOM canvas and an `OffscreenCanvas`:
 *
 * - `save()` makes a state whose language is `inherit` again:
 *   `ctx.lang = 'ar'; ctx.save(); ctx.lang` reads `inherit`, a nested save
 *   too, and `restore()` brings `ar` back. A page is painted inside saved
 *   states from its first column on (a clip, a transform, a style to give
 *   back), so every text of it was painted in the language of the page
 *   that hosts the canvas, whatever the painter had set: with glyphs of
 *   other widths than the layout measured in the document's language.
 * - inside a saved state `ctx.letterSpacing` and `ctx.wordSpacing` read
 *   `""` until another value is set, though the spacing in force is the
 *   one of the state saved. A painter that read the spacing to put it back
 *   after a word painted without it assigned `""`, which the canvas
 *   ignores: the rest of that state was painted with no letter-spacing (a
 *   chip of a tracked line after its Arabic run).
 *
 * So the backend saves and restores through this module, and sets the
 * letter-spacing through it:
 *
 * - {@link saveContext} carries the language into the new state
 *   ({@link languageOf} reads it: that getter tells the truth);
 * - {@link setLetterSpacing} sets the spacing and remembers it, per saved
 *   state; {@link letterSpacingOf} answers what was set. Nothing reads the
 *   spacing back from the context.
 *
 * Every `save()`, `restore()` and letter-spacing of the paint code goes
 * through here (`contextState.test.ts` scans the sources for a bare one).
 *
 * The word spacing is the key of the word cache a text is painted from
 * (#770, `contextText.ts`). It reads `""` inside a saved state as the
 * letter-spacing does, but nothing reads it: it is set before every text,
 * a value set inside a saved state is taken, and `restore()` brings the
 * outer one back (the same sequences measured on Chrome 154, three states
 * deep). So neither `saveContext` nor `restoreContext` carries it.
 */

/** The language a context has until someone sets one: the host's. */
const HOST_LANGUAGE = 'inherit';

/** Context → the letter-spacing set in each of its saved states, px, the
 *  innermost last. A context nothing was set on has no entry: no spacing. */
const spacings = new WeakMap<object, number[]>();

/**
 * `ctx.save()`, the new state in the language of the one saved. A context
 * whose language is the host's (`inherit`: nobody set one) or that has
 * none (an older browser) is saved as it is.
 */
export function saveContext(ctx: { save(): void }): void {
  const lang = (ctx as { lang?: unknown }).lang;
  ctx.save();
  if (typeof lang === 'string' && lang !== HOST_LANGUAGE) (ctx as { lang?: unknown }).lang = lang;
  const stack = spacings.get(ctx);
  if (stack) stack.push(stack[stack.length - 1] ?? 0);
}

/** `ctx.restore()` of a state saved with {@link saveContext}: the context
 *  has the language and the letter-spacing of the state it comes back to. */
export function restoreContext(ctx: { restore(): void }): void {
  ctx.restore();
  spacings.get(ctx)?.pop();
}

/** Set the context's letter-spacing, px after every letter. */
export function setLetterSpacing(ctx: { letterSpacing: string }, px: number): void {
  ctx.letterSpacing = `${px}px`;
  const stack = spacings.get(ctx);
  if (!stack) spacings.set(ctx, [px]);
  else if (stack.length === 0) stack.push(px);
  else stack[stack.length - 1] = px;
}

/** The letter-spacing in force on the context, px: the one set last with
 *  {@link setLetterSpacing} in its state or in the states around it, 0
 *  when none was. */
export function letterSpacingOf(ctx: object): number {
  const stack = spacings.get(ctx);
  return stack?.[stack.length - 1] ?? 0;
}

/** The language set on a context: undefined for the host's (`inherit`)
 *  and for a context that has none. What a painter that places text by
 *  its measured widths asks the measuring module to measure in
 *  (`withMeasureLanguage`). */
export function languageOf(ctx: object): string | undefined {
  const lang = (ctx as { lang?: unknown }).lang;
  return typeof lang === 'string' && lang !== HOST_LANGUAGE ? lang : undefined;
}

/** Forget what was set on a context whose state is new: a canvas just
 *  given its size has no saved state, no letter-spacing and the host's
 *  language. */
export function resetContextState(ctx: object): void {
  spacings.delete(ctx);
}
