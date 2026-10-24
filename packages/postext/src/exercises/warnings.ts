/**
 * What the Markdown of a document's exercises says that the engine cannot
 * read (#1225), as content warnings: an unknown kind or style, a graded
 * exercise with no right answer, an item its kind cannot read, a word a
 * grid cannot place, a solution outside an exercise.
 */

import type { ContentBlock } from '../parse/index.js';
import type { PostextConfig } from '../types.js';
import type { ContentWarning } from '../vdt.js';
import { exerciseSettingsOf } from '../defaults/exercises.js';
import { readExercises } from './model.js';
import { gridBox } from './grids.js';

type Located<T> = T & { sourceStart: number; sourceEnd: number };

export function exerciseContentWarnings(blocks: readonly ContentBlock[], config: PostextConfig | undefined): Located<ContentWarning>[] {
  const { exercises, issues } = readExercises(blocks);
  const out: Located<ContentWarning>[] = [];
  const at = (i: { sourceStart: number; sourceEnd: number }) => ({ sourceStart: i.sourceStart, sourceEnd: i.sourceEnd });
  for (const i of issues) {
    switch (i.kind) {
      case 'exerciseUnknownType': out.push({ kind: 'exerciseUnknownType', type: i.detail ?? '', ...at(i) }); break;
      case 'exerciseNoAnswer': {
        const ex = exercises.find((e) => e.id === i.exercise);
        out.push({ kind: 'exerciseNoAnswer', exerciseKind: ex?.kind ?? '', ...at(i) });
        break;
      }
      case 'exerciseUnreadItem': out.push({ kind: 'exerciseUnreadItem', text: i.detail ?? '', ...at(i) }); break;
      case 'exerciseNested': out.push({ kind: 'exerciseNested', ...at(i) }); break;
      case 'solutionOutside': out.push({ kind: 'solutionOutside', ...at(i) }); break;
      case 'exerciseWordUnplaced': out.push({ kind: 'exerciseWordUnplaced', word: i.detail ?? '', ...at(i) }); break;
    }
  }
  const settings = exerciseSettingsOf(config, config?.locale);
  const styles = new Set((config?.exerciseStyles ?? []).map((s) => s.id));
  for (const ex of exercises) {
    if (config?.exerciseStyles && ex.attrs.style !== undefined && !styles.has(ex.attrs.style)) {
      out.push({ kind: 'exerciseUnknownStyle', style: ex.attrs.style, sourceStart: ex.sourceStart, sourceEnd: ex.sourceStart });
    }
    // A grid places its words whatever the page: generated here with the
    // first style, words that do not fit reported.
    if (ex.kind === 'crossword' || ex.kind === 'wordsearch') {
      const box = gridBox({ kind: ex.kind, id: 'check', style: settings.styles[0]!, exercise: ex, blocks, seed: settings.exercises.seed, bodySizePt: 10, lineHeightPt: 12, measurePt: 1e6 });
      for (const word of box.unplaced ?? []) out.push({ kind: 'exerciseWordUnplaced', word, sourceStart: ex.sourceStart, sourceEnd: ex.sourceEnd });
    }
  }
  return out;
}
