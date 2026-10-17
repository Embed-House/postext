/**
 * When the Checks panel waits to be asked (#952): laying out every chapter
 * of every edition behind the reader costs a whole book per language, so a
 * big multilingual book shows the chapter on screen and a button for the
 * rest. Small books keep checking everything at once, as before.
 */

/** Most chapter layouts (the book's chapters times its editions) the panel
 *  starts unasked. A book of 24 chapters in two editions stays under it. */
export const AUTO_EDITION_LAYOUTS = 48;

/** Whether the editions of a book are laid out only when asked: it has
 *  several, and checking all of them lays out more than
 *  {@link AUTO_EDITION_LAYOUTS} chapters. */
export function editionsOnDemand(chapterCount: number, editionCount: number): boolean {
  return editionCount > 1 && chapterCount * editionCount > AUTO_EDITION_LAYOUTS;
}
