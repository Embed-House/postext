import { describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { computeWarnings } from './compute.js';
import { warningCategory } from './categories.js';
import { DEFAULT_LABELS } from '../types/defaultLabels.js';

// #1150: a word wider than its whole line, cut to fit between two letters
// or at a syllable, is listed in the Checks panel beside the words that run
// past their line.

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

const pt = (value: number) => ({ value, unit: 'pt' as const });

describe('wordDivided in the Checks panel (#1150)', () => {
  it('lists a word cut between two letters', () => {
    const markdown = 'Xqzvbnmkwplrtgh';
    const config = { page: { dpi: 72, width: pt(60), margins: { top: pt(10), bottom: pt(10), left: pt(10), right: pt(10) } }, layout: { layoutType: 'single' }, bodyText: { firstLineIndent: pt(0) }, header: { elements: [] }, footer: { elements: [] } } as PostextConfig;
    const found = computeWarnings({ markdown, config, doc: buildDocument({ markdown }, config) }).filter((w) => w.payload.kind === 'wordDividedByCharacter');
    expect(found.length).toBeGreaterThan(0);
    expect(warningCategory('wordDividedByCharacter')).toBe(warningCategory('unbreakableWordOverflow'));
    expect(warningCategory('wordDividedBySyllable')).toBe(warningCategory('unbreakableWordOverflow'));
    expect(DEFAULT_LABELS.warningsWordDividedByCharacterDetail).toContain('__text__');
    expect(DEFAULT_LABELS.warningsWordDividedBySyllableDetail).toContain('__text__');
  });
});
