/**
 * The pieces of a word, set as the word the layout measured (#764, #770).
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
 * and 0.24 em anywhere else: `tal·` set alone has the narrow dot, the
 * piece after it the room of the wide one, and the word shows a hole
 * after `la`. A ligature (`ffi` of `of|fice`) and a kerned pair (`y|o` of
 * `Toy|ota`) across a cut go the same way.
 *
 * A line does not say which way its words were measured, so each output
 * asks the text setter it paints with (the canvas, the browser's layout,
 * the PDF's shaper): the pieces that follow each other in one style are
 * set as one text where that text is as wide as the layout measured the
 * pieces together and one of them alone is not as wide as its place.
 * Its glyphs are then the ones measured. Any other piece is set alone, as
 * every piece was up to postext 1.29.
 *
 * The hyphen a line ends on is measured alone, after the word's last
 * piece. Where that piece with its hyphen is not as wide as its place
 * (the face kerns the pair, or the piece is one of several), the hyphen
 * is set apart when what is left then is.
 *
 * A word broken across two lines is not put back. The piece that opens
 * the second line is as wide as the word grew by it from what stayed on
 * the first, so alone it is off by whatever the face drew across the
 * break. The pieces of that rest are set as one text when that text is
 * off by as much as its first piece alone: its letters then stand
 * together, and the difference falls after the word, where it stood
 * inside it. The layout's measure of that piece is not changed here.
 *
 * The canvas, the HTML and the PDF call {@link lineWordSegments}, so the
 * three set the same pieces together.
 */
import type { VDTLine, VDTLineSegment } from './vdt';

/** A piece of a word as a line carries it: its text and the width the
 *  layout gave it. */
export interface WordPiece {
  readonly text: string;
  readonly width: number;
}

/** What two pieces may carry and still be joined, when both carry the
 *  same: their style, their link, their language. A segment with anything
 *  else (a reference, a script of its own, a ruby, styled runs, a
 *  direction) is set as it is. */
const SHARED: ReadonlySet<string> = new Set(['kind', 'text', 'width', 'bold', 'italic', 'href', 'captionLabel', 'fontString', 'color', 'script', 'baselineShift', 'lang']);
const JOINED: readonly (keyof VDTLineSegment)[] = ['bold', 'italic', 'href', 'captionLabel', 'fontString', 'color', 'script', 'baselineShift', 'lang'];

/** Text of the scripts a line sets word by word: nothing from the CJK
 *  blocks on, whose characters the layout measures one by one. */
const WORD_TEXT_RE = /^[\u0000-\u2E7F]+$/;

/** How far two widths of a word may be apart and still be the same, as a
 *  part of the wider: above the rounding of two sums of advances, below
 *  any kerned pair. */
const SAME_WIDTH = 0.0005;

/** Whether a text set `a` px wide is as wide as the `b` px measured. */
export function sameSetWidth(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_WIDTH * Math.max(Math.abs(a), Math.abs(b));
}
const sameWidth = sameSetWidth;

function joinable(seg: VDTLineSegment): boolean {
  if (seg.kind !== 'text' || !WORD_TEXT_RE.test(seg.text)) return false;
  for (const key in seg) if (!SHARED.has(key)) return false;
  return true;
}

function sameStyle(a: VDTLineSegment, b: VDTLineSegment): boolean {
  return JOINED.every((key) => a[key] === b[key]);
}

/**
 * The stretches of `pieces` that are set as one text, each as `[from,
 * to)`: pieces that follow each other with no space, in one style, whose
 * text set whole is as wide as the layout measured them together, where
 * one of them set alone is not as wide as its place. `widthOf` is the
 * width the output gives a text in the pieces' style, with the line's
 * tracking. `opensLine`: the pieces open their line, so the first may be
 * the rest of a word broken at the line before; when it is off alone, a
 * stretch from it on is also one text when it is off by as much. The
 * longest stretch from each piece on wins; a piece in no stretch is set
 * alone. Empty when every piece is as wide alone as measured (a plain
 * paragraph's, a word with nothing across its cuts).
 */
export function joinedWordPieces(pieces: readonly WordPiece[], widthOf: (text: string) => number, opensLine = false): [from: number, to: number][] {
  const stretches: [number, number][] = [];
  const n = pieces.length;
  if (n < 2) return stretches;
  // The pieces not as wide alone as their place: a stretch holds one.
  let lastOff = -1;
  // How much wider each piece is alone than its place.
  const over = pieces.map((piece) => widthOf(piece.text) - piece.width);
  const off = pieces.map((piece, i) => {
    const differs = !sameWidth(piece.width + over[i]!, piece.width);
    if (differs) lastOff = i;
    return differs;
  });
  for (let from = 0; from < n - 1 && from <= lastOff;) {
    let end = 0;
    // No stretch ends before the first of its pieces that is off.
    let firstOff = from;
    while (!off[firstOff]) firstOff++;
    for (let to = n; to > from + 1 && to > firstOff; to--) {
      let text = '';
      let measured = 0;
      for (let k = from; k < to; k++) {
        text += pieces[k]!.text;
        measured += pieces[k]!.width;
      }
      // As wide as measured; or, from the piece that opens the line on,
      // off by what that piece carries from the line before.
      const whole = widthOf(text);
      if (sameWidth(whole, measured) || (opensLine && from === 0 && off[0] && sameWidth(whole - over[0]!, measured))) {
        end = to;
        break;
      }
    }
    if (end > 0) {
      stretches.push([from, end]);
      from = end;
    } else {
      from++;
    }
  }
  return stretches;
}

/** `pieces` with each of `stretches` as one segment: the first piece's
 *  style, the text of all, the width the layout measured them together. */
function joinStretches(pieces: readonly VDTLineSegment[], stretches: readonly (readonly [number, number])[]): VDTLineSegment[] {
  const out: VDTLineSegment[] = [];
  let at = 0;
  for (const [from, to] of stretches) {
    for (; at < from; at++) out.push(pieces[at]!);
    let text = '';
    let width = 0;
    for (; at < to; at++) {
      text += pieces[at]!.text;
      width += pieces[at]!.width;
    }
    out.push({ ...pieces[from]!, text, width });
  }
  for (; at < pieces.length; at++) out.push(pieces[at]!);
  return out;
}

/**
 * The segments a run of pieces in one style is set from, or undefined
 * when they are set as they are. `opensLine`: the run opens its line.
 * `endsLine`: it closes a line that ends inside a word, so its last piece
 * may carry the hyphen the layout added (see the module comment).
 */
function setPieces(pieces: readonly VDTLineSegment[], opensLine: boolean, endsLine: boolean, advanceOf: (text: string) => number): VDTLineSegment[] | undefined {
  // Each text is asked for once, whatever the stretches tried.
  const widths = new Map<string, number>();
  const widthOf = (text: string): number => {
    let width = widths.get(text);
    if (width === undefined) widths.set(text, width = advanceOf(text));
    return width;
  };
  const stretches = joinedWordPieces(pieces, widthOf, opensLine);
  const last = pieces[pieces.length - 1]!;
  const joinsLast = stretches.length > 0 && stretches[stretches.length - 1]![1] === pieces.length;
  if (endsLine && !joinsLast && last.text.length > 1 && last.text.endsWith('-') && !sameWidth(widthOf(last.text), last.width)) {
    const hyphen = widthOf('-');
    const body: VDTLineSegment = { ...last, text: last.text.slice(0, -1), width: last.width - hyphen };
    const bodies = [...pieces.slice(0, -1), body];
    const apart = joinedWordPieces(bodies, widthOf, opensLine);
    const joinsBody = apart.length > 0 && apart[apart.length - 1]![1] === bodies.length;
    if (joinsBody || sameWidth(widthOf(body.text), body.width)) {
      return [...joinStretches(bodies, apart), { ...last, text: '-', width: hyphen }];
    }
  }
  return stretches.length > 0 ? joinStretches(pieces, stretches) : undefined;
}

/**
 * The segments a line is set from: its own, with the pieces of a word
 * joined into one segment where the word was measured whole, and the
 * hyphen of a line end set apart where it was measured apart (see the
 * module comment). `advanceOf` is the advance the output gives `text` in
 * the style of the segment `seg` (px, with the line's tracking).
 *
 * The line's own array when nothing changes: a line of the CJK composer
 * or down a vertical page (`composed`), a line that carries directions
 * (its `order` counts its segments), a line whose pieces are each as wide
 * alone as measured. A joined segment carries what its first piece does;
 * the line's segments are not touched, so what reads a piece's box from
 * them (a link's area, a selection) reads the same boxes.
 */
export function lineWordSegments(line: VDTLine, composed: boolean, advanceOf: (seg: VDTLineSegment, text: string) => number): VDTLineSegment[] | undefined {
  const segments = line.segments;
  if (!segments || composed || line.order !== undefined || segments.some((s) => s.rtl)) return segments;
  let set: VDTLineSegment[] | undefined;
  // Whether a text was met on the line: the run before any opens it.
  let opened = false;
  for (let from = 0; from < segments.length;) {
    const first = segments[from]!;
    let to = from + 1;
    const opensLine = !opened;
    if (first.kind !== 'space') opened = true;
    if (!joinable(first)) {
      set?.push(first);
      from = to;
      continue;
    }
    while (to < segments.length && joinable(segments[to]!) && sameStyle(first, segments[to]!)) to++;
    const pieces = segments.slice(from, to);
    const endsLine = line.hyphenated === true && to === segments.length;
    const run = pieces.length > 1 || endsLine ? setPieces(pieces, opensLine, endsLine, (text) => advanceOf(first, text)) : undefined;
    if (run) (set ??= segments.slice(0, from)).push(...run);
    else set?.push(...pieces);
    from = to;
  }
  return set ?? segments;
}
