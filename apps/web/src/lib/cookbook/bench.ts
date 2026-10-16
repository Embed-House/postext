/**
 * The composed-page bench (#869): what it reads off a recipe's sources.
 *
 * The stress test's longer text: a recipe's Markdown with every
 * paragraph, heading and list item made longer by a factor (1.3 = 30 %
 * more letters), the way a translation or an editor's late paragraph
 * makes it longer, so a composed page shows whether its frames grow,
 * move, shrink their text or go on elsewhere when the copy changes.
 *
 * Deterministic and markup-safe: only plain words are repeated, each next
 * to itself, so the words of a paragraph stay the paragraph's own and its
 * language stays one. Nothing is touched inside a fence line (`:::frame{…}`,
 * `::::page{…}`, `::resource{…}`), an attribute block (`{…}`), an inline
 * directive (`:chip[…]{…}`), a link, a reference, code, maths, HTML or a
 * table, nor inside a code fence, front matter or the raw body of a
 * comic's `:::page` / `:::strip`.
 *
 * Pure and isomorphic: no I/O.
 */

/** A paragraph's words and what was added to it. */
export interface StretchResult {
  markdown: string;
  /** Characters of the text lines before and after. */
  before: number;
  after: number;
  /** Paragraphs that had no plain word to repeat (all markup, or a word
   *  shorter than two letters) and so stayed as they were. */
  unchanged: number;
}

/** Spans of a text line that are markup or not words of the text. */
const PROTECTED = new RegExp(
  [
    "\\\\.", // an escape
    "`[^`]*`", // inline code
    "\\$[^$\\n]+\\$", // inline maths
    "<[^>\\n]+>", // HTML and autolinks
    "https?:\\/\\/\\S+", // a bare address
    "!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)", // a link or an image
    ":[a-z][a-z0-9-]*(?:\\[[^\\]\\n]*\\])?(?:\\{[^}\\n]*\\})?", // an inline directive
    "\\[[^\\]\\n]*\\]", // a reference, a footnote mark, a citation
    "\\{[^}\\n]*\\}", // an attribute block
  ].join("|"),
  "g",
);

const LETTER = /[\p{L}\p{N}\p{M}]/u;
const INSIDE = /^[\p{L}\p{N}\p{M}'’-]+$/u;

/** A word's letters, without what stands before and after them
 *  (punctuation, emphasis): letters, marks and digits, with an
 *  apostrophe or a hyphen inside. Null for a token with anything else
 *  between its letters (`e.g.`, `a/b`). */
function coreOf(token: string): { at: number; core: string } | null {
  let a = 0;
  let b = token.length;
  while (a < b && !LETTER.test(token[a]!)) a++;
  while (b > a && !LETTER.test(token[b - 1]!)) b--;
  const core = token.slice(a, b);
  return core && INSIDE.test(core) ? { at: a, core } : null;
}
/** Scripts written without spaces between words: a copy goes on without one. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
/** Punctuation a run of Chinese or Japanese text is cut at into words. */
const CJK_PUNCT = /([、。，．！？；：「」『』（）《》〈〉【】…・])/u;

const FENCE = /^\s*:{2,}/; // a fence line or a leaf directive
const CODE_FENCE = /^\s*(```|~~~)/;
const RAW_FENCE = /^\s*:::\s*(page|strip)\b(?!\s*\{[^}]*\btemplate=)/; // a comic's raw body
const CLOSE_FENCE = /^\s*:{3,}\s*$/;
const TABLE = /^\s*\|/;
const HTML_BLOCK = /^\s*</;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
/** What opens a line and is no text: a heading's hashes, a list marker
 *  and task box, a blockquote's `>`, a footnote definition's label. */
const PREFIX = /^(\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|\[\^[^\]]+\]:\s*)?)/;
/** A line that starts a block of its own (and so a paragraph of its own). */
const BLOCK_START = /^\s*(?:>\s*)*(?:#{1,6}\s|(?:[-*+]|\d+[.)])\s|\[\^[^\]]+\]:)/;

interface Word {
  line: number;
  /** Offset of the word's letters in the line's text. */
  at: number;
  core: string;
}

/** The plain words of `text` (a line without its prefix), by offset. */
function wordsOf(text: string): { at: number; core: string }[] {
  const out: { at: number; core: string }[] = [];
  const free: [number, number][] = [];
  let last = 0;
  for (const m of text.matchAll(PROTECTED)) {
    const i = m.index ?? 0;
    if (i > last) free.push([last, i]);
    last = i + m[0].length;
  }
  if (last < text.length) free.push([last, text.length]);
  for (const [a, b] of free) {
    const chunk = text.slice(a, b);
    for (const m of chunk.matchAll(/\S+/g)) {
      const token = m[0];
      const base = a + (m.index ?? 0);
      // A Chinese or Japanese run is cut at its punctuation into words.
      const parts = UNSPACED.test(token) ? token.split(CJK_PUNCT) : [token];
      let offset = 0;
      for (const part of parts) {
        const word = coreOf(part);
        if (word && word.core.length >= 2) out.push({ at: base + offset + word.at, core: word.core });
        offset += part.length;
      }
    }
  }
  return out;
}

/** A spread order over `n` items (the golden ratio's sequence), so the
 *  repeated words fall all along a paragraph, not at its head. */
function spread(n: number): number[] {
  const phi = (Math.sqrt(5) - 1) / 2;
  return [...Array(n).keys()].sort((a, b) => ((a * phi) % 1) - ((b * phi) % 1) || a - b);
}

/** The most copies of one word: past it, a paragraph stays shorter. */
const MAX_COPIES = 4;

/**
 * `markdown` with every paragraph, heading and list item `factor` times
 * as long (characters of its text lines), by repeating its own words next
 * to themselves ("familia familia"), spread along it. A paragraph whose
 * words cannot reach the factor in four copies each stays as long as they
 * make it.
 */
export function stretchMarkdown(markdown: string, factor: number): StretchResult {
  if (!(factor > 1)) return { markdown, before: 0, after: 0, unchanged: 0 };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const prefixes: string[] = lines.map(() => "");
  /** Paragraphs: the lines of each, by index. */
  const paragraphs: number[][] = [];
  let current: number[] | null = null;
  let inCode = false;
  let rawDepth = 0;
  let inFront = lines[0]?.trim() === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const end = () => {
      current = null;
    };
    if (inFront) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFront = false;
      end();
      continue;
    }
    if (CODE_FENCE.test(line)) {
      inCode = !inCode;
      end();
      continue;
    }
    if (inCode) continue;
    if (rawDepth > 0) {
      if (CLOSE_FENCE.test(line)) rawDepth--;
      else if (RAW_FENCE.test(line)) rawDepth++;
      end();
      continue;
    }
    if (RAW_FENCE.test(line)) {
      rawDepth = 1;
      end();
      continue;
    }
    if (line.trim() === "" || FENCE.test(line) || TABLE.test(line) || HTML_BLOCK.test(line) || RULE.test(line)) {
      end();
      continue;
    }
    const prefix = PREFIX.exec(line)?.[1] ?? "";
    prefixes[i] = prefix;
    const heading = /^\s*(?:>\s*)*#{1,6}\s/.test(line);
    if (!current || BLOCK_START.test(line)) {
      current = [];
      paragraphs.push(current);
    }
    current.push(i);
    if (heading) end();
  }

  let before = 0;
  let after = 0;
  let unchanged = 0;
  const out = [...lines];
  for (const paragraph of paragraphs) {
    const words: Word[] = paragraph.flatMap((line) => {
      const text = lines[line]!.slice(prefixes[line]!.length);
      return wordsOf(text).map((w) => ({ line, at: prefixes[line]!.length + w.at, core: w.core }));
    });
    const length = paragraph.reduce((sum, line) => sum + lines[line]!.length - prefixes[line]!.length, 0);
    before += length;
    const need = (factor - 1) * length;
    const copies = new Array<number>(words.length).fill(0);
    let added = 0;
    const order = spread(words.length);
    for (let pass = 0; pass < MAX_COPIES && added < need && words.length; pass++) {
      for (const k of order) {
        if (added >= need) break;
        const w = words[k]!;
        copies[k]!++;
        added += w.core.length + (UNSPACED.test(w.core) ? 0 : 1);
      }
    }
    if (added === 0) unchanged++;
    after += length + added;
    // Insert from the end of each line, so earlier offsets hold.
    for (const line of paragraph) {
      let text = lines[line]!;
      const mine = words.map((w, k) => ({ w, n: copies[k]! })).filter((x) => x.w.line === line && x.n > 0);
      for (const { w, n } of mine.reverse()) {
        const join = UNSPACED.test(w.core) ? "" : " ";
        const extra = Array.from({ length: n }, () => join + w.core).join("");
        const cut = w.at + w.core.length;
        text = text.slice(0, cut) + extra + text.slice(cut);
      }
      out[line] = text;
    }
  }
  return { markdown: out.join("\n"), before, after, unchanged };
}

/** A Markdown that declares a composed page: a four-colon page fence that
 *  names a template (as lib/probe.js `COMPOSED_FENCE`). */
export const COMPOSED_FENCE = /^::::\s*page\s*\{[^}\n]*\btemplate\s*=/m;

/** Whether a recipe's content files declare composed pages: the recipes
 *  the bench takes when none is named. */
export function declaresComposedPages(content: Readonly<Record<string, string>>): boolean {
  return Object.values(content).some((text) => COMPOSED_FENCE.test(text));
}

/** The content files of an edition (`content.<lang>.md` and its slots,
 *  else the fallback edition's), stretched: how much longer they came out. */
export function stretchedEdition(
  content: Readonly<Record<string, string>>,
  variant: string,
  fallback: string,
  factor: number,
): { before: number; after: number; unchanged: number } {
  const keys = new Set<string>();
  for (const key of Object.keys(content)) {
    const parts = key.split(".");
    const lang = parts.pop();
    const slot = parts.join(".");
    const own = slot ? `${slot}.${variant}` : variant;
    if (lang === variant || (lang === fallback && content[own] === undefined)) keys.add(key);
  }
  let before = 0;
  let after = 0;
  let unchanged = 0;
  for (const key of keys) {
    const r = stretchMarkdown(content[key]!, factor);
    before += r.before;
    after += r.after;
    unchanged += r.unchanged;
  }
  return { before, after, unchanged };
}
