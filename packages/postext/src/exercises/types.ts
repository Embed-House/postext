/**
 * The model of an exercise (#1225): what the Markdown of a `:::exercise`
 * asks and answers, read once from the parsed blocks and shared by the
 * page layout, the solutions and the digital outputs.
 */

import type { DirectiveAttrs, ExerciseGap } from '../parse/index.js';
import type { Run } from './text.js';

export const EXERCISE_KINDS = [
  'choice', 'truefalse', 'gaps', 'match', 'order', 'scramble', 'sort', 'mark', 'open', 'wordsearch', 'crossword', 'arithmetic',
] as const;

/** What an exercise asks (`:::exercise{type=…}`). */
export type ExerciseKind = typeof EXERCISE_KINDS[number];

/** An option of a question (`- [x] Lisbon`). */
export interface ExerciseOption {
  /** The task item's block index. */
  block: number;
  correct: boolean;
}

/** A question of a `choice` exercise: its stem (a list item with the
 *  options under it) and its options; or a statement of a `truefalse`
 *  exercise (one option, ticked when true). */
export interface ExerciseQuestion {
  stem?: number;
  options: ExerciseOption[];
  /** More than one right option, or `select="many"`. */
  multiple: boolean;
}

/** A `[[…]]` of the exercise. */
export interface ExerciseGapRef {
  block: number;
  /** Index of the gap's span in the block's spans. */
  span: number;
  gap: ExerciseGap;
  /** 1-based, in Markdown order. */
  n: number;
}

/** A pair of a `match` exercise (`- Bee -> Hive`); `left` empty for a
 *  distractor of the right column (`- -> Cave`). */
export interface ExercisePair {
  block: number;
  left: Run;
  right: Run;
}

/** A category of a `sort` exercise (`- Mammals: dog, whale`). */
export interface ExerciseCategory {
  block: number;
  name: Run;
  items: Run[];
}

/** A word of a `wordsearch` (`- MERCURY`) or an entry of a `crossword`
 *  (`- SUN: The star of the solar system`). */
export interface ExerciseEntry {
  block: number;
  /** The word as written, its spaces and hyphens taken out. */
  word: string;
  clue?: Run;
}

/** An operation of an `arithmetic` exercise (`- 345 + 278`). */
export interface ExerciseOperation {
  block: number;
  a: string;
  b: string;
  op: '+' | '-' | '×' | '÷';
  /** The result in the digits written; a division's quotient. */
  result: string;
  /** A division's remainder, when not zero. */
  remainder?: string;
}

/** A sentence of a `scramble` exercise, cut into its pieces. */
export interface ExerciseSentence {
  block: number;
  pieces: Run[];
}

export type ExerciseIssueKind =
  | 'exerciseUnknownType'
  | 'exerciseNoAnswer'
  | 'exerciseUnreadItem'
  | 'exerciseNested'
  /** A word a crossword or a word search could not place (`detail`). */
  | 'exerciseWordUnplaced'
  | 'solutionOutside';

export interface ExerciseIssue {
  kind: ExerciseIssueKind;
  /** The exercise's container id (absent for a solution outside one). */
  exercise?: number;
  /** What was written (an unknown type, an item read as nothing). */
  detail?: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface ExerciseModel {
  /** The fence's container id. */
  id: number;
  /** 0-based, among the document's exercises. */
  ordinal: number;
  kind: ExerciseKind;
  attrs: DirectiveAttrs;
  /** Indices of the opening and closing markers. */
  start: number;
  end: number;
  /** The leading paragraphs. */
  instruction: number[];
  /** Every block between the markers that is not the instruction, a
   *  solution, a hint or a bank, in order. */
  body: number[];
  /** The blocks the kind reads as items (options, pairs, words…). */
  items: Set<number>;
  /** `:::solution` and `:::hint` ranges (marker indices). */
  solutions: Array<{ start: number; end: number }>;
  hints: Array<{ start: number; end: number }>;
  banks: number[];
  gaps: ExerciseGapRef[];
  questions: ExerciseQuestion[];
  pairs: ExercisePair[];
  /** `order`: the items' blocks in the right order. */
  sequence: number[];
  sentences: ExerciseSentence[];
  categories: ExerciseCategory[];
  entries: ExerciseEntry[];
  operations: ExerciseOperation[];
  sourceStart: number;
  sourceEnd: number;
}
