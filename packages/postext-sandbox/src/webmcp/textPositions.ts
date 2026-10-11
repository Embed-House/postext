// Places in a chapter's text as an agent names and reads them: lines and
// columns (from 1) beside the offsets the editor works in.

/** The line and column (both from 1) of `offset` in `text`. */
export function positionOf(text: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: at - start + 1 };
}

/** Where line `line` (from 1) starts and ends in `text` (its line break
 *  left out), or null when the text has no such line. */
export function lineRange(text: string, line: number): { start: number; end: number } | null {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', start);
    if (next === -1) return null;
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  return { start, end: end === -1 ? text.length : end };
}

/** Every place `passage` occurs in `text`, exactly as written. */
export function occurrencesOf(text: string, passage: string): number[] {
  const found: number[] = [];
  if (passage === '') return found;
  for (let at = text.indexOf(passage); at !== -1; at = text.indexOf(passage, at + passage.length)) found.push(at);
  return found;
}

/** Most characters of a selection handed back in an answer. */
export const SELECTION_TEXT_LIMIT = 400;

/** A caret (`from` equal to `to`) or a selection in the text of chapter
 *  `chapter` (its position in the book), put into words: the caret's line
 *  and column, or where the selection runs and what it holds. */
export function describeRange(text: string, chapter: number, from: number, to: number): { caret: Record<string, unknown> } | { selection: Record<string, unknown> } {
  const a = Math.max(0, Math.min(from, to, text.length));
  const b = Math.max(0, Math.min(Math.max(from, to), text.length));
  const start = positionOf(text, a);
  if (a === b) return { caret: { chapter, offset: a, line: start.line, column: start.column } };
  const end = positionOf(text, b);
  const selected = text.slice(a, b);
  return {
    selection: {
      chapter,
      from: a,
      to: b,
      fromLine: start.line,
      fromColumn: start.column,
      toLine: end.line,
      toColumn: end.column,
      characters: b - a,
      text: selected.length > SELECTION_TEXT_LIMIT ? `${selected.slice(0, SELECTION_TEXT_LIMIT)}…` : selected,
    },
  };
}
