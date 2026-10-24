/**
 * What names a box style or an exercise style among the exercises (#1244):
 * an exercise style's `box`, `bank.box` and `solutions.box` and the book's
 * `exercises.solutions.box` name box styles; a `:::exercise{style=…}`
 * fence names an exercise style. A rename (or a merge) of either rewrites
 * them, as it rewrites the `:::callout` fences and the template frames.
 */

import type { ExerciseStyleConfig, ExercisesConfig, PostextConfig } from 'postext';
import type { Dispatch } from 'react';
import type { SandboxAction } from '../context/SandboxContext.js';
import { applyViewerEdit } from '../editor/viewerEdits.js';
import { restyleExerciseChanges } from './calloutFences.js';
import type { ChapterRewrite } from './styleMerge.js';
import type { UsageChapter } from './styleUsage.js';

/** The exercise settings with every box style that is a key of `renames`
 *  named by its value; the same objects when none is. */
export function reboxExercises(
  config: Pick<PostextConfig, 'exerciseStyles' | 'exercises'>,
  renames: ReadonlyMap<string, string>,
): { exerciseStyles: ExerciseStyleConfig[] | undefined; exercises: ExercisesConfig | undefined } {
  const to = (id: string | undefined): string | undefined => (id !== undefined && renames.has(id) ? renames.get(id)! : id);
  let stylesChanged = false;
  const exerciseStyles = config.exerciseStyles?.map((s) => {
    const box = to(s.box);
    const bank = to(s.bank?.box);
    const solution = to(s.solutions?.box);
    if (box === s.box && bank === s.bank?.box && solution === s.solutions?.box) return s;
    stylesChanged = true;
    return {
      ...s,
      ...(box !== undefined ? { box } : {}),
      ...(s.bank ? { bank: { ...s.bank, ...(bank !== undefined ? { box: bank } : {}) } } : {}),
      ...(s.solutions ? { solutions: { ...s.solutions, ...(solution !== undefined ? { box: solution } : {}) } } : {}),
    };
  });
  const bookBox = to(config.exercises?.solutions?.box);
  const exercises = config.exercises?.solutions && bookBox !== config.exercises.solutions.box
    ? { ...config.exercises, solutions: { ...config.exercises.solutions, box: bookBox } }
    : config.exercises;
  return { exerciseStyles: stylesChanged ? exerciseStyles : config.exerciseStyles, exercises };
}

/** What renaming exercise style `from` to `to` changes in the book: the
 *  style (and a style based on it) and every fence that names it. */
export interface ExerciseStyleRenamePlan {
  exerciseStyles: ExerciseStyleConfig[];
  chapters: ChapterRewrite[];
  fenceCount: number;
}

export function planExerciseStyleRename(styles: readonly ExerciseStyleConfig[], chapters: readonly UsageChapter[], from: string, to: string): ExerciseStyleRenamePlan {
  const renames = new Map([[from, to]]);
  const rewrites: ChapterRewrite[] = [];
  chapters.forEach((ch, chapterIndex) => {
    const changes = restyleExerciseChanges(ch.markdown, renames);
    if (changes.length > 0) rewrites.push({ chapterId: ch.id, chapterIndex, changes, baseLength: ch.markdown.length });
  });
  return {
    exerciseStyles: styles.map((s) => {
      const next = s.id === from ? { ...s, id: to } : s;
      return next.extends === from ? { ...next, extends: to } : next;
    }),
    chapters: rewrites,
    fenceCount: rewrites.reduce((n, c) => n + c.changes.length, 0),
  };
}

/** Write `plan`: the fences of each chapter (the one in the editor through
 *  the editor), then the styles as one design step. The steps it added. */
export function applyExerciseStyleRename(dispatch: Dispatch<SandboxAction>, plan: ExerciseStyleRenamePlan, activeChapterId?: string): number {
  for (const c of plan.chapters) {
    if (c.chapterId === activeChapterId) applyViewerEdit(dispatch, c.chapterId, c.changes, c.baseLength);
    else dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: c.chapterId, changes: c.changes, baseLength: c.baseLength } });
  }
  dispatch({ type: 'UPDATE_CONFIG', payload: { exerciseStyles: plan.exerciseStyles.length > 0 ? plan.exerciseStyles : undefined }, history: { merge: false } });
  return plan.chapters.length + 1;
}
