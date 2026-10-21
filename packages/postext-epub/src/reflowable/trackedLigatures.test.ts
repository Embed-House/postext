import { describe, expect, it } from 'vitest';
import { buildReflowablePublication } from './index.js';
import { buildBundle } from 'postext';
import '../__tests__/sampleBook.js';

// #703: letter-spacing never changes the glyphs. A reading system turns
// the common ligatures off where the letter-spacing is not zero; the
// stylesheet asks for them as features beside every `letter-spacing` it
// writes, as the fixed-layout pages and the PDF keep them.
const pt = (value: number) => ({ value, unit: 'pt' as const });
const CHAPTER = '# The first office\n\n## A fine field\n\nText.\n\n:::callout{type="d" title="The first finding"}\nOne line.\n:::\n\n::resource{id="t"}\n';
const table = {
  id: 't', typeId: 'table', kind: 'table' as const, createdAt: 0, updatedAt: 0,
  placement: { position: 'here' as const },
  table: { model: { headerRowCount: 1, rows: [[{ content: 'Office' }, { content: 'Staff' }], [{ content: 'First' }, { content: '4' }]] } },
};

async function cssOf(tracked: boolean): Promise<string> {
  // The sample book's module sets the measuring stub the layout needs.
  const docs = buildBundle({
    chapters: [{ markdown: CHAPTER }],
    resources: [table],
    config: {
      page: { width: pt(360), height: pt(480), margins: { top: pt(24), bottom: pt(24), left: pt(24), right: pt(24) } },
      locale: 'en-us',
      ...(tracked ? {
        headings: { levels: [{ level: 2, letterSpacing: pt(1) }] },
        tableStyle: { headerLetterSpacing: pt(1) },
        calloutStyles: [{ id: 'd', titleStyle: { letterSpacing: pt(1) } }],
      } : { calloutStyles: [{ id: 'd' }] }),
    },
  });
  const pub = await buildReflowablePublication(docs, {
    layout: 'reflowable',
    metadata: { title: 'Tracked', language: 'en-US', modified: new Date(Date.UTC(2026, 9, 11)) },
  });
  return pub.items.filter((i) => i.mediaType === 'text/css').map((i) => String(i.data)).join('\n');
}

describe('tracked text in a reflowable book (#703)', () => {
  it('asks for the ligatures beside each letter-spacing: heading level, table header, callout title', async () => {
    const css = await cssOf(true);
    const rules = css.split('}').filter((r) => /letter-spacing: [\d.]+em/.test(r));
    expect(rules.length).toBe(3);
    for (const r of rules) expect(r).toMatch(/letter-spacing: [\d.]+em;\n\s*font-feature-settings: 'liga' 1, 'clig' 1;/);
    expect(rules.map((r) => r.slice(0, r.indexOf('{')).trim()).sort()).toEqual(['aside.pt-callout-d > .pt-callout-title', 'h2', 'th'].sort());
  });

  it('writes no feature where nothing is tracked', async () => {
    const css = await cssOf(false);
    expect(css).not.toContain('font-feature-settings');
    expect(css).not.toMatch(/letter-spacing: [\d.]+em/);
  });
});
