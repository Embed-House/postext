/**
 * Reading the exercises of a document (#1225): each `:::exercise` fence's
 * blocks read into an {@link ExerciseModel} — its kind (written or told by
 * its content), instruction, items, answers, solutions and hints. Pure: the
 * blocks are not changed.
 */

import type { ContentBlock } from '../parse/index.js';
import { EXERCISE_KINDS, type ExerciseCategory, type ExerciseEntry, type ExerciseIssue, type ExerciseKind, type ExerciseModel, type ExerciseOperation, type ExerciseQuestion } from './types.js';
import { runOf, sliceRun, splitRun, trimRun, type Run } from './text.js';

/** Whether the blocks hold an exercise. */
export function hasExercises(blocks: readonly ContentBlock[]): boolean {
  return blocks.some((b) => b.type === 'containerStart' && b.containerName === 'exercise');
}

/** The index of the marker closing the container opened at `start`. */
export function containerEndOf(blocks: readonly ContentBlock[], start: number): number {
  const id = blocks[start]!.containerId;
  for (let k = start + 1; k < blocks.length; k++) {
    const b = blocks[k]!;
    if (b.type === 'containerEnd' && b.containerId === id) return k;
  }
  return blocks.length - 1;
}

/** The pair separator of a `match` item: ` -> `, `→`, `⟶`. */
export const PAIR_RE = /\s*(?:->|→|⟶)\s*/;
/** What separates the items of a `sort` category. */
const CATEGORY_ITEM_RE = /\s*[,;、，；،؛]\s*/;
/** The colon after a category or a crossword word. */
const COLON_RE = /\s*[:：]\s*/;

/** The kinds a fence may name, with a few spellings authors reach for. */
const KIND_ALIASES: Record<string, ExerciseKind> = {
  multiplechoice: 'choice', mcq: 'choice', quiz: 'choice', test: 'choice',
  tf: 'truefalse', 'true-false': 'truefalse', truefalse: 'truefalse',
  cloze: 'gaps', gap: 'gaps', blanks: 'gaps', fill: 'gaps',
  matching: 'match', pairs: 'match', ordering: 'order', sequence: 'order',
  sorting: 'sort', classify: 'sort', categories: 'sort',
  free: 'open', essay: 'open', answer: 'open', 'word-search': 'wordsearch', 'crossword-puzzle': 'crossword',
  operations: 'arithmetic', column: 'arithmetic', vertical: 'arithmetic',
};

export function exerciseKindOf(type: string | undefined): ExerciseKind | undefined {
  if (type === undefined) return undefined;
  const t = type.trim().toLowerCase();
  if ((EXERCISE_KINDS as readonly string[]).includes(t)) return t as ExerciseKind;
  return KIND_ALIASES[t];
}

const isListItem = (b: ContentBlock): boolean => b.type === 'listItem';
const isTask = (b: ContentBlock): boolean => b.type === 'listItem' && b.listKind === 'task';

/** The kind the content tells when the fence names none. */
function inferredKind(blocks: readonly ContentBlock[], body: number[], gaps: number): ExerciseKind {
  if (body.some((k) => isTask(blocks[k]!))) return 'choice';
  if (body.some((k) => isListItem(blocks[k]!) && PAIR_RE.test(blocks[k]!.text))) return 'match';
  if (gaps > 0) return 'gaps';
  return 'open';
}

/** The digits of `n` in the script `like` is written in (Arabic-Indic and
 *  Persian digits kept). */
function digitsLike(n: string, like: string): string {
  if (/[٠-٩]/.test(like)) return n.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  if (/[۰-۹]/.test(like)) return n.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  return n;
}

const ascii = (s: string): string => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const OPERATION_RE = /^\s*(\d+)\s*([+\-−×xX*·⋅÷:/])\s*(\d+)\s*(?:=\s*)?$/u;

/** An operation item (`345 + 278`), its result worked out: whole numbers. */
export function readOperation(text: string, block: number): ExerciseOperation | undefined {
  const m = OPERATION_RE.exec(ascii(text));
  if (!m) return undefined;
  const [a, b] = [m[1]!, m[3]!];
  const sign = m[2]!;
  const op: ExerciseOperation['op'] = sign === '+' ? '+' : sign === '-' || sign === '−' ? '-' : sign === '÷' || sign === ':' || sign === '/' ? '÷' : '×';
  const x = BigInt(a);
  const y = BigInt(b);
  let result: bigint;
  let remainder: bigint | undefined;
  if (op === '+') result = x + y;
  else if (op === '-') result = x - y;
  else if (op === '×') result = x * y;
  else {
    if (y === 0n) return undefined;
    result = x / y;
    remainder = x % y;
  }
  const raw = text.trim();
  return {
    block,
    a: digitsLike(a, raw),
    b: digitsLike(b, raw),
    op,
    result: digitsLike(result.toString(), raw),
    ...(remainder !== undefined && remainder !== 0n ? { remainder: digitsLike(remainder.toString(), raw) } : {}),
  };
}

/** Read every exercise of `blocks`, in order. A `:::solution` or `:::hint`
 *  outside an exercise, and an exercise inside another, are reported. */
export function readExercises(blocks: readonly ContentBlock[]): { exercises: ExerciseModel[]; issues: ExerciseIssue[] } {
  const exercises: ExerciseModel[] = [];
  const issues: ExerciseIssue[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'containerStart') continue;
    if (b.containerName === 'solution' || b.containerName === 'hint') {
      issues.push({ kind: 'solutionOutside', sourceStart: b.sourceStart, sourceEnd: b.sourceEnd });
      continue;
    }
    if (b.containerName !== 'exercise') continue;
    const end = containerEndOf(blocks, i);
    exercises.push(readExercise(blocks, i, end, exercises.length, issues));
    i = end;
  }
  return { exercises, issues };
}

function readExercise(blocks: readonly ContentBlock[], start: number, end: number, ordinal: number, issues: ExerciseIssue[]): ExerciseModel {
  const open = blocks[start]!;
  const attrs = open.containerAttrs ?? {};
  const id = open.containerId!;
  const solutions: ExerciseModel['solutions'] = [];
  const hints: ExerciseModel['hints'] = [];
  const banks: number[] = [];
  const instruction: number[] = [];
  const body: number[] = [];
  let leading = true;
  for (let k = start + 1; k < end; k++) {
    const b = blocks[k]!;
    if (b.type === 'containerStart' && (b.containerName === 'solution' || b.containerName === 'hint')) {
      const close = containerEndOf(blocks, k);
      (b.containerName === 'solution' ? solutions : hints).push({ start: k, end: close });
      k = close;
      continue;
    }
    if (b.type === 'containerStart' && b.containerName === 'exercise') {
      issues.push({ kind: 'exerciseNested', exercise: id, sourceStart: b.sourceStart, sourceEnd: b.sourceEnd });
      const close = containerEndOf(blocks, k);
      for (let j = k + 1; j < close; j++) body.push(j);
      k = close;
      leading = false;
      continue;
    }
    if (b.type === 'directive' && b.directiveName === 'bank') {
      banks.push(k);
      leading = false;
      continue;
    }
    const gapless = !b.spans.some((s) => s.chip?.gap);
    if (leading && b.type === 'paragraph' && gapless) {
      instruction.push(k);
      continue;
    }
    leading = false;
    body.push(k);
  }

  const gaps: ExerciseModel['gaps'] = [];
  for (const k of body) {
    blocks[k]!.spans.forEach((s, span) => {
      if (s.chip?.gap) gaps.push({ block: k, span, gap: s.chip.gap, n: gaps.length + 1 });
    });
  }

  const written = exerciseKindOf(attrs.type);
  if (attrs.type !== undefined && !written) {
    issues.push({ kind: 'exerciseUnknownType', exercise: id, detail: attrs.type, sourceStart: open.sourceStart, sourceEnd: open.sourceEnd });
  }
  const kind = written ?? inferredKind(blocks, body, gaps.length);
  const model: ExerciseModel = {
    id, ordinal, kind, attrs, start, end, instruction, body, items: new Set(), solutions, hints, banks, gaps,
    questions: [], pairs: [], sequence: [], sentences: [], categories: [], entries: [], operations: [],
    sourceStart: open.sourceStart, sourceEnd: blocks[end]!.sourceEnd,
  };
  readItems(blocks, model, issues);
  if (gradedWithoutAnswer(model)) {
    issues.push({ kind: 'exerciseNoAnswer', exercise: id, sourceStart: open.sourceStart, sourceEnd: open.sourceEnd });
  }
  return model;
}

/** A graded exercise with nothing to grade: no right option, no gap, no
 *  pair… */
function gradedWithoutAnswer(m: ExerciseModel): boolean {
  switch (m.kind) {
    case 'choice': return m.questions.length === 0 ? m.gaps.length === 0 : m.questions.some((q) => !q.options.some((o) => o.correct));
    case 'truefalse': return m.questions.length === 0;
    case 'gaps': case 'mark': return m.gaps.length === 0;
    case 'match': return !m.pairs.some((p) => p.left.text !== '');
    case 'order': return m.sequence.length < 2;
    case 'scramble': return m.sentences.length === 0;
    case 'sort': return m.categories.length === 0;
    case 'wordsearch': case 'crossword': return m.entries.length === 0;
    case 'arithmetic': return m.operations.length === 0;
    case 'open': return false;
  }
}

/** The text of a list item after its marker (the parser keeps only the
 *  item's own text). */
const itemRun = (b: ContentBlock): Run => trimRun(runOf(b));

function readItems(blocks: readonly ContentBlock[], m: ExerciseModel, issues: ExerciseIssue[]): void {
  const select = m.attrs.select?.trim().toLowerCase();
  const unread = (k: number): void => {
    const b = blocks[k]!;
    issues.push({ kind: 'exerciseUnreadItem', exercise: m.id, detail: b.text, sourceStart: b.sourceStart, sourceEnd: b.sourceEnd });
  };
  switch (m.kind) {
    case 'choice': {
      let current: ExerciseQuestion | undefined;
      let currentDepth = -1;
      for (let j = 0; j < m.body.length; j++) {
        const k = m.body[j]!;
        const b = blocks[k]!;
        if (isTask(b)) {
          const depth = b.depth ?? 0;
          if (!current || depth !== currentDepth) {
            // A list item right before at the depth above is the stem.
            const prev = j > 0 ? blocks[m.body[j - 1]!]! : undefined;
            const stem = prev && isListItem(prev) && !isTask(prev) && (prev.depth ?? 0) === depth - 1 ? m.body[j - 1] : undefined;
            current = { ...(stem !== undefined ? { stem } : {}), options: [], multiple: false };
            currentDepth = depth;
            m.questions.push(current);
          }
          current.options.push({ block: k, correct: b.checked === true });
          m.items.add(k);
          continue;
        }
        if (isListItem(b) && (b.depth ?? 0) < currentDepth) { current = undefined; currentDepth = -1; }
        else if (!isListItem(b)) { current = undefined; currentDepth = -1; }
      }
      for (const q of m.questions) {
        if (q.stem !== undefined) m.items.add(q.stem);
        const right = q.options.filter((o) => o.correct).length;
        q.multiple = select === 'many' || select === 'multiple' || (select !== 'one' && select !== 'single' && right > 1);
      }
      return;
    }
    case 'truefalse':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isTask(b)) continue;
        m.questions.push({ options: [{ block: k, correct: b.checked === true }], multiple: false });
        m.items.add(k);
      }
      return;
    case 'match':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isListItem(b)) continue;
        const run = itemRun(b);
        const at = PAIR_RE.exec(run.text);
        if (!at) { unread(k); continue; }
        m.pairs.push({ block: k, left: trimRun(sliceRun(run, 0, at.index)), right: trimRun(sliceRun(run, at.index + at[0].length)) });
        m.items.add(k);
      }
      return;
    case 'order': {
      // The items of the list's top level (depth 1).
      const top = Math.min(...m.body.filter((k) => isListItem(blocks[k]!)).map((k) => blocks[k]!.depth ?? 1));
      const lists = m.body.filter((k) => isListItem(blocks[k]!) && (blocks[k]!.depth ?? 1) === top);
      m.sequence.push(...lists);
      lists.forEach((k) => m.items.add(k));
      return;
    }
    case 'scramble':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isListItem(b)) continue;
        const run = itemRun(b);
        const pieces = /\s\/\s|\//.test(run.text) ? splitRun(run, /\s*\/\s*/) : splitRun(run, /\s+/);
        m.sentences.push({ block: k, pieces: pieces.filter((p) => p.text !== '') });
        m.items.add(k);
      }
      return;
    case 'sort':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isListItem(b)) continue;
        const run = itemRun(b);
        const at = COLON_RE.exec(run.text);
        if (!at) { unread(k); continue; }
        const cat: ExerciseCategory = {
          block: k,
          name: trimRun(sliceRun(run, 0, at.index)),
          items: splitRun(sliceRun(run, at.index + at[0].length), CATEGORY_ITEM_RE).filter((r) => r.text !== ''),
        };
        m.categories.push(cat);
        m.items.add(k);
      }
      return;
    case 'wordsearch': case 'crossword':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isListItem(b)) continue;
        const run = itemRun(b);
        const at = COLON_RE.exec(run.text);
        const word = (at ? run.text.slice(0, at.index) : run.text).replace(/[\s\-‐]+/gu, '');
        if (!word) { unread(k); continue; }
        const entry: ExerciseEntry = { block: k, word, ...(at ? { clue: trimRun(sliceRun(run, at.index + at[0].length)) } : {}) };
        m.entries.push(entry);
        m.items.add(k);
      }
      return;
    case 'arithmetic':
      for (const k of m.body) {
        const b = blocks[k]!;
        if (!isListItem(b)) continue;
        const op = readOperation(b.text, k);
        if (!op) { unread(k); continue; }
        m.operations.push(op);
        m.items.add(k);
      }
      return;
    case 'gaps': case 'mark': case 'open':
      return;
  }
}
