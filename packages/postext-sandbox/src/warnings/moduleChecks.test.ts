import { describe, expect, it } from 'vitest';
import { collectContentWarnings } from 'postext';
import { DEFAULT_LABELS } from '../types/index.js';
import { detailFor, titleFor } from '../sidebar/WarningsPanel.js';
import { isComposedCheckKind } from './composedChecks.js';
import type { WarningPayload } from './types.js';

// The checks of modules (#1062) in the Checks panel (#1065): composed
// checks with a title and a detail in the panel's words.

const CONFIG = {
  pageTemplates: [
    { id: 'tema', frames: [{ name: 'texto', flow: true }], groups: [{ name: 'cuerpo', modules: true }] },
    { id: 'nota', role: 'module', frames: [{ name: 'cuerpo-nota' }] },
    { id: 'suelta', frames: [{ name: 'texto', flow: true }] },
  ],
} as never;

const MD = [
  '::::page{template="tema"}',
  ':::module{template="nada"}',
  'Words.',
  ':::',
  ':::module{template="nota" name="a"}',
  ':::',
  ':::module{template="nota" name="a"}',
  ':::',
  '::::',
  '',
  '::::page{template="nota"}',
  'More words.',
  '::::',
  '',
].join('\n');

describe('module checks in the Checks panel (#1065)', () => {
  const found = collectContentWarnings(MD, CONFIG, []).filter((w) => w.kind.startsWith('module')) as unknown as WarningPayload[];

  it('are composed checks with their own titles and details', () => {
    expect(found.map((w) => w.kind).sort()).toEqual(['moduleAsPage', 'moduleNameRejected', 'moduleUnknown']);
    for (const w of found) {
      expect(isComposedCheckKind(w.kind)).toBe(true);
      expect(titleFor(w, DEFAULT_LABELS)).not.toBe(w.kind);
      expect(detailFor(w, DEFAULT_LABELS, 'en')).not.toMatch(/__\w+__/);
    }
    const unknown = found.find((w) => w.kind === 'moduleUnknown')!;
    expect(detailFor(unknown, DEFAULT_LABELS, 'en')).toContain('"nada"');
    const renamed = found.find((w) => w.kind === 'moduleNameRejected')!;
    expect(detailFor(renamed, DEFAULT_LABELS, 'en')).toMatch(/named "a": this one is named "nota\[\d\]"/);
  });

  it('word each reason', () => {
    const p = (reason: 'notModule' | 'noGroup'): WarningPayload => ({ kind: 'moduleUnknown', template: 'suelta', module: 'tema', name: 'tema[1]', reason, fenceIndex: 0 });
    expect(detailFor(p('notModule'), DEFAULT_LABELS, 'en')).toContain('Template "tema" is not a module');
    expect(detailFor(p('noGroup'), DEFAULT_LABELS, 'en')).toContain('Template "suelta" has no group that takes modules');
    expect(detailFor({ kind: 'moduleNested', template: 'tema', module: 'nota', fenceIndex: 0 }, DEFAULT_LABELS, 'en')).toContain('Module "nota" is written inside another module');
  });
});
