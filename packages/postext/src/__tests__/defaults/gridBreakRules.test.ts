import { describe, it, expect } from 'vitest';
import { avoidOrphansByDefault, avoidWidowsByDefault, stripBodyTextDefaults, stripConfigDefaults } from '../../defaults';
import { resolveAllConfig } from '../../pipeline/config';
import { buildDocument } from '../../pipeline';
import { createMeasurementCache } from '../../measure';
import type { PostextConfig } from '../../types';

// #717: a page on a character grid is specified as a number of lines, so
// the two rules that leave a column a line short are off by default there:
// `avoidWidows` (a paragraph's first lines at a column's foot) on any grid,
// `avoidOrphans` (its last lines at the next one's head) in the Japan
// region too. A Chinese grid keeps the second: 孤行 (clreq §7.1.2).

const GRID = { enabled: true, charsPerLine: 10, linesPerPage: 5 };
const CONTEXTS: Record<string, { config: PostextConfig; widows: boolean; orphans: boolean }> = {
  plain: { config: {}, widows: true, orphans: true },
  japaneseGrid: { config: { locale: 'ja', cjk: { grid: GRID } }, widows: false, orphans: false },
  chineseGrid: { config: { locale: 'zh-Hans', cjk: { grid: GRID } }, widows: false, orphans: true },
  traditionalGrid: { config: { locale: 'zh-Hant', cjk: { grid: GRID } }, widows: false, orphans: true },
  japanese: { config: { locale: 'ja' }, widows: true, orphans: true },
  japanRegionGrid: { config: { cjk: { region: 'japan', grid: GRID } }, widows: false, orphans: false },
  japaneseByHyphenation: { config: { bodyText: { hyphenation: { locale: 'ja' } }, cjk: { grid: GRID } }, widows: false, orphans: false },
  // A named region wins over the language: a Japanese text set to Chinese rules.
  mainlandRegionGrid: { config: { locale: 'ja', cjk: { region: 'mainland', grid: GRID } }, widows: false, orphans: true },
  noLanguageGrid: { config: { cjk: { grid: GRID } }, widows: false, orphans: true },
  gridOff: { config: { locale: 'ja', cjk: { grid: { ...GRID, enabled: false } } }, widows: true, orphans: true },
};
const withRules = (context: PostextConfig, rules: NonNullable<PostextConfig['bodyText']>): PostextConfig => ({
  ...context,
  bodyText: { ...context.bodyText, ...rules },
});

describe('the widow and orphan defaults of a character grid (#717)', () => {
  it('follow the grid and the region', () => {
    for (const [name, { config, widows, orphans }] of Object.entries(CONTEXTS)) {
      expect(avoidWidowsByDefault(config), name).toBe(widows);
      expect(avoidOrphansByDefault(config), name).toBe(orphans);
      const resolved = resolveAllConfig(config).bodyText;
      expect(resolved.avoidWidows, name).toBe(widows);
      expect(resolved.avoidOrphans, name).toBe(orphans);
      // The list rules keep their own defaults: they act under the main flag.
      expect(resolved.avoidWidowsInLists, name).toBe(true);
      expect(resolved.avoidOrphansInLists, name).toBe(true);
    }
    expect(avoidWidowsByDefault(undefined)).toBe(true);
    expect(avoidOrphansByDefault(undefined)).toBe(true);
  });

  it('give way to a config that sets the key', () => {
    for (const [name, { config }] of Object.entries(CONTEXTS)) {
      for (const value of [true, false]) {
        const resolved = resolveAllConfig(withRules(config, { avoidWidows: value, avoidOrphans: value })).bodyText;
        expect(resolved.avoidWidows, `${name} ${value}`).toBe(value);
        expect(resolved.avoidOrphans, `${name} ${value}`).toBe(value);
      }
    }
  });
});

describe('stripConfigDefaults and the break rules of the document (#717)', () => {
  it('keeps a rule turned on where it is off by default, and drops it turned off', () => {
    const ja = CONTEXTS.japaneseGrid!.config;
    const on = withRules(ja, { avoidWidows: true, avoidOrphans: true });
    expect(stripConfigDefaults(on)).toEqual(on);
    expect(stripConfigDefaults(withRules(ja, { avoidWidows: false, avoidOrphans: false }))).toEqual(ja);
    const zh = CONTEXTS.chineseGrid!.config;
    expect(stripConfigDefaults(withRules(zh, { avoidWidows: true, avoidOrphans: true }))).toEqual(withRules(zh, { avoidWidows: true }));
    expect(stripConfigDefaults(withRules(zh, { avoidWidows: false, avoidOrphans: false }))).toEqual(withRules(zh, { avoidOrphans: false }));
  });

  it('strips a plain document as before', () => {
    expect(stripConfigDefaults({ bodyText: { avoidWidows: true, avoidOrphans: true } })).toEqual({});
    const off: PostextConfig = { bodyText: { avoidWidows: false, avoidOrphans: false } };
    expect(stripConfigDefaults(off)).toEqual(off);
    const japanese: PostextConfig = { locale: 'ja', bodyText: { avoidWidows: true, avoidOrphans: true } };
    expect(stripConfigDefaults(japanese)).toEqual({ locale: 'ja' });
  });

  it('resolves the stripped configuration like the one it was given, in every context', () => {
    for (const [name, { config }] of Object.entries(CONTEXTS)) {
      for (const avoidWidows of [true, false, undefined]) {
        for (const avoidOrphans of [true, false, undefined]) {
          const rules = { ...(avoidWidows !== undefined ? { avoidWidows } : {}), ...(avoidOrphans !== undefined ? { avoidOrphans } : {}) };
          const full = withRules(config, { ...rules, widowMinLines: 3 });
          const stripped = stripConfigDefaults(full);
          const label = `${name} ${avoidWidows} ${avoidOrphans}`;
          expect(resolveAllConfig(stripped), label).toEqual(resolveAllConfig(full));
          // The strip does not change what the defaults are, and a second
          // pass changes nothing.
          expect(avoidWidowsByDefault(stripped), label).toBe(avoidWidowsByDefault(full));
          expect(avoidOrphansByDefault(stripped), label).toBe(avoidOrphansByDefault(full));
          expect(stripConfigDefaults(stripped), label).toEqual(stripped);
        }
      }
    }
  });

  it('stripBodyTextDefaults takes the defaults of the document, on unless told', () => {
    expect(stripBodyTextDefaults({ avoidWidows: true, avoidOrphans: true })).toBeUndefined();
    expect(stripBodyTextDefaults({ avoidWidows: false, avoidOrphans: false })).toEqual({ avoidWidows: false, avoidOrphans: false });
    expect(stripBodyTextDefaults({ avoidWidows: true, avoidOrphans: true }, 'ja', false, false)).toEqual({ avoidWidows: true, avoidOrphans: true });
    expect(stripBodyTextDefaults({ avoidWidows: false, avoidOrphans: false }, 'ja', false, false)).toBeUndefined();
    expect(stripBodyTextDefaults({ avoidWidows: true, avoidOrphans: true }, 'zh-Hans', false, true)).toEqual({ avoidWidows: true });
    expect(stripBodyTextDefaults({ avoidWidows: false, avoidOrphans: false }, 'zh-Hans', false, true)).toEqual({ avoidOrphans: false });
  });
});

// A 10 × 5 grid: paragraphs of four, three and two lines. With the foot
// rule on, the second paragraph (one line of room left) moves on whole and
// the first page carries four lines of its five.
describe('a page on a character grid holds its lines (#717)', () => {
  const EM = 20;
  class StubCtx {
    font = '';
    letterSpacing = '0px';
    measureText(s: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } {
      let w = 0;
      for (const ch of s) w += ch === ' ' ? EM / 4 : ch.codePointAt(0)! >= 0x2e80 ? EM : EM / 2;
      return { width: w, actualBoundingBoxAscent: 0.88 * EM, actualBoundingBoxDescent: 0.12 * EM };
    }
  }
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
    getContext(): StubCtx {
      return new StubCtx();
    }
  };
  const pt = (value: number) => ({ value, unit: 'pt' as const });
  const config = (locale: string, body: PostextConfig['bodyText'] = {}): PostextConfig => ({
    locale,
    page: { width: pt(10 * EM + 40), height: pt(5 * 30 + 40), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    bodyText: { fontSize: pt(EM), lineHeight: pt(30), textAlign: 'justify', firstLineIndent: pt(0), ...body },
    cjk: { grid: GRID },
  });
  const K = '一二三四五六七八九十';
  const MD = `${K.repeat(4)}\n\n${K.repeat(3)}\n\n${K.repeat(2)}`;
  const linesPerPage = (cfg: PostextConfig, markdown = MD): number[] => {
    const doc = buildDocument({ markdown }, cfg, createMeasurementCache());
    const out: number[] = [];
    for (const b of doc.blocks) out[b.pageIndex] = (out[b.pageIndex] ?? 0) + b.lines.length;
    return out;
  };

  it('fills the page by default, in Japanese and in Chinese', () => {
    for (const locale of ['ja', 'zh-Hans', 'zh-Hant']) {
      expect(linesPerPage(config(locale)), locale).toEqual([5, 4]);
      expect(linesPerPage(config(locale, { avoidWidows: true, avoidOrphans: true })), locale).toEqual([4, 5]);
    }
  });

  it('a Chinese grid keeps the last line of a paragraph off the head of a page, a Japanese one does not', () => {
    // Four lines, then a paragraph of two: its last line would open the
    // second page alone.
    const md = `${K.repeat(4)}\n\n${K.repeat(2)}\n\n${K.repeat(2)}`;
    expect(linesPerPage(config('ja'), md)).toEqual([5, 3]);
    expect(linesPerPage(config('zh-Hans'), md)).toEqual([4, 4]);
    expect(linesPerPage(config('zh-Hans', { avoidOrphans: false }), md)).toEqual([5, 3]);
  });
});
