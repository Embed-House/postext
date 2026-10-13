/**
 * The words a browser's canvas shapes a string in (postext #770).
 *
 * Chrome does not hand a string to its shaper whole. It cuts it into words
 * and shapes each alone, so that a word met again is answered from a cache
 * (Blink's `CachingWordShapeIterator`): nothing a font does between two
 * glyphs crosses from one word to the next, neither a kerned pair nor a
 * ligature, and each word is given the script of its own letters. The
 * layout was measured that way, and the canvas paints that way. A shaper
 * handed the whole string does otherwise:
 *
 * - Source Serif 4 kerns a space against the `W` after it: `Wang Wei` in a
 *   running head came out 0.06 em narrower than its measure;
 * - Noto Sans JP kerns kana against kana (`える` 0.03 em, `われ` 0.05 em):
 *   a line of 36 characters ended 1.4 pt short of its measure, where the
 *   canvas kerns only a character and the mark after it (`が、`, `す。`);
 * - Noto Sans SC draws the dash of `9704—2012` in its Chinese form, a full
 *   em, when the word is shaped with the Latin words beside it, and 0.89
 *   em wide alone, as measured;
 * - Noto Serif JP draws `“` in its Japanese form beside a Han character
 *   in one run, and in its default form as the word of its own it is on
 *   the canvas;
 * - Aref Ruqaa sets a space 0.146 em wide in Arabic text and 0.333 em in
 *   any other: the space between two Arabic words is a word of its own on
 *   the canvas, with no letter and so no script, and a title of three
 *   words came out 0.37 em short.
 *
 * The cuts, as measured in Chrome 154 (widths of strings against the sum
 * of their parts, in faces that kern across the cut or draw a mark
 * otherwise by script):
 *
 * - a space (U+0020) and a tab are words of their own. No other space
 *   cuts: a no-break space stays in its word;
 * - a string with no character above U+00FF is cut there only;
 * - a CJK character (a Han character, a kana, a CJK mark or symbol, a
 *   full-width form, an enclosed number, an emoji) ends the word before
 *   it and opens one that holds it, the marks and modifier letters after
 *   it (`ー`, `々`, a voicing mark) and the CJK characters of no script
 *   after it (`、`, `。`, `」`): `が、` is one word, `える` two. A word that
 *   opens with such a mark (`「`, `ー`) takes the first character with a
 *   script after it as well.
 *
 * The symbols counted as CJK were read off the canvas ({@link CJK_BASE}):
 * the characters of no script after which `n` + character + `—` keeps the
 * default dash in Noto Serif SC under `zh`, whose dash takes the Chinese
 * form anywhere in a Latin word. The letters (Han, kana, Bopomofo, the
 * full-width and half-width forms, Roman numerals) cannot be read that
 * way and are Blink's own ranges; Hangul is not among them.
 */

/** The characters with no script, by block, that end a word (measured). */
const SYMBOLS = '2020-2021 2030 203B-203C 2042 2047-2049 2051 2100 2103 2105 2109-210A 2113 2116 2121 213B 2150-2152 2156-215A 2189 2194-2195 2307 2312 231A-231B 2329 23BE-23CC 23CE 23E9-23EC 23F0 23F3 2423 2460-2492 249C-24FF 25A0-25A2 25AA-25AB 25B1-25B3 25B6-25B7 25BC-25BD 25C0-25C1 25C6-25C7 25C9 25CB-25CC 25CE-25D3 25E2-25E6 25EF 25FD-25FE 2600-2603 2605-2606 260E 2614-2617 261D 2620 2640 2642 2648-2653 2660-266F 2672-267D 267F 2693 2695-2696 26A0-26A1 26A7 26AA-26AB 26BD-26BE 26C4-26C5 26CE 26D3-26D4 26EA 26F2-26F3 26F5 26F9-26FA 26FD 2705 2708 270A-270D 2713 271A 2728 273F-2740 2744 274C 274E 2753-2757 2763-2764 2776-277F 2795-2797 27A1 27B0 27BF 2B1A-2B1C 2B50 2B55 2FF0-3004 3006 3008-3020 3030 3036-3037 303C-303F 3190-319F 31C0-31E5 31EF 3220-325F 327F-32CF 32FF 3358-33FF FE10-FE12 FE19 FE30-FE52 FE54-FE66 FE68-FE6B FF01-FF0C FF0E-FF1A FF1D FF1F-FF20 FF3B-FF3D FF3F FF5B-FF65 FFE0-FFE2 FFE4-FFE6 FFE8-FFEE';
/** The letters and numbers: Å, Roman numerals, Han, kana, Bopomofo,
 *  circled and squared kana, full-width Latin, half-width kana and Hangul,
 *  the emoji and the Han of the upper planes. */
const LETTERS = '212B 2160-216B 2170-217B 217F 2E80-2FDF 3007 3021-3029 3038-303A 3041-3096 309F 30A1-30FA 30FF 3105-312F 31A0-31BF 32D0-32FE 3300-3357 3400-4DBF 4E00-9FFF F900-FAFF FF21-FF3A FF41-FF5A FF66-FF6F FF71-FF9D FFA0-FFDC 1F000-1FAFF 20000-3FFFF';
/** The marks and modifier letters of the CJK blocks: they open a CJK word
 *  when a string starts with one, and never end a word. */
const MODIFIERS = '3005 302A-302D 3031-3035 303B 3099-309E 30FC-30FE FF3E FF40 FF70 FF9E-FF9F FFE3';

function ranges(list: string): number[] {
  const out: number[] = [];
  for (const part of list.split(' ')) {
    const [lo, hi = lo] = part.split('-');
    out.push(parseInt(lo!, 16), parseInt(hi!, 16));
  }
  // By first code point, for the search.
  const pairs: [number, number][] = [];
  for (let i = 0; i < out.length; i += 2) pairs.push([out[i]!, out[i + 1]!]);
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.flat();
}

const CJK_BASE = ranges(`${SYMBOLS} ${LETTERS}`);
const CJK_MODIFIERS = ranges(MODIFIERS);

function inRanges(table: readonly number[], cp: number): boolean {
  let lo = 0;
  let hi = table.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < table[mid * 2]!) hi = mid - 1;
    else if (cp > table[mid * 2 + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

/** No CJK character is below this. */
const FIRST_CJK = 0x2020;

/** A CJK character that ends the word before it. */
function isCjkBase(cp: number): boolean {
  return cp >= FIRST_CJK && inRanges(CJK_BASE, cp);
}

/** A CJK character: one that opens a CJK word when a word starts with it. */
function isCjk(cp: number): boolean {
  return cp >= FIRST_CJK && (inRanges(CJK_BASE, cp) || inRanges(CJK_MODIFIERS, cp));
}

function isDelimiter(cp: number): boolean {
  return cp === 0x20 || cp === 0x09;
}

/** A mark, a modifier letter or a modifier symbol, and the zero width
 *  joiner: they stay in the word of the character before them. */
const JOINS_RE = /^[\p{M}\p{Lm}\p{Sk}\u200D]$/u;
/** A character with no script of its own. */
const NO_SCRIPT_RE = /^[\p{Script=Common}\p{Script=Inherited}]$/u;
/** A string a browser keeps in eight bits. */
const LATIN_1_RE = /^[\u0000-\u00FF]*$/;
/** Anything a string may be cut at: a space, a tab, a character from the
 *  first CJK one on. */
const MAY_CUT_RE = /[ \t\u2020-\uFFFF]/;

/**
 * `text` cut into the words the canvas shapes it in (see the module
 * comment); the string itself, alone, when it is one word.
 */
export function canvasWords(text: string): string[] {
  if (text.length < 2 || !MAY_CUT_RE.test(text)) return [text];
  const latin1 = LATIN_1_RE.test(text);
  const words: string[] = [];
  const n = text.length;
  const width = (cp: number): number => (cp > 0xFFFF ? 2 : 1);
  for (let start = 0; start < n;) {
    const first = text.codePointAt(start)!;
    let end = start + width(first);
    if (isDelimiter(first)) {
      // A word of its own.
    } else if (latin1 || !isCjk(first)) {
      while (end < n) {
        const cp = text.codePointAt(end)!;
        if (isDelimiter(cp) || (!latin1 && isCjkBase(cp))) break;
        end += width(cp);
      }
    } else {
      let scripted = !NO_SCRIPT_RE.test(String.fromCodePoint(first));
      while (end < n) {
        const cp = text.codePointAt(end)!;
        const ch = String.fromCodePoint(cp);
        if (JOINS_RE.test(ch)) {
          end += width(cp);
          continue;
        }
        if (!isCjk(cp)) break;
        if (!NO_SCRIPT_RE.test(ch)) {
          if (scripted) break;
          scripted = true;
        }
        end += width(cp);
      }
    }
    words.push(text.slice(start, end));
    start = end;
  }
  return words.length === 1 ? [text] : words;
}
