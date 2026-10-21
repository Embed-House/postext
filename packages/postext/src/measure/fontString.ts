// What a canvas font shorthand asks for (#629): the family, weight and
// slant the engine measured a run with, read back from the strings
// `buildFontString` writes (`italic 700 12.5px "Optima 105"`).

/** A face as the engine asks for it: a family, a numeric weight and a
 *  slant (`oblique` reads as italic). */
export interface FontFaceRequest {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** `\s` as a regular expression reads it (`trim` strips the same set). */
function isSpace(c: string | undefined): boolean {
  return c !== undefined && c !== '' && c.trim() === '';
}

/** A line terminator: what a regular expression's `.` never matches. */
function isLineTerminator(c: string | undefined): boolean {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

/** The last line terminator of `s`, -1 when it has none. */
function lastLineTerminator(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (isLineTerminator(s[i])) return i;
  return -1;
}

/** A font's `<n>px` size: `font.slice(start, end)` is the whole match and
 *  `value` its number. */
export interface PxSize {
  start: number;
  end: number;
  value: string;
}

/** Where the number of a `px` at `p` begins, read back from it as far as
 *  `from`: `\d*\.?\d+`, or `\d+(?:\.\d+)?` with `leadingDigit`; -1 when
 *  no digit stands before the unit. */
function pxNumberStart(font: string, p: number, from: number, leadingDigit: boolean): number {
  let s = p;
  while (s > from && isDigit(font.charCodeAt(s - 1))) s--;
  if (s === p) return -1;
  if (s > from && font[s - 1] === '.' && (!leadingDigit || (s - 1 > from && isDigit(font.charCodeAt(s - 2))))) {
    s--;
    while (s > from && isDigit(font.charCodeAt(s - 1))) s--;
  }
  return s;
}

/**
 * The first `px` size of a CSS font string from `from` on, as
 * `/(\d*\.?\d+)px/` finds it (`/(\d+(?:\.\d+)?)px/` with
 * `leadingDigit`), or null. A scan in one pass: the expression's leading
 * repetition is slow on a long run of digits with no unit after it.
 */
export function findPxSize(font: string, from = 0, leadingDigit = false): PxSize | null {
  for (let p = font.indexOf('px', from); p >= 0; p = font.indexOf('px', p + 1)) {
    const start = pxNumberStart(font, p, from, leadingDigit);
    if (start >= 0) return { start, end: p + 2, value: font.slice(start, p) };
  }
  return null;
}

/** `font` with its first `px` size (see {@link findPxSize}) set to
 *  `sizePx`. */
export function withPxSize(font: string, sizePx: (value: string) => number): string {
  const m = findPxSize(font);
  return m ? `${font.slice(0, m.start)}${sizePx(m.value)}px${font.slice(m.end)}` : font;
}

/** The `(.+)` of `\s+(.+)$` read from `i`, or undefined: what follows the
 *  spaces, or the last space when they end the string; never across a line
 *  terminator (`lastBreak`: the string's last one). */
function spacedTail(s: string, i: number, lastBreak: number): string | undefined {
  let j = i;
  while (j < s.length && isSpace(s[j])) j++;
  const k = j < s.length ? j : j - 1;
  if (k <= i || lastBreak >= k) return undefined;
  return s.slice(k);
}

/** The end of the run of non-spaces at `i`. */
function wordEnd(s: string, i: number): number {
  while (i < s.length && !isSpace(s[i])) i++;
  return i;
}

/**
 * A font shorthand split at its size, as
 * `/^(.*?)(\d*\.?\d+)px\s+(.+)$/` splits it (with `lineHeight`,
 * `/^(.*?)(\d*\.?\d+)px(\s*\/\s*[^\s]+)?\s+(.+)$/`): `prefix` the style
 * and weight words before the size (its spaces kept), `family` the family
 * list after it (and after a `/ line-height`). Null when the string has no
 * such size. A scan in one pass, where the expressions backtrack.
 */
export function splitAtFontSize(font: string, lineHeight = false): { prefix: string; family: string } | null {
  const lastBreak = lastLineTerminator(font);
  let firstBreak = -1;
  for (let i = 0; i < font.length && firstBreak < 0; i++) if (isLineTerminator(font[i])) firstBreak = i;
  for (let p = font.indexOf('px'); p >= 0; p = font.indexOf('px', p + 1)) {
    const start = pxNumberStart(font, p, 0, false);
    if (start < 0) continue;
    // The prefix (`.*?`) never crosses a line terminator, nor would any
    // later size's.
    if (firstBreak >= 0 && firstBreak < start) return null;
    let family: string | undefined;
    if (lineHeight) {
      let i = p + 2;
      while (i < font.length && isSpace(font[i])) i++;
      if (font[i] === '/') {
        i++;
        while (i < font.length && isSpace(font[i])) i++;
        const end = wordEnd(font, i);
        if (end > i) family = spacedTail(font, end, lastBreak);
      }
    }
    family ??= spacedTail(font, p + 2, lastBreak);
    if (family !== undefined) return { prefix: font.slice(0, start), family };
  }
  return null;
}

/** The family list of a trimmed font shorthand and where its size begins,
 *  as `/(?:^|\s)\d*\.?\d+px(?:\/\S+)?\s+(.+)$/` reads it (`at`: the
 *  match's start, the space before the size or 0). */
function familyAfterSize(font: string): { family: string; at: number } | null {
  const lastBreak = lastLineTerminator(font);
  for (let at = 0; at < font.length; at++) {
    // The size opens the string or follows a space.
    const b = at === 0 && !isSpace(font[0]) ? 0 : isSpace(font[at]) ? at + 1 : -1;
    if (b < 0) continue;
    let i = b;
    while (isDigit(font.charCodeAt(i))) i++;
    if (font[i] === '.') {
      const d = ++i;
      while (isDigit(font.charCodeAt(i))) i++;
      if (i === d) continue;
    } else if (i === b) continue;
    if (font[i] !== 'p' || font[i + 1] !== 'x') continue;
    i += 2;
    if (font[i] === '/') {
      const end = wordEnd(font, i + 1);
      if (end === i + 1) continue;
      i = end;
    }
    const family = spacedTail(font, i, lastBreak);
    if (family !== undefined) return { family, at };
  }
  return null;
}

/** The family of a CSS family list's first entry, unquoted. */
function firstFamily(list: string): string {
  let quote: string | undefined;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      list = list.slice(0, i);
      break;
    }
  }
  const f = list.trim();
  return /^(["']).*\1$/.test(f) ? f.slice(1, -1).replace(/\\(["'\\])/g, '$1') : f;
}

/** The face a canvas font shorthand names (`'700 37.5px Open Sans'`,
 *  `'italic 400 13px "Source Serif 4"'`), or null when the string has no
 *  `px` size. A string with no weight is 400; `bold` is 700. */
export function parseFontString(font: string): FontFaceRequest | null {
  const trimmed = font.trim();
  const m = familyAfterSize(trimmed);
  if (!m) return null;
  const family = firstFamily(m.family);
  if (!family) return null;
  const prefix = font.slice(0, font.length - (trimmed.length - m.at)).trim().split(/\s+/);
  let weight = 400;
  let style: 'normal' | 'italic' = 'normal';
  for (const token of prefix) {
    if (token === 'italic' || token === 'oblique') style = 'italic';
    else if (token === 'bold' || token === 'bolder') weight = 700;
    else if (token === 'lighter') weight = 300;
    else if (/^\d+(?:\.\d+)?$/.test(token)) weight = Number(token);
  }
  return { family, weight, style };
}

/** Every family a canvas font shorthand lists, in order, unquoted
 *  (`'700 16px "Lora", "Noto Serif", serif'` → Lora, Noto Serif, serif);
 *  empty when the string has no `px` size. */
export function fontStringFamilies(font: string): string[] {
  const m = familyAfterSize(font.trim());
  if (!m) return [];
  const out: string[] = [];
  let quote: string | undefined;
  let from = 0;
  const list = m.family;
  const push = (end: number): void => {
    const f = firstFamily(list.slice(from, end));
    if (f) out.push(f);
    from = end + 1;
  };
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      push(i);
    }
  }
  push(list.length);
  return out;
}

/** The family of a canvas font shorthand, or null. */
export function fontStringFamily(font: string): string | null {
  const m = familyAfterSize(font.trim());
  return m ? firstFamily(m.family) || null : null;
}
