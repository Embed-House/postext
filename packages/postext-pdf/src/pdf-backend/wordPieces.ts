/**
 * The pieces of a word, painted as the word the layout measured (postext
 * #764).
 *
 * The line breaker cuts a word wherever a line may end inside it (its
 * syllables, a dash, the joints of an address), and a line carries each
 * piece as a segment of its own. The engine measures the pieces in one of
 * two ways. A plain paragraph hands them to its text library one by one:
 * each piece is as wide as it is alone. A paragraph with a style, a link
 * or a note in it is cut word by word, and there a piece is as wide as
 * the word grew by it: `instal·lació` comes as `ins`, `tal·`, `la`, `ció`,
 * and the width of `la` is that of `instal·la` less that of `instal·`.
 *
 * In the second way the browser measured those strings whole, and a face
 * may draw a character otherwise by what stands beside it across a cut.
 * Crimson Pro sets the dot of a Catalan `l·l` 0.586 em wide in Catalan
 * and 0.24 em anywhere else: `tal·` shaped alone has the narrow dot, the
 * piece after it the room of the wide one, and the word printed with a
 * hole after `la`. A ligature (`of`, `fi`, `ce`) and a kerned pair across
 * a cut go the same way.
 *
 * A line does not say which way its words were measured, so the PDF asks
 * its own shaper, in a document shaped in its own language: the pieces of
 * a word that follow each other in one style are joined again, and the
 * word shaped once, when the word shaped whole is as wide as the layout
 * measured its pieces together and the pieces shaped apart are not. Its
 * glyphs are then the ones measured. Any other word is painted piece by
 * piece, as every word of a document that keeps the host's language is,
 * and was up to postext-pdf 1.29.
 *
 * A word broken across two lines is not put back: the piece that opens
 * the second line keeps the width the layout gave it, and is shaped as
 * the text it is.
 */
import type { VDTLine, VDTLineSegment } from 'postext';
import { shapesSegmentLanguages } from '../shapingLanguage';

/** What two pieces may carry and still be joined, when both carry the
 *  same: their style, their link, their language. A segment with anything
 *  else (a reference, a script of its own, a ruby, styled runs, a
 *  direction) is painted as it is. */
const SHARED: ReadonlySet<string> = new Set(['kind', 'text', 'width', 'bold', 'italic', 'href', 'captionLabel', 'fontString', 'color', 'script', 'baselineShift', 'lang']);
const JOINED: readonly (keyof VDTLineSegment)[] = ['bold', 'italic', 'href', 'captionLabel', 'fontString', 'color', 'script', 'baselineShift', 'lang'];

/** Text of the scripts a line sets word by word: nothing from the CJK
 *  blocks on, whose characters the layout measures one by one. */
const WORD_TEXT_RE = /^[\u0000-\u2E7F]+$/;

/** How far two widths of a word may be apart and still be the same, as a
 *  part of the wider: above the rounding of two sums of advances, below
 *  any kerned pair. */
const SAME_WIDTH = 0.0005;

function joinable(seg: VDTLineSegment): boolean {
  if (seg.kind !== 'text' || !WORD_TEXT_RE.test(seg.text)) return false;
  for (const key in seg) if (!SHARED.has(key)) return false;
  return true;
}

function sameStyle(a: VDTLineSegment, b: VDTLineSegment): boolean {
  return JOINED.every((key) => a[key] === b[key]);
}

function sameWidth(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_WIDTH * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * The segments a line is painted from: its own, with the pieces of a
 * word joined into one segment where the word was measured whole (see the
 * module comment). `advanceOf` is the advance the PDF gives `text` in the
 * style of the segment `seg` (px, with the line's character spacing).
 *
 * The line's own array when nothing is joined: a line of the CJK composer
 * or down a vertical page (`composed`), a line that carries directions
 * (its `order` counts its segments), a document that keeps the host's
 * language, a line whose words in pieces were measured piece by piece.
 */
export function wordSegments(line: VDTLine, composed: boolean, advanceOf: (seg: VDTLineSegment, text: string) => number): VDTLineSegment[] | undefined {
  const segments = line.segments;
  if (!segments || composed || !shapesSegmentLanguages() || line.order !== undefined || segments.some((s) => s.rtl)) return segments;
  let joined: VDTLineSegment[] | undefined;
  for (let from = 0; from < segments.length;) {
    let to = from + 1;
    if (joinable(segments[from]!)) while (to < segments.length && joinable(segments[to]!) && sameStyle(segments[from]!, segments[to]!)) to++;
    const pieces = segments.slice(from, to);
    const word = pieces.length > 1 ? wholeWord(pieces, advanceOf) : undefined;
    if (word) (joined ??= segments.slice(0, from)).push(word);
    else joined?.push(...pieces);
    from = to;
  }
  return joined ?? segments;
}

/** The pieces of one word as one segment, when the word was measured
 *  whole: shaped whole it is as wide as its pieces together, shaped apart
 *  they are not. Undefined otherwise. */
function wholeWord(pieces: readonly VDTLineSegment[], advanceOf: (seg: VDTLineSegment, text: string) => number): VDTLineSegment | undefined {
  const first = pieces[0]!;
  const measured = pieces.reduce((sum, piece) => sum + piece.width, 0);
  const apart = pieces.reduce((sum, piece) => sum + advanceOf(first, piece.text), 0);
  if (sameWidth(apart, measured)) return undefined;
  const text = pieces.map((piece) => piece.text).join('');
  return sameWidth(advanceOf(first, text), measured) ? { ...first, text, width: measured } : undefined;
}
