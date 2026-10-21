/**
 * The language and the script text is shaped in (#427, #725, #764).
 *
 * A font draws some characters otherwise by language (`locl`): a pan-CJK
 * face holds the regional shapes of Han and of the CJK punctuation, Noto
 * Serif SC sets its digits and its ASCII quotes otherwise in Chinese, a
 * Latin face has a Catalan `l·l`, a Turkish `i` that keeps `fi` apart, a
 * Romanian `ș`. The browser that measured the layout was told the language
 * (`ctx.lang`, which the engine sets to the document's, and to a run's own
 * where it names one) and handed it to HarfBuzz; so the PDF shapes each
 * text in the language it was measured in, with both its shapers:
 *
 * - HarfBuzz (`shapedText.ts`) takes the BCP 47 tag, as the browser's did;
 * - fontkit, which pdf-lib embeds every face through and which sets the
 *   plain left-to-right text, takes an OpenType language tag: the first of
 *   the language's tags (`otLanguages.ts`, HarfBuzz's own table) that the
 *   script of the text has in the font, which is the one HarfBuzz takes.
 *
 * The page painter sets the language in force from the document for each
 * page ({@link withDocumentLanguage}) and a line from a segment's own
 * (`VDTLineSegment.lang`, {@link withSegmentLanguage}). Pages are painted
 * synchronously, so the language in force is the page's.
 *
 * A document that keeps the host's language (`bodyText.shapingLanguage:
 * 'host'`, which a configuration stored before `configVersion` 14 reads
 * with unless it names the document's) is shaped as postext-pdf shaped up
 * to 1.28, so it prints the same bytes: `JAN ` through fontkit for
 * Japanese, with punctuation alone shaped as Han, and no language at all
 * for any other document or through HarfBuzz.
 *
 * The script: a browser's canvas shapes a string with no character above
 * U+00FF as Latin text whatever it holds (Chrome keeps such a string in
 * eight bits, and skips the search for its scripts), so `2026` or `"`
 * measured alone took the Latin forms of the face in the language, where a
 * shaper left to itself reads no script from them and takes the font's
 * default. Text shaped in a document's language follows the canvas
 * ({@link shapingScriptOf}). Any other text with no letter (`……`, `—`)
 * was measured in the default script, by the canvas and by both shapers.
 *
 * The canvas shapes that string word by word (`canvasWords.ts`, #770): it
 * cuts it at its spaces and around each CJK character, shapes each word
 * alone, and gives it the script of its own letters. A word with no
 * letter of a string it did not keep in eight bits has no script
 * ({@link withinWideText}): the `"` beside a kana keeps the default form
 * of Noto Serif JP in Japanese, and takes the Japanese one alone or in a
 * Latin word. Text shaped in a document's language is cut the same way
 * (`wordRuns` in `faceFiles.ts`).
 *
 * That rule is for the string the canvas was handed, the word the layout
 * measured, not for what a face made of several files leaves of it.
 * Chrome cuts a string into runs of one direction and each run into words
 * at its spaces, and gives a mark the script of the word it stands in
 * before it looks for the file that draws it: the `»` and the stop of
 * `خالة.»`, which Fontsource keeps in the `latin` file of an Arabic
 * family, are Arabic text to it. Markazi Text draws its guillemets 0.1 em
 * narrower for Arabic text in Arabic (`arab`, `ARA `) and Amiri sets a
 * Latin stop and brackets under `latn` only, so a mark shaped alone as
 * Latin text came out at another width than the one measured (#764). So:
 *
 * - a part with no letter, cut out of a word that has one, is shaped in
 *   the script of the letter beside it ({@link besideLetterOf},
 *   {@link withBesideLetter});
 * - a piece with no letter and none beside it, in a string with
 *   right-to-left letters (never one kept in eight bits), is shaped in no
 *   script, also where the piece itself has no character above U+00FF
 *   ({@link withinRightToLeftText}).
 *
 * The script in force (#725) is for one word at a time: a word with no
 * letter (`46.`, `1367)`) that the layout measured in the script of the
 * text around it (`VDTLineSegment.scriptContext`) is shaped in that script
 * ({@link withShapingScript}). Amiri sets the Latin full stop and brackets
 * under `latn` only: without it the PDF printed Arabic ones in a Latin
 * note, wider than the places measured.
 *
 * Han is the exception, in a document's language: the layout measured the
 * word beside an ideograph, and Chrome's canvas shapes every Han character
 * of a string apart from what stands beside it, so the word was shaped
 * with no script at all (`——` beside 一 is 1.69 em wide in Noto Serif SC
 * in Chinese, and 2 em in a Han run, where the Chinese forms apply). It is
 * shaped in the default script, in the language, whatever it holds.
 */
import { isJapaneseLanguage, shapingTagOf } from 'postext';
import type { PDFFont } from 'pdf-lib';
import { openTypeLanguagesOf } from './otLanguages.js';

/** A language text is shaped in. */
interface Language {
  /** The BCP 47 tag HarfBuzz is told (`''`: no language); undefined for a
   *  document in the host's language, which told HarfBuzz none. */
  readonly tag: string | undefined;
  /** The OpenType language tags fontkit may be told, in order of
   *  preference, without trailing spaces. */
  readonly openType: readonly string[];
  /** Shaped as up to postext-pdf 1.28 (see the module comment). */
  readonly host: boolean;
  /** What tells this language apart in the key of a cache of shaped text. */
  readonly key: string;
}

/** Japanese in a document that keeps the host's language. */
const HOST_JAPANESE: Language = { tag: undefined, openType: ['JAN'], host: true, key: 'JAN' };

const languages = new Map<string, Language>();
/** Languages kept before the map is emptied (a document names a handful). */
const LANGUAGE_SLOTS = 200;

/** The language of the BCP 47 tag `tag` (`''`: none, the forms of no
 *  language), for a document shaped in its own. */
function languageOf(tag: string): Language {
  let language = languages.get(tag);
  if (!language) {
    language = { tag, openType: openTypeLanguagesOf(tag), host: false, key: `\u0002${tag}` };
    if (languages.size >= LANGUAGE_SLOTS) languages.clear();
    languages.set(tag, language);
  }
  return language;
}

/** What a document in the host's language shapes a language's text in:
 *  `JAN ` for Japanese, nothing for any other. */
function hostLanguageOf(tag: string | undefined): Language | undefined {
  return isJapaneseLanguage(tag) ? HOST_JAPANESE : undefined;
}

let current: Language | undefined;
/** Whether the page being painted keeps the host's language. */
let hostPage = false;

function withLanguage<T>(language: Language | undefined, fn: () => T): T {
  if (language === current) return fn();
  const previous = current;
  current = language;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The BCP 47 tag of the language text is shaped in now, for HarfBuzz
 *  (`''`: shaped as a document's text, in no language); undefined with no
 *  language in force. */
export function shapingLanguage(): string | undefined {
  return current?.tag;
}

/** Run `fn` with text shaped in the language of the BCP 47 tag `language`
 *  (`''`: as a document's text in no language; undefined: no language in
 *  force, each shaper left to itself), then put back the language in force
 *  before, also when `fn` throws. */
export function withShapingLanguage<T>(language: string | undefined, fn: () => T): T {
  return withLanguage(language === undefined ? undefined : languageOf(language), fn);
}

/**
 * Run `fn` (the painting of a page) with text shaped in its document's
 * language: `shaping` is the tag the layout measured in
 * (`shapingLanguageOf(config)` of postext), or undefined for a document
 * that keeps the host's language, which is then shaped as before from the
 * tag it declares (`declared`, its `/Lang`).
 */
export function withDocumentLanguage<T>(shaping: string | undefined, declared: string | undefined, fn: () => T): T {
  const host = shaping === undefined;
  const previous = hostPage;
  hostPage = host;
  try {
    return withLanguage(host ? hostLanguageOf(declared) : languageOf(shaping), fn);
  } finally {
    hostPage = previous;
  }
}

/** Whether a segment that names its language (`VDTLineSegment.lang`) is
 *  shaped in it wherever it stands: in a document shaped in its own
 *  language. One that keeps the host's did so on the lines of the CJK
 *  composer only. */
export function shapesSegmentLanguages(): boolean {
  return !hostPage;
}

/**
 * Run `fn` (the painting of a segment) with text shaped in the segment's
 * own language `lang` (`VDTLineSegment.lang`, as written), in the
 * language in force when it names none. In a document that keeps the
 * host's language a segment is shaped as it was: with `asBefore`, in `JAN `
 * when its language is Japanese and in the font's default otherwise (the
 * text of the body); without it, in the language in force.
 */
export function withSegmentLanguage<T>(lang: string | undefined, fn: () => T, asBefore = false): T {
  if (lang === undefined) return fn();
  if (hostPage) return asBefore ? withLanguage(hostLanguageOf(lang), fn) : fn();
  return withLanguage(languageOf(shapingTagOf(lang)), fn);
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

/** Text a browser keeps in eight bits: no character above U+00FF. */
const LATIN_1_RE = /^[\u0000-\u00FF]*$/;
/** The space words are cut at. */
const SPACE = 0x20;

/** The scripts a mark takes from the letter beside it (ISO 15924, the
 *  names `\p{sc=…}` knows them by): the ones a family comes cut into
 *  files by, and the right-to-left ones HarfBuzz paints. Not Han, kana or
 *  Hangul: the canvas shapes each of those characters apart from what
 *  stands beside it (see the module comment). */
const BESIDE_SCRIPTS = ['Latn', 'Grek', 'Cyrl', 'Armn', 'Geor', 'Hebr', 'Arab', 'Syrc', 'Thaa', 'Nkoo', 'Samr', 'Mand', 'Adlm', 'Rohg'] as const;
let besideScriptRes: readonly [string, RegExp][] | undefined;
const besideScripts = new Map<number, string | undefined>();

/** The script of the letter `cp`, one of {@link BESIDE_SCRIPTS}; undefined
 *  for a letter of any other script and for a character with none. */
function besideScriptOf(cp: number): string | undefined {
  if (besideScripts.has(cp)) return besideScripts.get(cp);
  besideScriptRes ??= BESIDE_SCRIPTS.map((code) => [code, new RegExp(`\\p{sc=${code}}`, 'u')]);
  const ch = String.fromCodePoint(cp);
  const script = besideScriptRes.find(([, re]) => re.test(ch))?.[0];
  if (besideScripts.size >= SCRIPT_SLOTS) besideScripts.clear();
  besideScripts.set(cp, script);
  return script;
}

/** The letter (a code point) whose script a part with no letter is shaped
 *  in now; undefined: the part is shaped as a text of its own. */
let besideLetter: number | undefined;

/** Run `fn` (the shaping of one part of a word, cut out by the file that
 *  draws it) with the part shaped in the script of `letter`
 *  ({@link besideLetterOf}; undefined: as a text of its own), then put back
 *  what was in force before, also when `fn` throws. */
export function withBesideLetter<T>(letter: number | undefined, fn: () => T): T {
  if (letter === besideLetter) return fn();
  const previous = besideLetter;
  besideLetter = letter;
  try {
    return fn();
  } finally {
    besideLetter = previous;
  }
}

/**
 * The letter whose script the part `[from, to)` of `text` takes, when the
 * part holds no letter and `text` (the string the layout measured: a word,
 * a run of one direction) does: the nearest letter before it in its word,
 * else the first after it. A word ends at a space: the browser shapes each
 * word of a run apart, so a mark between two spaces takes nothing from
 * the words either side. That is the script the browser gave the part,
 * whatever file draws it (Chrome 154, measured: `«أنا` in Markazi Text
 * under `ar` is 939 thousandths of the em set right to left, 636 for the
 * letters and 303 for the guillemet of Arabic text, which alone is 407).
 * Undefined, the part shaped as a text of its own, for a part with a
 * letter, for one that holds two words, for text with no character above
 * U+00FF (all of it is Latin text to the canvas), when the letter is of a
 * script the rule leaves alone ({@link BESIDE_SCRIPTS}), with a script in
 * force (#725) and in a document that keeps the host's language.
 */
export function besideLetterOf(text: string, from: number, to: number): number | undefined {
  if (!shapedAsCanvas() || currentScript !== undefined) return undefined;
  if (STRONG_SCRIPT_RE.test(text.slice(from, to)) || LATIN_1_RE.test(text)) return undefined;
  // The part without the spaces at its ends: what is left is in one word.
  let start = from;
  let end = to;
  while (start < end && text.charCodeAt(start) === SPACE) start++;
  while (end > start && text.charCodeAt(end - 1) === SPACE) end--;
  if (start === end || text.slice(start, end).includes(' ')) return undefined;
  let found: number | undefined;
  // Backwards by UTF-16 unit: a low surrogate is skipped to its pair.
  for (let at = start - 1; at >= 0 && found === undefined; at--) {
    const unit = text.charCodeAt(at);
    if (unit === SPACE) break;
    if (unit >= 0xDC00 && unit <= 0xDFFF) continue;
    const cp = text.codePointAt(at)!;
    if (STRONG_SCRIPT_RE.test(String.fromCodePoint(cp))) found = cp;
  }
  for (let at = end; at < text.length && found === undefined;) {
    const cp = text.codePointAt(at)!;
    if (cp === SPACE) break;
    if (STRONG_SCRIPT_RE.test(String.fromCodePoint(cp))) found = cp;
    at += cp > 0xFFFF ? 2 : 1;
  }
  return found !== undefined && besideScriptOf(found) !== undefined ? found : undefined;
}

/** Whether the text being shaped is part of a string the canvas did not
 *  keep in eight bits ({@link withinWideText}). */
let wideText = false;

/**
 * Run `fn` (the shaping of the words, the runs and the parts of a string)
 * knowing whether the string holds a character above U+00FF (`wide`).
 * The canvas shapes a string word by word (`canvasWords.ts`), and gives a
 * word the script of its own letters; only a string it keeps in eight bits
 * is Latin text all through. So a word with no letter of a wider string
 * (the `2012` and the `·` of a running head that opens with a Han
 * character) is shaped in no script, though the word alone has no
 * character above U+00FF. Put back afterwards, also when `fn` throws.
 */
export function withinWideText<T>(wide: boolean, fn: () => T): T {
  if (wide === wideText) return fn();
  const previous = wideText;
  wideText = wide;
  try {
    return fn();
  } finally {
    wideText = previous;
  }
}

/**
 * Run `fn` (the shaping of the runs and the parts of `text`, a string
 * HarfBuzz sets) knowing whether `text` holds a right-to-left letter
 * (`rightToLeft`). Such a string is not one the canvas kept in eight
 * bits, so a piece of it with no letter and none beside it in its word
 * (the `(` and the `)` of `كتاب (1)`, each a run of its own; the `.` of
 * `كتاب . كتاب`) was shaped in no script, even where the piece alone has
 * no character above U+00FF: Amiri sets those brackets 0.458 em wide, and
 * 0.255 em as Latin text. Put back afterwards, also when `fn` throws.
 */
export function withinRightToLeftText<T>(rightToLeft: boolean, fn: () => T): T {
  return withinWideText(rightToLeft, fn);
}

/** Whether `text` is shaped in no script though it has no character above
 *  U+00FF: a piece with no letter of a string the canvas did not keep in
 *  eight bits ({@link withinWideText}, {@link withinRightToLeftText}). */
function unscripted(text: string): boolean {
  return wideText && !STRONG_SCRIPT_RE.test(text);
}

/** Whether text is shaped as the canvas shaped it (see the module
 *  comment): the text of a document shaped in its own language. */
function shapedAsCanvas(): boolean {
  return current !== undefined && !current.host;
}

/** Whether the text being painted is shaped as the canvas shaped it: word
 *  by word (`canvasWords.ts`), each word in the script of its letters. So
 *  is the text of a document shaped in its own language; one that keeps
 *  the host's is shaped string by string, as up to postext-pdf 1.29. */
export function shapesAsCanvas(): boolean {
  return shapedAsCanvas();
}

/**
 * The script (ISO 15924) `text` is shaped in, undefined for the one the
 * shaper reads from the text (the default script, for text with no
 * letter). The script in force; else, and for a word the layout measured
 * beside an ideograph, as the canvas shaped the text of a document in its
 * own language: the script of the letter a part with no letter was cut
 * from beside ({@link withBesideLetter}), else Latin with no character
 * above U+00FF (but no script for a piece with no letter of a string with
 * right-to-left letters, {@link withinRightToLeftText}), no script beside
 * an ideograph. For HarfBuzz; fontkit is told the same
 * ({@link shapeInCurrentLanguage}).
 */
export function shapingScriptOf(text: string): string | undefined {
  if (!shapedAsCanvas()) return currentScript;
  if (currentScript === 'Hani') return undefined;
  if (currentScript !== undefined) return currentScript;
  const beside = besideLetter !== undefined ? besideScriptOf(besideLetter) : undefined;
  return beside ?? (LATIN_1_RE.test(text) && !unscripted(text) ? 'Latn' : undefined);
}

/** The key a cache of shaped `text` holds it under: the text itself with
 *  no language and no script in force (as every cache did), else tagged
 *  with the language and the script it was shaped in. */
export function shapingKey(text: string): string {
  if (currentScript !== undefined) return `${currentScript}\u0001${current?.key ?? ''}\u0000${text}`;
  if (besideLetter !== undefined && shapedAsCanvas()) return `${besideScriptOf(besideLetter) ?? ''}\u0003${current?.key ?? ''}\u0000${text}`;
  if (shapedAsCanvas() && unscripted(text) && LATIN_1_RE.test(text)) return `\u0004${current?.key ?? ''}\u0000${text}`;
  return current === undefined ? text : `${current.key}\u0000${text}`;
}

/** Text with a character of a script of its own (Han, kana, Latin…), from
 *  which fontkit reads the script to shape in; punctuation and symbols
 *  alone (「。」, “, ー) have none. */
const STRONG_SCRIPT_RE = /[^\p{Script=Common}\p{Script=Inherited}]/u;

/** fontkit's shaped run, as far as the script it read from a text. */
interface FontkitRun {
  script?: string | string[];
}
type Layout = (text: string, features?: unknown, script?: string, language?: string, direction?: string) => unknown;

/** A script of a font's `GSUB` or `GPOS`, as fontkit decodes it. */
interface ScriptEntry {
  tag: string;
  script?: { langSysRecords?: readonly { tag: string }[] };
}
interface LayoutTable {
  scriptList?: readonly ScriptEntry[] | null;
}
interface FontkitFace {
  layout?: Layout;
  GSUB?: LayoutTable;
  GPOS?: LayoutTable;
}

/** The scripts fontkit falls back to when a font lacks the one asked for
 *  (as HarfBuzz does). */
const DEFAULT_SCRIPTS = ['DFLT', 'dflt', 'latn'];
/** The OpenType script tags of no script: what fontkit reads from text
 *  with no letter. */
const NO_SCRIPT: readonly string[] = [];

/** The OpenType script tags fontkit reads from each character (the first
 *  of a text that has a script decides): asked of fontkit once each. */
const scriptsByCodePoint = new Map<number, readonly string[]>();
const SCRIPT_SLOTS = 4096;

/** The OpenType script tags fontkit shapes `text` in when it is told
 *  none: those of its first character with a script (`['latn']`,
 *  `['dev2', 'deva']`), none for text with no such character. */
function scriptsOfText(layout: Layout, text: string): readonly string[] {
  const strong = STRONG_SCRIPT_RE.exec(text);
  if (!strong) return NO_SCRIPT;
  const cp = text.codePointAt(strong.index)!;
  let scripts = scriptsByCodePoint.get(cp);
  if (scripts === undefined) {
    const read = (layout(String.fromCodePoint(cp), []) as FontkitRun | undefined)?.script;
    scripts = read === undefined ? NO_SCRIPT : Array.isArray(read) ? read : [read];
    if (scriptsByCodePoint.size >= SCRIPT_SLOTS) scriptsByCodePoint.clear();
    scriptsByCodePoint.set(cp, scripts);
  }
  return scripts;
}

/** The script of `table` text in `scripts` is shaped with: the first of
 *  them the table has, else the first default script it has (fontkit's
 *  `selectScript`, and HarfBuzz's). */
function scriptEntry(table: LayoutTable | undefined, scripts: readonly string[]): ScriptEntry | undefined {
  const list = table?.scriptList;
  if (!list) return undefined;
  for (const tags of [scripts, DEFAULT_SCRIPTS]) {
    for (const tag of tags) {
      const entry = list.find((e) => e.tag === tag);
      if (entry) return entry;
    }
  }
  return undefined;
}

/** Whether a face names the script `tag` in its `GSUB` or its `GPOS`. */
function hasScript(face: FontkitFace, tag: string): boolean {
  return [face.GSUB, face.GPOS].some((table) => table?.scriptList?.some((entry) => entry.tag === tag) ?? false);
}

function hasLanguage(entry: ScriptEntry | undefined, tag: string): boolean {
  const padded = tag.padEnd(4, ' ');
  return entry?.script?.langSysRecords?.some((record) => record.tag === padded) ?? false;
}

/** Whether a face has a language system for any of some tags, under any
 *  script: by face, then by the tags. Most faces have none for most
 *  languages, and their text is then shaped with no more ado. */
const facesWithLanguage = new WeakMap<object, Map<string, boolean>>();
/** The language system of a face for a language and a script. */
const systemsByFace = new WeakMap<object, Map<string, string | undefined>>();

function faceHasAnyLanguage(face: FontkitFace, language: Language): boolean {
  let known = facesWithLanguage.get(face);
  if (!known) {
    known = new Map();
    facesWithLanguage.set(face, known);
  }
  let has = known.get(language.key);
  if (has === undefined) {
    const tags = [...language.openType, 'dflt'];
    has = [face.GSUB, face.GPOS].some((table) => table?.scriptList?.some((entry) => tags.some((tag) => hasLanguage(entry, tag))) ?? false);
    known.set(language.key, has);
  }
  return has;
}

/**
 * The OpenType language tag fontkit is told for text of `language` shaped
 * in `scripts` (OpenType script tags, none for the default script) with
 * `face`: the first of the language's tags that the script has in the
 * font's `GSUB`, else in its `GPOS`; else `dflt` where the script names a
 * language system so (HarfBuzz takes it before the default one);
 * undefined, the script's default language system, when it has none.
 * HarfBuzz chooses in each table apart; a font whose two tables answer a
 * language with different systems is shaped here in the `GSUB` one.
 */
function languageSystem(face: FontkitFace, scripts: readonly string[], language: Language): string | undefined {
  if (language.openType.length === 0 || !faceHasAnyLanguage(face, language)) return undefined;
  let known = systemsByFace.get(face);
  if (!known) {
    known = new Map();
    systemsByFace.set(face, known);
  }
  const key = `${language.key}\u0000${scripts.join(',')}`;
  if (known.has(key)) return known.get(key);
  const entries = [scriptEntry(face.GSUB, scripts), scriptEntry(face.GPOS, scripts)];
  let system: string | undefined;
  for (const entry of entries) system ??= language.openType.find((tag) => hasLanguage(entry, tag));
  for (const entry of entries) system ??= hasLanguage(entry, 'dflt') ? 'dflt' : undefined;
  known.set(key, system);
  return system;
}

const shaped = new WeakSet<object>();

/**
 * Make the fontkit face of `font` shape in the language in force when a
 * caller names none: pdf-lib's encoding and widths, the kerning of
 * `showTextShaped` and the vertical twin all call `layout()` without one.
 *
 * Text of a document shaped in its own language is told the language
 * system of that language for the script it is shaped in
 * ({@link languageSystem}): the script in force (the default one for a
 * word measured beside an ideograph), else the script of the letter a
 * part with no letter was cut from beside, else Latin for text with no
 * character above U+00FF, else the one fontkit reads from the text
 * ({@link shapingScriptOf}).
 *
 * Text of a Japanese document that keeps the host's language is told
 * `JAN `, and punctuation alone is shaped as Han under it (fontkit would
 * read no script from it, and take the default script, which has no
 * language systems), as up to postext-pdf 1.28.
 *
 * With a script in force the text is shaped in it, left to right (fontkit
 * would take the direction from the script and set `1367` in an Arabic
 * sentence backwards; a right-to-left word is HarfBuzz's). With neither a
 * language nor a script in force the call is the one it always was.
 */
export function shapeInCurrentLanguage(font: PDFFont): void {
  const face = (font as unknown as { embedder?: { font?: FontkitFace } }).embedder?.font;
  if (!face || typeof face.layout !== 'function' || shaped.has(face)) return;
  const layout = face.layout.bind(face);
  face.layout = (text, features, script, language, direction) => {
    const inForce = script === undefined && currentScript !== undefined ? OPENTYPE_SCRIPT[currentScript] : undefined;
    const state = current;
    if (state === undefined || state.host || language !== undefined || typeof text !== 'string') {
      const lang = language ?? (state?.host ? state.openType[0] : undefined);
      if (inForce !== undefined) return layout(text, features, inForce, lang, direction ?? 'ltr');
      if (lang === undefined) return layout(text, features, script, language, direction);
      const scriptTag = script ?? (typeof text === 'string' && !STRONG_SCRIPT_RE.test(text) ? 'hani' : undefined);
      return layout(text, features, scriptTag, lang, direction);
    }
    // A part with no letter, in the script of the letter it was cut from
    // beside: the first of that script's tags the font has.
    const beside = inForce === undefined && script === undefined && besideLetter !== undefined ? scriptsOfText(layout, String.fromCodePoint(besideLetter)) : NO_SCRIPT;
    const besideTag = beside.find((tag) => hasScript(face, tag)) ?? beside[0];
    // `DFLT`: the default script, which fontkit also takes for a script
    // the font lacks.
    const scriptTag = inForce === 'hani' ? 'DFLT' : inForce ?? script ?? besideTag ?? (LATIN_1_RE.test(text) && !unscripted(text) ? 'latn' : undefined);
    const system = languageSystem(face, scriptTag !== undefined ? [scriptTag] : scriptsOfText(layout, text), state);
    return layout(text, features, scriptTag, system, inForce !== undefined ? direction ?? 'ltr' : direction);
  };
  shaped.add(face);
}
