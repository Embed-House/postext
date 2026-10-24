import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { createMeasurementCache } from '../../measure/index.js';
import { renderToHtml, renderToHtmlIndexed } from '../../html-backend.js';
import type { VDTDocument } from '../../vdt.js';
import type { PostextConfig } from '../../types.js';
import type { ExerciseData } from '../../exercises/digital.js';
import type { ExerciseSlot } from '../../exercises/record.js';
import { checkExerciseSlot, exerciseSolutionValue, EXERCISE_SCRIPT, isGradedSlot, normalizeAnswer } from '../../exercises/runtime.js';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const base: PostextConfig = {
  headings: { balancing: { enabled: false } },
  page: { width: mm(148), height: mm(210), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } },
  layout: { layoutType: 'single' },
};
const build = (md: string, cfg: PostextConfig = base): VDTDocument => buildDocument({ markdown: md }, cfg, createMeasurementCache());

const dataOf = (html: string): ExerciseData => {
  const m = /<script type="application\/json" class="pt-exercises">([\s\S]*?)<\/script>/.exec(html);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!) as ExerciseData;
};

describe('exercises in the HTML output (#1230)', () => {
  const md = [
    '# Plants', '',
    ':::exercise', 'Complete.', '', '1. The roots take in [[water]].', '2. The leaves make [[food | Food]].', ':::', '',
    ':::exercise{type=crossword}', 'Solve.', '', '- SUN: Our star', '- MOON: It orbits the Earth', '- NEST: A home for birds', ':::', '',
  ].join('\n');

  it('marks the boxes and writes the records once, with the words and colours', () => {
    const doc = build(md);
    const html = renderToHtml(doc);
    const data = dataOf(html);
    expect(data.exercises.map((e) => e.kind)).toEqual(['gaps', 'crossword']);
    expect(data.words.check).toBe('Check');
    expect(data.check).toBe('button');
    expect(data.pxPerPt).toBeCloseTo(doc.config.page.dpi / 72);
    expect(data.styles[data.exercises[0]!.style]!.correct).toMatch(/^#/);
    // The outer box of each exercise, and the crossword's grid.
    for (const e of data.exercises) expect(html).toContain(`data-pt-box="${e.id}" data-pt-ex="${e.id}" data-pt-exercise="${e.id}"`);
    const grid = data.exercises[1]!.grids![0]!;
    expect(html).toContain(`data-pt-box="${grid.box}" data-pt-ex="${data.exercises[1]!.id}" style="position:absolute;`);
    expect(html.match(/class="pt-exercises"/g)).toHaveLength(1);
    // The answers are in the JSON only, never in the page's text.
    const page = html.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(page).not.toContain('water');
    expect(page).toContain('data-pt-slot="g1"');
  });

  it('gives a patching host the data, and leaves a document without exercises alone', () => {
    const indexed = renderToHtmlIndexed(build(md));
    expect(indexed.exercises?.exercises).toHaveLength(2);
    const plain = renderToHtmlIndexed(build('# Plain\n\nNo exercises here.\n'));
    expect(plain.exercises).toBeUndefined();
    expect(plain.html).not.toContain('pt-exercises');
    expect(plain.html).not.toContain('pt-ex-box');
  });

  it('writes nothing for exercises that are not answerable', () => {
    const html = renderToHtml(build(md, { ...base, exercises: { digital: { interactive: false } } }));
    expect(html).not.toContain('pt-exercises');
    expect(html).not.toContain('pt-ex-box');
  });

  it('keeps the JSON inside its script element', () => {
    const doc = build(':::exercise\nType [[</script><b>x]].\n:::\n');
    const html = renderToHtml(doc);
    expect(dataOf(html).exercises[0]!.slots[0]!.accept).toEqual(['</script><b>x']);
  });
});

describe('the exercise script (#1230)', () => {
  const slot = (s: Partial<ExerciseSlot>): ExerciseSlot => ({ key: 'g1', kind: 'gap', ...s });
  const gaps = { kind: 'gaps' as const };

  it('normalises answers', () => {
    expect(normalizeAnswer('  Las   plantas necesitan agua. ')).toBe('las plantas necesitan agua');
    expect(normalizeAnswer('¿Qué?')).toBe('qué');
    expect(normalizeAnswer('ＡＢＣ１２')).toBe('abc12');
    expect(normalizeAnswer('٣٤')).toBe('34');
    expect(normalizeAnswer('it’s')).toBe("it's");
    expect(normalizeAnswer('答案。')).toBe('答案');
  });

  it('checks blanks, order numbers, cells and areas', () => {
    expect(checkExerciseSlot(slot({ accept: ['colour', 'color'] }), 'Color', gaps)).toBe(true);
    expect(checkExerciseSlot(slot({ accept: ['colour'] }), 'red', gaps)).toBe(false);
    expect(checkExerciseSlot(slot({ accept: ['colour'] }), '  ', gaps)).toBeNull();
    expect(checkExerciseSlot(slot({ kind: 'rank', accept: ['3'] }), '03', { kind: 'order' })).toBe(true);
    expect(checkExerciseSlot(slot({ kind: 'rank', accept: ['3'] }), '٣', { kind: 'order' })).toBe(true);
    expect(checkExerciseSlot(slot({ kind: 'cell', accept: ['A'] }), 'a', { kind: 'crossword' })).toBe(true);
    const sentence = slot({ kind: 'text', accept: ['Las plantas necesitan agua'] });
    expect(checkExerciseSlot(sentence, 'las plantas  necesitan agua.', { kind: 'scramble' })).toBe(true);
    // An open question is only shown its model; a sort column is filled.
    expect(isGradedSlot(slot({ kind: 'text', accept: ['Because…'] }), { kind: 'open' })).toBe(false);
    expect(checkExerciseSlot(slot({ kind: 'text', accept: ['x'] }), 'x', { kind: 'open' })).toBeNull();
    expect(isGradedSlot(slot({ kind: 'text', accept: ['dog'] }), { kind: 'sort' })).toBe(false);
  });

  it('checks options, true/false, marks, pairs, categories and words found', () => {
    const one = slot({ key: 'q1', kind: 'choice', options: 3, correct: [2] });
    expect(checkExerciseSlot(one, [2], { kind: 'choice' })).toBe(true);
    expect(checkExerciseSlot(one, [1], { kind: 'choice' })).toBe(false);
    expect(checkExerciseSlot(one, [], { kind: 'choice' })).toBeNull();
    const many = slot({ key: 'q2', kind: 'choice', options: 4, correct: [1, 3], multiple: true });
    expect(checkExerciseSlot(many, [3, 1], { kind: 'choice' })).toBe(true);
    expect(checkExerciseSlot(many, [1], { kind: 'choice' })).toBe(false);
    const tf = slot({ key: 'tf1', kind: 'truefalse', correct: [2] });
    expect(checkExerciseSlot(tf, 2, { kind: 'truefalse' })).toBe(true);
    expect(checkExerciseSlot(tf, 1, { kind: 'truefalse' })).toBe(false);
    expect(checkExerciseSlot(tf, 'f', { kind: 'truefalse' }, ['V', 'F'])).toBe(true);
    expect(checkExerciseSlot(tf, '×', { kind: 'truefalse' }, ['√', '×'])).toBe(true);
    expect(checkExerciseSlot(slot({ key: 'm1', kind: 'mark', correct: [1] }), true, { kind: 'mark' })).toBe(true);
    expect(checkExerciseSlot(slot({ key: 'm1', kind: 'mark', correct: [1] }), null, { kind: 'mark' })).toBeNull();
    const pair = slot({ key: 'p1', kind: 'pair', correct: [3], accept: ['c'] });
    expect(checkExerciseSlot(pair, 3, { kind: 'match' })).toBe(true);
    expect(checkExerciseSlot(pair, 2, { kind: 'match' })).toBe(false);
    expect(checkExerciseSlot(pair, 'C', { kind: 'match' })).toBe(true);
    expect(checkExerciseSlot(pair, '3', { kind: 'match' })).toBe(true);
    expect(checkExerciseSlot(slot({ key: 's1', kind: 'category', accept: ['Raíz'] }), 'raíz', { kind: 'sort' })).toBe(true);
    const word = slot({ key: 'w1', kind: 'word', accept: ['0,0-0,2', '0,2-0,0'] });
    expect(checkExerciseSlot(word, ['1,1-1,3', '0,2-0,0'], { kind: 'wordsearch' })).toBe(true);
    expect(checkExerciseSlot(word, ['1,1-1,3'], { kind: 'wordsearch' })).toBeNull();
  });

  it('shows each slot\'s solution', () => {
    expect(exerciseSolutionValue(slot({ accept: ['water'] }), gaps)).toBe('water');
    expect(exerciseSolutionValue(slot({ kind: 'choice', correct: [1, 3] }), { kind: 'choice' })).toEqual([1, 3]);
    expect(exerciseSolutionValue(slot({ kind: 'pair', correct: [2] }), { kind: 'match' })).toBe(2);
    expect(exerciseSolutionValue(slot({ kind: 'text', accept: ['dog', 'cat'] }), { kind: 'sort' })).toBe('dog\ncat');
  });

  it('runs on its own as a script', () => {
    expect(EXERCISE_SCRIPT).not.toMatch(/<\/script/i);
    // A document with nothing to attach to: the script must reach no name
    // outside its own source (a module import would throw here).
    const style: { textContent: string; attrs: Record<string, string> } = { textContent: '', attrs: {} };
    const head = { appended: [] as unknown[], querySelector: () => null, appendChild(e: unknown) { this.appended.push(e); } };
    const fakeDocument = {
      nodeType: 9,
      readyState: 'complete',
      head,
      createElement: () => ({ ...style, setAttribute(k: string, v: string) { style.attrs[k] = v; } }),
      querySelectorAll: () => [],
    };
    new Function('document', 'location', 'window', EXERCISE_SCRIPT)(fakeDocument, { pathname: '/book.html' }, {});
    expect(head.appended).toHaveLength(1);
  });
});
