import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { computeWarnings } from './compute.js';
import { warningCategory } from './categories.js';
import { detailFor, titleFor } from '../sidebar/WarningsPanel.js';
import { DEFAULT_LABELS } from '../types/defaultLabels.js';

// #1225: what the engine cannot read in an exercise is a row of the checks,
// read from the source like the other markup warnings, at the fence or item.

const warnings = (markdown: string, config: PostextConfig = {}) => computeWarnings({ markdown, config, doc: null });

describe('exercise checks', () => {
  it('lists an unknown kind, an exercise with no answer and a stray solution, each titled', () => {
    const md = [
      ':::exercise{type="riddle"}', 'What is it?', ':::', '',
      ':::exercise{type="choice"}', 'Pick one.', '', '- [ ] Lisbon', '- [ ] Madrid', ':::', '',
      ':::solution', 'Loose.', ':::', '',
    ].join('\n');
    const found = warnings(md).filter((w) => w.payload.kind.startsWith('exercise') || w.payload.kind === 'solutionOutside');
    expect(found.map((w) => w.payload.kind).sort()).toEqual(['exerciseNoAnswer', 'exerciseUnknownType', 'solutionOutside']);
    for (const w of found) {
      expect(warningCategory(w.payload.kind)).toBe('markup');
      expect(titleFor(w.payload, DEFAULT_LABELS).length).toBeGreaterThan(0);
      expect(detailFor(w.payload, DEFAULT_LABELS).length).toBeGreaterThan(0);
      expect(w.line).toBeGreaterThan(0);
    }
    const unknown = found.find((w) => w.payload.kind === 'exerciseUnknownType')!;
    expect(detailFor(unknown.payload, DEFAULT_LABELS)).toContain(':::exercise{type="riddle"}');
  });

  it('names an unknown style only once exercise styles are configured', () => {
    const md = ':::exercise{style="quiz"}\nThe roots take in [[water]].\n:::\n';
    expect(warnings(md).map((w) => w.payload.kind)).not.toContain('exerciseUnknownStyle');
    const found = warnings(md, { exerciseStyles: [{ id: 'ejercicio' }] }).filter((w) => w.payload.kind === 'exerciseUnknownStyle');
    expect(found).toHaveLength(1);
    expect(detailFor(found[0]!.payload, DEFAULT_LABELS)).toContain('style="quiz"');
  });
});
