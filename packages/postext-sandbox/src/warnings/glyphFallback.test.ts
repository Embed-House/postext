import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, forgetFontCoverage, registerFontCoverage } from 'postext';
import type { PostextConfig } from 'postext';
import { computeWarnings } from './compute';
import { warningCategory } from './categories';
import type { WarningPayload } from './types';
import { DEFAULT_LABELS } from '../types/defaultLabels';

// #1105: the characters a face lacks, which another face drew (the
// engine's `glyphFallback`), are listed under Fonts, once per face, and go
// with the missing-font checks when they are turned off.

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

afterEach(() => forgetFontCoverage());

const glyphs = (cfg: PostextConfig, markdown: string) =>
  computeWarnings({ markdown, config: cfg, doc: buildDocument({ markdown }, cfg) })
    .filter((w): w is typeof w & { payload: Extract<WarningPayload, { kind: 'glyphFallback' }> } => w.payload.kind === 'glyphFallback');

const base: PostextConfig = { header: { elements: [] }, footer: { elements: [] }, bodyText: { fontFamily: 'Subset Sans' }, headings: { fontFamily: 'Subset Sans' } };

describe('glyphFallback in the Checks panel (#1105)', () => {
  it('lists the characters a face lacks under Fonts, once per face', () => {
    registerFontCoverage('Subset Sans', 400, 'normal', [[0x20, 0x7e]]);
    const found = glyphs(base, 'An arrow → here, ← there.');
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe('glyph-fallback-Subset Sans-400-normal');
    expect(found[0]!.payload).toEqual({ kind: 'glyphFallback', family: 'Subset Sans', weight: 400, style: 'normal', characters: ['→', '←'], count: 2 });
    expect(warningCategory('glyphFallback')).toBe('fonts');
    expect(DEFAULT_LABELS.warningsGlyphFallbackSystemDetail).toContain('__chars__');
  });

  it('is turned off with the missing-font checks', () => {
    registerFontCoverage('Subset Sans', 400, 'normal', [[0x20, 0x7e]]);
    expect(glyphs({ ...base, debug: { warnings: { missingFont: false } } }, 'An arrow →.')).toEqual([]);
  });
});
