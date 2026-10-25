import { describe, it, expect } from 'vitest';
import { expandIndexDirectives } from '../pipeline/indexDirective.js';
import { parseMarkdown } from '../parse/index.js';
import { resolveAllConfig } from '../pipeline/config.js';
import type { ContentBlock } from '../parse/index.js';
import type { OutlineEntry, PostextConfig } from '../types.js';

// Needs Node's full ICU (the default build) for the Turkish collation.

const pt = (value: number) => ({ value, unit: 'pt' as const });
const base: PostextConfig = {
  locale: 'tr',
  page: { width: pt(360), height: pt(300), margins: { top: pt(18), bottom: pt(18), left: pt(18), right: pt(18) } },
  layout: { layoutType: 'single' },
};

const markEntry = (path: string[], pageIndex: number, extra: Partial<NonNullable<OutlineEntry['indexMark']>> = {}): OutlineEntry => ({
  kind: 'indexMark', level: 0, title: path.join('!'), number: '', numbered: false, listed: false,
  indexMark: { index: '', path, sourceStart: pageIndex * 100 + path.length, ...extra },
  pageIndex, pageLabel: String(pageIndex + 1), pageFormat: 'decimal',
});

const expanded = (blocks: ContentBlock[]): string[] => blocks.filter((b) => b.index).map((b) =>
  `${b.index!.group ? `[${b.index!.group}] ` : b.index!.groupStart ? '+ ' : ''}${b.text}`);

const directive = parseMarkdown(':::index');
const build = (outline: OutlineEntry[], config: PostextConfig = base) =>
  expanded(expandIndexDirectives(directive, outline, resolveAllConfig(config)).blocks);

const WORDS = ['çanta', 'cam', 'ıslak', 'iğne', 'şeker', 'sakin', 'ölçü', 'oda', 'üzüm', 'uzun', 'Âlim', 'alim', 'İbn Sînâ', 'ibn'];

describe('a Turkish index', () => {
  it('sorts in the Turkish alphabet and heads its groups with Turkish letters', () => {
    const lines = build(WORDS.map((w) => markEntry([w], 0)));
    expect(lines.map((l) => l.replace(/, 1$/, ''))).toEqual([
      '[A] alim', 'Âlim',
      '[C] cam',
      '[Ç] çanta',
      '[I] ıslak',
      '[İ] ibn', 'İbn Sînâ', 'iğne',
      '[O] oda',
      '[Ö] ölçü',
      '[S] sakin',
      '[Ş] şeker',
      '[U] uzun',
      '[Ü] üzüm',
    ]);
  });

  it('files Âlim and alim under A, and İbn and ibn under İ, not I', () => {
    const lines = build(['Âlim', 'alim', 'İbn Sînâ', 'ibn', 'ıslak'].map((w) => markEntry([w], 0)));
    expect(lines.filter((l) => l.startsWith('['))).toEqual(['[A] alim, 1', '[I] ıslak, 1', '[İ] ibn, 1']);
  });

  it('names the symbol and number groups and the cross-references in Turkish', () => {
    const lines = build([
      markEntry(['#etiket'], 0), markEntry(['1453'], 1),
      markEntry(['ilim'], 2, { see: 'fıkıh' }), markEntry(['fıkıh'], 3), markEntry(['fıkıh'], 4, { seeAlso: 'usûl' }), markEntry(['usûl'], 5),
    ]);
    expect(lines).toEqual([
      '[Simgeler] #etiket, 1',
      '[Sayılar] 1453, 2',
      '[F] fıkıh, 4, 5. Ayrıca bk. usûl',
      '[İ] ilim. Bk. fıkıh',
      '[U] usûl, 6',
    ]);
  });
});
