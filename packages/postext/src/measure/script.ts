/**
 * A word with no letter takes the script of the text around it (#725).
 *
 * A word made only of digits, punctuation or symbols (`46.`, `1367)`, `».`)
 * has no script of its own: all its characters are Unicode `Common`. A
 * face may draw them differently by script (Amiri sets a Latin full stop,
 * brackets and guillemets under `latn` and Arabic ones otherwise: the stop
 * is 0.202 em against 0.317), and a shaper handed such a word alone picks
 * a script by a rule of its own: Chrome 131's canvas the font's default,
 * Chrome 154's Latin, fontkit (the PDF) the default. The layout measures
 * and paints word by word, so the same document broke its lines otherwise
 * from one browser version to the next, and the PDF set glyphs of another
 * width in the measured places.
 *
 * So the engine decides. A word with no letter is given the script of its
 * context ({@link resolveScriptContext}), and every stage shapes it in that
 * script by setting it beside a character of the script, the one thing the
 * browsers agree on: a character with no script takes the script of the
 * text it stands in. The measurer measures the word with that mark beside
 * it and takes the mark's width off ({@link scriptMark}); the canvas paints
 * the two and clips the mark away; the HTML hides it in a box of no size;
 * the PDF asks its shaper for the script. Measured in headless Chrome 131
 * and 154 with Amiri: the widths, the DOM widths and the clipped pixels are
 * the same on both, for every mark below.
 *
 * It costs nothing where it does nothing: a face whose punctuation is the
 * same under every script ({@link scriptSensitive}, nearly all of them) is
 * left alone, with no field on its segments.
 */

import { bidiClassOf, type BidiIsolate } from '../bidi';
import { localeScript } from '../locale';
import { measureMarkedWidth, scriptSensitive } from './canvas';

/** The scripts a word with no letter may be shaped in (ISO 15924). */
export type ScriptContext = 'Latn' | 'Grek' | 'Cyrl' | 'Arab' | 'Hebr';

/** A character with a script of its own: a letter, in the sense of this
 *  module (a digit, a mark of punctuation and a symbol are `Common`, a
 *  combining mark `Inherited`). */
const OWN_SCRIPT_RE = /[^\p{Script=Common}\p{Script=Inherited}]/u;

const SCRIPTS: readonly [ScriptContext, RegExp][] = [
  ['Latn', /\p{Script=Latin}/u],
  ['Arab', /\p{Script=Arabic}/u],
  ['Grek', /\p{Script=Greek}/u],
  ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Hebr', /\p{Script=Hebrew}/u],
];

/** Whether `text` holds no letter (see {@link OWN_SCRIPT_RE}) and something
 *  to shape: a word of digits, punctuation or symbols. */
export function isLetterless(text: string): boolean {
  return text.length > 0 && !OWN_SCRIPT_RE.test(text);
}

/** The script of the character `ch`: one of the five the engine acts on,
 *  `'other'` for any other script, undefined for a character with none. */
function scriptOfChar(ch: string): ScriptContext | 'other' | undefined {
  if (!OWN_SCRIPT_RE.test(ch)) return undefined;
  for (const [script, re] of SCRIPTS) if (re.test(ch)) return script;
  return 'other';
}

/** The code point of `text` that ends just before `at`, and where it starts. */
function before(text: string, at: number): { ch: string; from: number } {
  const lo = text.charCodeAt(at - 1);
  const pair = lo >= 0xDC00 && lo <= 0xDFFF && at >= 2;
  const from = pair ? at - 2 : at - 1;
  return { ch: text.slice(from, at), from };
}

/** The script of the nearest letter of `text` before `from` (down to `lo`),
 *  else after `to` (up to `hi`); `rtlOnly`: the nearest right-to-left
 *  letter. `'other'` when that letter is of a script the engine does not
 *  act on, undefined when there is none. */
function nearestScript(text: string, from: number, to: number, lo: number, hi: number, rtlOnly: boolean): ScriptContext | 'other' | undefined {
  const counts = (ch: string): boolean => {
    if (!rtlOnly) return true;
    const c = bidiClassOf(ch.codePointAt(0)!);
    return c === 'R' || c === 'AL';
  };
  for (let at = from; at > lo;) {
    const { ch, from: start } = before(text, at);
    const script = scriptOfChar(ch);
    if (script !== undefined && counts(ch)) return script;
    at = start;
  }
  for (let at = to; at < hi;) {
    const cp = text.codePointAt(at)!;
    const ch = String.fromCodePoint(cp);
    const script = scriptOfChar(ch);
    if (script !== undefined && counts(ch)) return script;
    at += ch.length;
  }
  return undefined;
}

/**
 * The script a word with no letter is shaped in: `[start, end)` of the
 * paragraph `text`, at an even (`odd` false) or odd bidi level.
 * - Painted left to right (even level): the script of the nearest letter
 *   before it in its isolate, else of the nearest after it.
 * - Painted right to left (odd level): the script of the nearest
 *   right-to-left letter before it, else after it.
 * - With no such letter: the script of the document's language
 *   (`fallback`), when the word is painted that script's way.
 * Undefined when the context is a script the engine does not act on (the
 * word is then shaped alone, as up to postext 1.27).
 *
 * `isolates` are the paragraph's inline isolates (`spanIsolates`): the
 * word reads the innermost one that holds it, the paragraph otherwise.
 */
export function resolveScriptContext(
  text: string,
  start: number,
  end: number,
  odd: boolean,
  isolates: readonly BidiIsolate[],
  fallback: ScriptContext | undefined,
): ScriptContext | undefined {
  let lo = 0;
  let hi = text.length;
  // Isolates nest or are disjoint: the innermost is the shortest.
  for (const iso of isolates) {
    if (iso.start <= start && end <= iso.end && iso.end - iso.start < hi - lo) {
      lo = iso.start;
      hi = iso.end;
    }
  }
  const near = nearestScript(text, start, end, lo, hi, odd);
  if (near === 'other') return undefined;
  if (near !== undefined) return odd && !isRtlScript(near) ? undefined : near;
  if (fallback === undefined) return undefined;
  // A word painted right to left takes a right-to-left script only.
  return odd && !isRtlScript(fallback) ? undefined : fallback;
}

function isRtlScript(script: ScriptContext): boolean {
  return script === 'Arab' || script === 'Hebr';
}

/** No-break space: between the word and its mark, so the two never kern,
 *  and the word and the mark stay one run for the shaper (a breaking space
 *  would make two words of them, each shaped alone). */
const GLUE = '\u00A0';

/** After a word painted left to right: a character of the script that
 *  stays in the word's left-to-right run. For Arabic and Hebrew a sign of
 *  the script with no direction of its own (U+060E, the poetic verse sign;
 *  U+FB29, the alternative plus sign): a letter would open a right-to-left
 *  run, and Chrome 154 shapes each run of a canvas text alone. */
const AFTER: Readonly<Record<ScriptContext, string>> = { Latn: 'n', Grek: '\u03BD', Cyrl: '\u043D', Arab: '\u060E', Hebr: '\uFB29' };
/** Before a word painted right to left: a letter of the script. */
const BEFORE: Readonly<Partial<Record<ScriptContext, string>>> = { Arab: '\u0628', Hebr: '\u05D0' };

/**
 * What a word with no letter is set beside to be shaped in `script`
 * (`lead` before it, `trail` after it, in the text's order), painted left
 * to right or right to left (`rtl`, the context's direction then). Either
 * way the mark lands on the word's right, past its advance: the word
 * starts where it would alone, and a clip at its advance removes the mark.
 */
export function scriptMark(script: ScriptContext, rtl: boolean): { lead: string; trail: string } {
  const letter = rtl ? BEFORE[script] : undefined;
  return letter !== undefined ? { lead: letter + GLUE, trail: '' } : { lead: '', trail: GLUE + AFTER[script] };
}

/** `text` beside its {@link scriptMark}, as it is measured and painted. */
export function withScriptMark(text: string, script: ScriptContext, rtl: boolean): string {
  const { lead, trail } = scriptMark(script, rtl);
  return lead + text + trail;
}

const PROBE_MARKS: readonly string[] = (Object.keys(AFTER) as ScriptContext[]).map((script) => GLUE + AFTER[script]);

/** Whether the face `font` draws its punctuation or digits otherwise by
 *  script (`scriptSensitive`, asked once a font string): only then is a
 *  word with no letter given a script. */
export function faceReadsScript(font: string): boolean {
  return scriptSensitive(font, PROBE_MARKS);
}

/** The width of a word with no letter shaped in `script`, painted left to
 *  right or right to left (`rtl`): measured beside its {@link scriptMark},
 *  the mark's width taken off. */
export function scriptTextWidth(text: string, font: string, script: ScriptContext, rtl: boolean): number {
  const { lead, trail } = scriptMark(script, rtl);
  return measureMarkedWidth(text, font, lead, trail, rtl);
}

/** The script of a language tag when it is one the engine acts on
 *  (`ar`, `fa`, `ur` → `'Arab'`; `he` → `'Hebr'`; `el` → `'Grek'`; `ru` →
 *  `'Cyrl'`; `en`, `es`… → `'Latn'`), else undefined. */
export function scriptContextOfLocale(tag: unknown): ScriptContext | undefined {
  const script = localeScript(tag);
  if (script === 'Latn' || script === 'Grek' || script === 'Cyrl' || script === 'Arab' || script === 'Hebr') return script;
  // Nastaliq is the Arabic script.
  return script === 'Aran' ? 'Arab' : undefined;
}

/** What the measurer reads (see {@link setMeasureScriptContext}). */
export interface MeasureScriptContext {
  /** `bodyText.scriptContext`: off, a word with no letter is shaped alone. */
  enabled: boolean;
  /** The script of the document's language, for a word with no letter
   *  anywhere near it. */
  script?: ScriptContext;
}

const OUTSIDE_A_BUILD: MeasureScriptContext = { enabled: true, script: 'Latn' };
let measureScriptContext: MeasureScriptContext = OUTSIDE_A_BUILD;

/** Set how words with no letter are measured: the build does, from
 *  `bodyText.scriptContext` and the document's language, and puts back
 *  what it found when it is done. Outside a build: on, Latin. */
export function setMeasureScriptContext(state: MeasureScriptContext): void {
  measureScriptContext = state;
}

/** See {@link setMeasureScriptContext}. */
export function getMeasureScriptContext(): MeasureScriptContext {
  return measureScriptContext;
}

/** The part of a measurement cache key the script context decides: empty
 *  for a document in a Latin-script language with the rule on, so those
 *  keys are unchanged. */
export function scriptContextKey(): string {
  const s = measureScriptContext;
  if (!s.enabled) return 'sc0\x00';
  return s.script === 'Latn' ? '' : `sc${s.script ?? '-'}\x00`;
}
