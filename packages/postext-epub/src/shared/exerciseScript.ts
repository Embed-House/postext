// Exercises in an EPUB (#1231): a content document that holds exercises
// carries their records (`<script type="application/json"
// class="pt-exercises">`) and links the engine's exercise script, which
// makes them answerable, checks them and keeps the answers. A reading
// system that runs no script shows the printed exercise and, beside each,
// its answer key in a `<details>` (`pt-ex-static`), which the script hides
// when it takes over.

import { EXERCISE_SCRIPT, exerciseDataJson, type ExerciseData, type ExerciseRecord } from 'postext';
import type { EpubItem } from '../types.js';
import { escapeAttr, escapeXml } from './xml.js';

/** The script's place, relative to the package document. */
export const EXERCISE_SCRIPT_HREF = 'scripts/exercises.js';

/** The script's manifest item. */
export function exerciseScriptItem(): EpubItem {
  return { id: 'pt-exercise-script', href: EXERCISE_SCRIPT_HREF, mediaType: 'application/javascript', data: EXERCISE_SCRIPT };
}

/** The records of a content document, as a data block. `storageKey` is
 *  what the answers are kept under: the book's, so an exercise whose box
 *  runs over two page files keeps one set of answers. */
export function exerciseDataScript(data: ExerciseData, storageKey: string): string {
  return `<script type="application/json" class="pt-exercises" data-storage-key="${escapeAttr(storageKey)}">${exerciseDataJson(data)}</script>`;
}

/** `xhtml` with the exercise script linked at the end of its head when it
 *  holds exercise records. */
export function withExerciseScript(xhtml: string, src: string): string {
  if (!xhtml.includes('class="pt-exercises"')) return xhtml;
  const at = xhtml.indexOf('</head>');
  return at < 0 ? xhtml : `${xhtml.slice(0, at)}<script src="${escapeAttr(src)}"></script>\n${xhtml.slice(at)}`;
}

/** An exercise's answer key for a reader with no script: its key line
 *  and worked solution, under the words of the bar. `attrs` places it. */
export function staticKeyHtml(record: ExerciseRecord, summary: string, attrs = ''): string {
  const lines = [record.key, ...(record.solution ?? [])].filter((t) => t && t.trim() !== '');
  if (lines.length === 0) return '';
  return `<details class="pt-ex-static" data-pt-ex="${record.id}"${attrs}><summary>${escapeXml(summary)}</summary>` +
    lines.map((t) => `<p>${escapeXml(t)}</p>`).join('') +
    `</details>`;
}
