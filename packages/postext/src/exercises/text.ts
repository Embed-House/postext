/**
 * Runs of inline text for the exercise expansion (#1225): a block's plain
 * text, its spans and its source map kept together, so a piece cut from a
 * block (an option, the right side of a pair) or a word the engine adds (a
 * label, a number) stays mapped to the source the Sandbox points at.
 */

import type { ContentBlock, InlineSpan } from '../parse/index.js';
import { sliceSpan } from '../parse/links.js';

/** A block's inline content: `text` is the spans joined, `sourceMap` one
 *  offset per character of it. */
export interface Run {
  text: string;
  spans: InlineSpan[];
  sourceMap: number[];
}

export const EMPTY_RUN: Run = { text: '', spans: [], sourceMap: [] };

export function runOf(block: Pick<ContentBlock, 'text' | 'spans' | 'sourceMap'>): Run {
  return { text: block.text, spans: block.spans, sourceMap: block.sourceMap };
}

/** `[start, end)` of a run. */
export function sliceRun(run: Run, start: number, end: number = run.text.length): Run {
  start = Math.max(0, Math.min(start, run.text.length));
  end = Math.max(start, Math.min(end, run.text.length));
  const spans: InlineSpan[] = [];
  let at = 0;
  for (const s of run.spans) {
    const a = at;
    const b = at + s.text.length;
    at = b;
    if (b <= start || a >= end) continue;
    const from = Math.max(start, a) - a;
    const to = Math.min(end, b) - a;
    spans.push(from === 0 && to === s.text.length ? s : sliceSpan(s, from, to));
  }
  return { text: run.text.slice(start, end), spans, sourceMap: run.sourceMap.slice(start, end) };
}

/** The runs one after another. */
export function joinRuns(...runs: Run[]): Run {
  const out: Run = { text: '', spans: [], sourceMap: [] };
  for (const r of runs) {
    out.text += r.text;
    out.spans.push(...r.spans);
    out.sourceMap.push(...r.sourceMap);
  }
  return out;
}

/** Words the engine sets (a label, a number), mapped to `at`. */
export function textRun(text: string, at: number, style: Partial<InlineSpan> = {}): Run {
  if (text === '') return EMPTY_RUN;
  return { text, spans: [{ text, bold: false, italic: false, ...style }], sourceMap: new Array<number>(text.length).fill(at) };
}

/** A run whose spans are all set bold (or `italic`). */
export function styledRun(run: Run, style: Partial<Pick<InlineSpan, 'bold' | 'italic'>>): Run {
  return { ...run, spans: run.spans.map((s) => ({ ...s, ...style })) };
}

/** The run with the white space at its ends taken off. */
export function trimRun(run: Run): Run {
  let a = 0;
  let b = run.text.length;
  while (a < b && /\s/u.test(run.text[a]!)) a++;
  while (b > a && /\s/u.test(run.text[b - 1]!)) b--;
  return a === 0 && b === run.text.length ? run : sliceRun(run, a, b);
}

/** The run cut at every match of `sep` (a plain-text pattern), trimmed. */
export function splitRun(run: Run, sep: RegExp): Run[] {
  const out: Run[] = [];
  const re = new RegExp(sep.source, sep.flags.includes('g') ? sep.flags : sep.flags + 'g');
  let last = 0;
  for (let m = re.exec(run.text); m; m = re.exec(run.text)) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push(trimRun(sliceRun(run, last, m.index)));
    last = m.index + m[0].length;
  }
  out.push(trimRun(sliceRun(run, last)));
  return out;
}

/** A content block of `type` holding `run`. */
export function blockOfRun(type: ContentBlock['type'], run: Run, fields: Partial<ContentBlock> = {}): ContentBlock {
  const start = run.sourceMap.length > 0 ? Math.min(...run.sourceMap) : (fields.sourceStart ?? 0);
  const end = run.sourceMap.length > 0 ? Math.max(...run.sourceMap) + 1 : (fields.sourceEnd ?? start);
  return { type, text: run.text, spans: run.spans, sourceMap: run.sourceMap, sourceStart: start, sourceEnd: end, ...fields };
}
