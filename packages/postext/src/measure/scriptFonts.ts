import type { InlineSpan } from '../parse/index.js';
import type { BodyTextConfig } from '../types.js';
import { sliceSpan } from '../parse/links.js';
import { graphemesOf } from './graphemes.js';
import { parseFontString, splitAtFontSize } from './fontString.js';
import { quoteFamily } from './font.js';

export type ScriptFonts = NonNullable<BodyTextConfig['scriptFonts']>;
type FontScript = keyof ScriptFonts;

const SCRIPT_RES: ReadonlyArray<readonly [FontScript, RegExp]> = [
  ['arab', /\p{Script=Arabic}/u],
  ['hebr', /\p{Script=Hebrew}/u],
];
const LETTER_RE = /\p{L}/u;
const ANY_RE = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;

let measureScriptFonts: ScriptFonts = {};

export function setMeasureScriptFonts(fonts: ScriptFonts | undefined): void {
  measureScriptFonts = fonts ?? {};
}

export function getMeasureScriptFonts(): ScriptFonts {
  return measureScriptFonts;
}

export function scriptFontsKey(): string {
  const f = measureScriptFonts;
  return f.arab || f.hebr ? `sf${f.arab ?? ''}|${f.hebr ?? ''}\x00` : '';
}

export function needsScriptFonts(text: string): boolean {
  return !!(measureScriptFonts.arab || measureScriptFonts.hebr) && ANY_RE.test(text);
}

export function inFamily(font: string, family: string): string {
  const m = splitAtFontSize(font);
  if (!m) return font;
  return `${font.slice(0, font.length - m.family.length)}${quoteFamily(family)}`;
}

function atomic(s: InlineSpan): boolean {
  return !!(s.math || s.mathRender || s.chip || s.swatch || s.ref || s.footnote || s.ruby || s.kunten || s.warichu || s.citation);
}

function scriptOf(grapheme: string): FontScript | 'other' | undefined {
  for (const [script, re] of SCRIPT_RES) if (re.test(grapheme)) return script;
  return LETTER_RE.test(grapheme) ? 'other' : undefined;
}

export function scriptFontSpans(spans: InlineSpan[], normalFont: string): InlineSpan[] {
  const fonts = measureScriptFonts;
  if (!fonts.arab && !fonts.hebr) return spans;
  if (!spans.some((s) => ANY_RE.test(s.text))) return spans;
  const own = parseFontString(normalFont)?.family.toLowerCase();
  const familyFor = (script: FontScript | 'other'): string | undefined => {
    if (script === 'other') return undefined;
    const family = fonts[script]?.trim();
    return family && family.toLowerCase() !== own ? family : undefined;
  };
  const out: InlineSpan[] = [];
  for (const span of spans) {
    if (span.scriptFace || atomic(span) || !ANY_RE.test(span.text)) {
      out.push(span);
      continue;
    }
    const graphemes = graphemesOf(span.text);
    const classes = graphemes.map(scriptOf);
    const first = classes.find((c) => c !== undefined) ?? 'other';
    let prev: FontScript | 'other' = first;
    const resolved = classes.map((c) => (prev = c ?? prev));
    let from = 0;
    let at = 0;
    const push = (end: number, script: FontScript | 'other') => {
      const piece = from === 0 && end === span.text.length ? span : sliceSpan(span, from, end);
      const family = familyFor(script);
      out.push(family ? { ...piece, scriptFace: family } : piece);
    };
    for (let i = 0; i < graphemes.length; i++) {
      if (i > 0 && resolved[i] !== resolved[i - 1]) {
        push(at, resolved[i - 1]!);
        from = at;
      }
      at += graphemes[i]!.length;
    }
    push(at, resolved[graphemes.length - 1] ?? first);
  }
  return out;
}
