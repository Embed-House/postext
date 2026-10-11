/**
 * The OpenType language system text is shaped in (#427).
 *
 * One Unicode code point of Han, of the CJK punctuation or of the quotes
 * has several regional shapes, and a pan-CJK face (Source Han, Noto CJK)
 * holds them all: its `locl` feature picks the Japanese ones under the
 * language system `JAN `. The browser selects it from the document's
 * `lang` (the canvas's `ctx.lang`, the HTML's `lang`), so the layout was
 * measured, and the screen painted, with the Japanese forms; fontkit's
 * `layout()` shapes in the font's default language unless it is told
 * otherwise, and a PDF of the same page printed Chinese forms. Noto Serif
 * JP keeps its default forms Japanese but still sets “ ” and the ASCII
 * quotes of Japanese text in their `JAN ` forms.
 *
 * Every face pdf-lib embeds through fontkit is made to shape in the
 * language in force ({@link shapeInCurrentLanguage}), which the page
 * painter sets from the document's language for each page and a line
 * from a segment's own (`VDTLineSegment.lang`): `JAN ` for Japanese
 * ({@link openTypeLanguageOf}), none for any other language, so Chinese,
 * Korean, Latin and Arabic text is shaped exactly as before. Pages are
 * painted synchronously, so the language in force is the page's.
 *
 * The script in force (#725) works the same way, for one word at a time:
 * a word with no letter (`46.`, `1367)`) that the layout measured in the
 * script of the text around it (`VDTLineSegment.scriptContext`) is shaped
 * in that script ({@link withShapingScript}), where fontkit would read no
 * script from its characters and take the font's default. Amiri sets the
 * Latin full stop and brackets under `latn` only: without it the PDF
 * printed Arabic ones in a Latin note, wider than the places measured.
 */
import { isJapaneseLanguage } from 'postext';
import type { PDFFont } from 'pdf-lib';

let current: string | undefined;

/** The OpenType language system fontkit shapes a language's text in:
 *  `JAN` (fontkit pads it to `JAN `) for Japanese; undefined, the font's
 *  default, for every other language. */
export function openTypeLanguageOf(tag: string | undefined): string | undefined {
  return isJapaneseLanguage(tag) ? 'JAN' : undefined;
}

/** The language system text is shaped in now (undefined: the font's
 *  default). */
export function shapingLanguage(): string | undefined {
  return current;
}

/** Run `fn` with text shaped in `language` (see {@link
 *  openTypeLanguageOf}), then put back the language in force before, also
 *  when `fn` throws. */
export function withShapingLanguage<T>(language: string | undefined, fn: () => T): T {
  if (language === current) return fn();
  const previous = current;
  current = language;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The scripts a word with no letter may be shaped in (ISO 15924, as
 *  `VDTLineSegment.scriptContext` names them) and their OpenType tags. */
const OPENTYPE_SCRIPT: Readonly<Record<string, string>> = { Latn: 'latn', Grek: 'grek', Cyrl: 'cyrl', Arab: 'arab', Hebr: 'hebr', Hani: 'hani' };
/** A letter of each script: the file of a face cut into several that
 *  holds it is the one the script's text is set in (`fileRuns`). */
const SCRIPT_LETTER: Readonly<Record<string, number>> = { Latn: 0x6E, Grek: 0x3BD, Cyrl: 0x43D, Arab: 0x628, Hebr: 0x5D0, Hani: 0x4E00 };

let currentScript: string | undefined;

/** The script (ISO 15924) text is shaped in now; undefined: the one each
 *  shaper reads from the text. */
export function shapingScript(): string | undefined {
  return currentScript;
}

/** A letter of the script in force (a code point), undefined with none. */
export function shapingScriptLetter(): number | undefined {
  return currentScript === undefined ? undefined : SCRIPT_LETTER[currentScript];
}

/** Run `fn` with text shaped in `script` (an ISO 15924 code the engine
 *  acts on, else ignored), then put back the script in force before, also
 *  when `fn` throws. */
export function withShapingScript<T>(script: string | undefined, fn: () => T): T {
  const next = script !== undefined && OPENTYPE_SCRIPT[script] !== undefined ? script : undefined;
  if (next === currentScript) return fn();
  const previous = currentScript;
  currentScript = next;
  try {
    return fn();
  } finally {
    currentScript = previous;
  }
}

/** The key a cache of shaped `text` holds it under: the text itself in
 *  the default language and script (as every cache did), else tagged with
 *  the language and the script it was shaped in. */
export function shapingKey(text: string): string {
  if (currentScript !== undefined) return `${currentScript}\u0001${current ?? ''}\u0000${text}`;
  return current === undefined ? text : `${current}\u0000${text}`;
}

/** Text with a character of a script of its own (Han, kana, Latin…), from
 *  which fontkit reads the script to shape in; punctuation and symbols
 *  alone (「。」, “, ー) have none. */
const STRONG_SCRIPT_RE = /[^\p{Script=Common}\p{Script=Inherited}]/u;

type Layout = (text: string, features?: unknown, script?: string, language?: string, direction?: string) => unknown;

const shaped = new WeakSet<object>();

/**
 * Make the fontkit face of `font` shape in the language in force when a
 * caller names none: pdf-lib's encoding and widths, the kerning of
 * `showTextShaped` and the vertical twin all call `layout()` without one.
 * Text of punctuation alone is shaped as Han under a language (fontkit
 * would read no script from it, and take the default script, which has no
 * language systems), as a browser shapes it with the Japanese text around
 * it. With a script in force the text is shaped in it, left to right
 * (fontkit would take the direction from the script and set `1367` in an
 * Arabic sentence backwards; a right-to-left word is HarfBuzz's). With
 * neither in force the call is the one it always was.
 */
export function shapeInCurrentLanguage(font: PDFFont): void {
  const face = (font as unknown as { embedder?: { font?: { layout?: Layout } } }).embedder?.font;
  if (!face || typeof face.layout !== 'function' || shaped.has(face)) return;
  const layout = face.layout.bind(face);
  face.layout = (text, features, script, language, direction) => {
    const lang = language ?? current;
    if (script === undefined && currentScript !== undefined) return layout(text, features, OPENTYPE_SCRIPT[currentScript], lang, direction ?? 'ltr');
    if (lang === undefined) return layout(text, features, script, language, direction);
    const scriptTag = script ?? (typeof text === 'string' && !STRONG_SCRIPT_RE.test(text) ? 'hani' : undefined);
    return layout(text, features, scriptTag, lang, direction);
  };
  shaped.add(face);
}
