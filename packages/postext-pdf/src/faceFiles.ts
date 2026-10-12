/**
 * Faces made of several font files (issue #196).
 *
 * A font provider may answer a face with several files, each holding part
 * of its characters: the numbered unicode-range slices Fontsource ships for
 * Chinese, Japanese and Korean families (about a hundred files for Noto
 * Serif SC), or a Latin family's `latin` and `latin-ext` files. The
 * {@link FontCache} embeds each file as its own subset font and registers
 * the list here under the face's first file, the `PDFFont` every renderer
 * is handed. The text primitives then cut each run by the file that has a
 * glyph for each character ({@link fileRuns}) and switch fonts inside one
 * text object, so a line of Han with a Latin word paints from three or four
 * slices and each slice keeps only the glyphs set in it.
 *
 * Characters a face lacks in every file are recorded as they are shaped
 * ({@link noteMissingGlyphs}), for the `missingGlyph` warning.
 */
import type { PDFFont } from 'pdf-lib';
import { mirroredCodePoint } from 'postext';
import { isDefaultIgnorable, isFallbackHandled, substituteGlyph } from './pdf-backend/fallbackSpaces';
import { besideLetterOf, shapingScriptLetter } from './shapingLanguage';

/** The fontkit face of an embedded font, as far as coverage needs it. */
interface CoverageFace {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

function coverageFace(font: PDFFont): CoverageFace | undefined {
  const face = (font as unknown as { embedder?: { font?: CoverageFace } }).embedder?.font;
  return face && typeof face.hasGlyphForCodePoint === 'function' ? face : undefined;
}

/** Whether a font lacking `cp` does not count as missing it: controls, and
 *  the spaces and invisible characters the fallbacks paint without a glyph
 *  (see `fallbackSpaces.ts`). */
function neverMissing(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || isFallbackHandled(cp);
}

/** The files of one face, in the order their glyphs are looked up. */
export class FaceFiles {
  readonly files: PDFFont[];
  private readonly faces = new Map<PDFFont, CoverageFace | undefined>();
  /** First file holding each code point, or null for none. */
  private readonly first = new Map<number, PDFFont | null>();

  constructor(files: readonly PDFFont[]) {
    this.files = [];
    for (const file of files) this.add(file);
  }

  /** Append a file (a slice fetched later); a file already listed is kept
   *  where it is. */
  add(file: PDFFont): void {
    if (this.faces.has(file)) return;
    this.files.push(file);
    this.faces.set(file, coverageFace(file));
    // A code point no file had may be in this one.
    for (const [cp, hit] of this.first) if (hit === null) this.first.delete(cp);
  }

  /** Whether `file` has a glyph for `cp`. */
  covers(file: PDFFont, cp: number): boolean {
    return this.faces.get(file)?.hasGlyphForCodePoint(cp) ?? false;
  }

  /** The first file with a glyph for `cp`, or null when none has one. */
  fileFor(cp: number): PDFFont | null {
    const hit = this.first.get(cp);
    if (hit !== undefined) return hit;
    let found: PDFFont | null = null;
    for (const file of this.files) {
      if (this.covers(file, cp)) {
        found = file;
        break;
      }
    }
    this.first.set(cp, found);
    return found;
  }
}

const faceFiles = new WeakMap<PDFFont, FaceFiles>();

/** Register the files of a face under its first file, the font the
 *  renderers are handed. A first file already registered (two faces the
 *  provider answered with the same files) keeps its list, which takes the
 *  new files too; the list in force is returned. */
export function registerFaceFiles(primary: PDFFont, files: readonly PDFFont[]): FaceFiles {
  const known = faceFiles.get(primary);
  if (known) {
    for (const file of files) known.add(file);
    return known;
  }
  const list = new FaceFiles([primary, ...files]);
  faceFiles.set(primary, list);
  return list;
}

/** The files of the face whose first file is `font`, when it has several. */
export function faceFilesOf(font: PDFFont): FaceFiles | undefined {
  const list = faceFiles.get(font);
  return list && list.files.length > 1 ? list : undefined;
}

/** A run of text and the file it is set in. */
export interface FileRun {
  font: PDFFont;
  text: string;
  /** A letter of the script the run is shaped in, when it holds no letter
   *  and the text it was cut out of does (`besideLetterOf`, #764): the
   *  caller shapes the run inside `withBesideLetter`. */
  beside?: number;
}

/**
 * `text` cut into runs by the file of `font`'s face that has a glyph for
 * each character; one run in `font` itself for a face of one file. A
 * character stays in the run before it while that run's file covers it
 * (every Fontsource slice holds the space, so spaces never cut a run), else
 * it goes to the first file that does. A character no file covers, and an
 * invisible one (a joiner, a variation selector), stays in the run before
 * it: it is drawn (or dropped) as that file's fallback, and a printing one
 * is reported as missing when shaped.
 *
 * With `rtl` (a run HarfBuzz shapes right to left) a mirrored character
 * goes by the glyph that run will show: HarfBuzz sets `(` as `)` only when
 * the file has a `)`, and keeps the `(` otherwise. Fontsource's `arabic`
 * file of Amiri holds `(` and not `)`, so an opening bracket cut into it
 * printed unmirrored in an Arabic line (#401). Such a character is set in
 * the first file with its mirror (the `latin` one), or by its own glyph
 * when no file has the mirror.
 *
 * In a left-to-right run a character that opens what follows it (an
 * opening bracket, an initial quotation mark) goes to the file the next
 * character is set in when that file has it (postext #670): the `(` of
 * `(d. 1367)` in an Arabic book was cut into the `arabic` file, the first
 * to hold it, and printed in that file's form, wider than the layout
 * measured, against a closing bracket from the `latin` one.
 *
 * A word shaped in a script the layout gave it (#725, the script in force,
 * `withShapingScript`) is set whole in the file that holds a letter of
 * that script, when that file has all its characters: `46.` after a Latin
 * word in the `latin` file, whose `latn` forms the layout measured. The
 * first file to hold a full stop may be the `arabic` one, which has no
 * Latin form for it. A word the file cannot set whole (the `(` of an
 * Arabic sentence, whose mirror only the `latin` file holds) is cut as
 * any other text.
 *
 * A run with no letter, cut out of text that has one (the `.»` of
 * `خالة.»`, which the `latin` file draws), says the letter whose script
 * the browser shaped it in (`beside`, #764), in a document shaped in its
 * own language.
 */
export function fileRuns(font: PDFFont, text: string, rtl = false): FileRun[] {
  const list = faceFilesOf(font);
  if (!list) return [{ font, text }];
  const letter = shapingScriptLetter();
  if (letter !== undefined) {
    const file = list.fileFor(letter);
    // A mirrored character of a right-to-left run goes by the glyph the
    // run will show, as below (#401): the file must hold that one.
    if (file && [...text].every((ch) => {
      const cp = ch.codePointAt(0)!;
      const mirror = rtl ? mirroredCodePoint(cp) : cp;
      return isDefaultIgnorable(cp) || isJoiningControl(cp) || list.covers(file, mirror !== cp && list.fileFor(mirror) ? mirror : cp);
    })) return [{ font: file, text }];
  }
  const runs: FileRun[] = [];
  let current: FileRun | undefined;
  // Joining controls waiting for the letter after them (see below).
  let pending = '';
  let previous = 0;
  const chars = [...text];
  for (let at = 0; at < chars.length; at++) {
    const ch = chars[at]!;
    const cp = ch.codePointAt(0)!;
    // A zero width joiner or non-joiner shapes with the letters it sits
    // between (HarfBuzz reads it only inside one run): it stays with the
    // letter before it, and one with no letter before it (opening the
    // text, after a space) goes with the letter after it. Fontsource
    // serves U+2000–206F from the `latin` file, so the file that covers it
    // first is rarely the Arabic letters' one.
    if (isJoiningControl(cp) && (!current || !joinsOnto(previous))) {
      pending += ch;
      continue;
    }
    const mirror = rtl ? mirroredCodePoint(cp) : cp;
    const shown = mirror !== cp && list.fileFor(mirror) ? mirror : cp;
    let file = current?.font;
    if (!file || (!list.covers(file, shown) && !isDefaultIgnorable(cp))) {
      file = list.fileFor(shown) ?? current?.font ?? font;
    }
    // An opening mark goes with what it opens (#670).
    if (!rtl && OPENING_RE.test(ch)) {
      const opened = openedFile(list, chars, at + 1, current?.font);
      if (opened && list.covers(opened, cp)) file = opened;
    }
    if (current && current.font === file) {
      current.text += pending + ch;
    } else {
      current = { font: file, text: pending + ch };
      runs.push(current);
    }
    pending = '';
    previous = cp;
  }
  if (pending) {
    if (current) current.text += pending;
    else runs.push({ font, text: pending });
  }
  if (runs.length > 1) {
    // The runs follow each other through the text.
    let at = 0;
    for (const run of runs) {
      const beside = besideLetterOf(text, at, at + run.text.length);
      if (beside !== undefined) run.beside = beside;
      at += run.text.length;
    }
  }
  return runs.length > 0 ? runs : [{ font, text }];
}

/** Opening brackets and initial quotation marks (`Ps`, `Pi`). */
const OPENING_RE = /^[\p{Ps}\p{Pi}]$/u;

/** The file the first character after a row of opening marks (from `from`)
 *  is set in: the current run's when it covers it, else the first file
 *  that does. Undefined when a space or nothing follows the marks, or no
 *  file has the character. */
function openedFile(list: FaceFiles, chars: readonly string[], from: number, current: PDFFont | undefined): PDFFont | undefined {
  let at = from;
  while (at < chars.length && OPENING_RE.test(chars[at]!)) at++;
  const next = chars[at];
  if (next === undefined || /\s/u.test(next)) return undefined;
  const cp = next.codePointAt(0)!;
  if (isJoiningControl(cp) || isDefaultIgnorable(cp)) return undefined;
  if (current && list.covers(current, cp)) return current;
  return list.fileFor(cp) ?? undefined;
}

/** ZWNJ (U+200C) and ZWJ (U+200D): they choose the joining form of the
 *  letters either side of them. */
function isJoiningControl(cp: number): boolean {
  return cp === 0x200c || cp === 0x200d;
}

/** Whether a joining control after `cp` belongs with it: anything but a
 *  space or a control (a letter, a mark, a digit, punctuation). */
function joinsOnto(cp: number): boolean {
  return cp > 0x20 && !(cp >= 0x7f && cp < 0xa0) && !/\s/u.test(String.fromCodePoint(cp)) && !isJoiningControl(cp);
}

/** `text`'s width at `size` (points), each run measured in its file. */
export function widthOfTextAtSize(font: PDFFont, text: string, size: number): number {
  const runs = fileRuns(font, text);
  if (runs.length === 1) return runs[0]!.font.widthOfTextAtSize(runs[0]!.text, size);
  let width = 0;
  for (const run of runs) width += run.font.widthOfTextAtSize(run.text, size);
  return width;
}

/** Characters each font lacks, with the order they were first met in:
 *  one count for every font, so the characters a face lacks in several of
 *  its files still sort in the order the pages set them. */
const missingByFont = new WeakMap<PDFFont, Map<number, number>>();
let missingSeq = 0;

/** Record the characters of `text` that `font` has no glyph for (it draws
 *  them as `.notdef`). Called once per shaped text, from the caches of the
 *  text primitives. A character the fallbacks draw with another glyph of
 *  the face (U+2011 as a hyphen, see `fallbackSpaces.ts`) is not missing. */
export function noteMissingGlyphs(font: PDFFont, text: string): void {
  const face = coverageFace(font);
  if (!face) return;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (neverMissing(cp) || face.hasGlyphForCodePoint(cp) || substituteGlyph(face, cp) !== undefined) continue;
    let seen = missingByFont.get(font);
    if (!seen) {
      seen = new Map();
      missingByFont.set(font, seen);
    }
    if (!seen.has(cp)) seen.set(cp, missingSeq++);
  }
}

/** The characters drawn in `font` that it has no glyph for, each with its
 *  place in the order every font's missing characters were first met. */
export function missingGlyphsOf(font: PDFFont): ReadonlyMap<number, number> | undefined {
  return missingByFont.get(font);
}

/** Whether a face is missing `cp` in a way worth asking its provider for:
 *  a printing character. */
export function wantsGlyph(cp: number): boolean {
  return !neverMissing(cp);
}
