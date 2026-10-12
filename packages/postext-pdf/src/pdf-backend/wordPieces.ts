/**
 * The pieces of a word, painted as the word the layout measured (postext
 * #764, #770).
 *
 * The line breaker cuts a word wherever a line may end inside it, and a
 * line carries each piece as a segment of its own. In a paragraph with a
 * style, a link or a note a piece is as wide as the word grew by it, so a
 * face that draws across a cut (the dot of a Catalan `l·l` in Crimson
 * Pro, a ligature, a kerned pair) leaves a hole or an overlap when the
 * pieces are shaped one by one.
 *
 * Which pieces are set as one text is the engine's rule
 * (`lineWordSegments` of postext, `wordPieces.ts` there): the same for
 * the canvas, the HTML and the PDF, each asking its own text setter. It
 * also sets apart the hyphen of a line end where the layout measured it
 * apart, and sets the rest of a word that opens a line as one text. Here
 * it is asked of the PDF's shaper, in a document shaped in its own
 * language; a document that keeps the host's language is painted piece by
 * piece, as every word was up to postext-pdf 1.29, and prints the same
 * bytes.
 */
import { lineWordSegments } from 'postext';
import type { VDTLine, VDTLineSegment } from 'postext';
import { shapesSegmentLanguages } from '../shapingLanguage';

/**
 * The segments a line is painted from: its own, with the pieces of a
 * word joined into one segment where the word was measured whole, and
 * the hyphen of a line end as a segment of its own where the layout
 * measured it apart. `advanceOf` is the advance the PDF gives `text` in
 * the style of the segment `seg` (px, with the line's character spacing).
 *
 * The line's own array when nothing changes: a line of the CJK composer
 * or down a vertical page (`composed`), a line that carries directions,
 * a document that keeps the host's language, a line whose pieces are each
 * as wide alone as measured.
 */
export function wordSegments(line: VDTLine, composed: boolean, advanceOf: (seg: VDTLineSegment, text: string) => number): VDTLineSegment[] | undefined {
  if (!shapesSegmentLanguages()) return line.segments;
  return lineWordSegments(line, composed, advanceOf);
}
