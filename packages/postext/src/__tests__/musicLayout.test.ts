import { describe, it, expect, beforeAll } from 'vitest';
import { buildDocument } from '../pipeline/index.js';
import { renderToHtmlIndexed } from '../html-backend.js';
import { initMusicEngine } from '../music/index.js';
import { parseMarkdown } from '../parse/index.js';
import type { PostextConfig } from '../types.js';
import type { VDTBlock } from '../vdt.js';

// Deterministic text measurement stub (no DOM in the node test env).
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

const TUNE = `X:1
T:Study in D
C:Anonymous
M:4/4
L:1/8
K:D
${Array.from({ length: 12 }, () => 'DFAd fdAF|GBdg bgdB|Acea c\'aec|d2f2 d4|').join('\n')}|]`;

const MARKDOWN = `# Scales

Some text before the score.

\`\`\`abc {alt="A study in D"}
${TUNE}
\`\`\`

Text after the score.
`;

const CONFIG: PostextConfig = { page: { width: { value: 12, unit: 'cm' }, height: { value: 16, unit: 'cm' } } };

function scoreBlocks(doc: ReturnType<typeof buildDocument>): Array<{ page: number; block: VDTBlock }> {
  const out: Array<{ page: number; block: VDTBlock }> = [];
  for (const page of doc.pages) for (const col of page.columns) for (const b of col.blocks) if (b.type === 'score') out.push({ page: page.index, block: b });
  return out;
}

describe('music scores in the layout', () => {
  beforeAll(async () => { await initMusicEngine(); }, 60_000);

  it('parses a notation fence as a score, and a {listing} fence as code', () => {
    const blocks = parseMarkdown('```abc\nX:1\nK:C\nCDEF|\n```\n\n```abc {listing}\nX:1\n```\n');
    expect(blocks.map((b) => b.type)).toEqual(['score', 'code']);
    expect(blocks[0]!.score).toMatchObject({ format: 'abc', source: 'X:1\nK:C\nCDEF|' });
  });

  it('sets one block per system, running on over pages', () => {
    const doc = buildDocument({ markdown: MARKDOWN }, CONFIG);
    const systems = scoreBlocks(doc);
    expect(systems.length).toBeGreaterThan(4);
    const pages = new Set(systems.map((s) => s.page));
    expect(pages.size).toBeGreaterThan(1);
    systems.forEach(({ block }, i) => {
      expect(block.score).toMatchObject({ index: i, count: systems.length });
      expect(block.lines).toHaveLength(1);
      expect(block.lines[0]?.segments?.[0]?.kind).toBe('score');
    });
    expect(systems[0]?.block.score?.alt).toBe('A study in D');
    // Systems never overlap, and their staves stay in their column.
    const inkHeight = (b: VDTBlock): number => b.lines[0]?.bbox.height ?? 0;
    for (const page of doc.pages) {
      for (const col of page.columns) {
        const ss = col.blocks.filter((b) => b.type === 'score');
        for (let k = 1; k < ss.length; k++) expect(ss[k]!.bbox.y).toBeGreaterThanOrEqual(ss[k - 1]!.bbox.y + inkHeight(ss[k - 1]!) - 0.01);
        for (const b of ss) expect(b.bbox.y + inkHeight(b)).toBeLessThanOrEqual(col.bbox.y + col.bbox.height + 0.5);
      }
    }
  });

  it('paints the systems as inline SVG in HTML', () => {
    const doc = buildDocument({ markdown: MARKDOWN }, CONFIG);
    const html = renderToHtmlIndexed(doc).html;
    expect((html.match(/<svg[^>]*aria-label="A study in D"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-hidden="true"');
  });

  it('keeps notation fences as code when scoreStyle.enabled is off', () => {
    const doc = buildDocument({ markdown: MARKDOWN }, { ...CONFIG, scoreStyle: { enabled: false } });
    expect(scoreBlocks(doc)).toHaveLength(0);
  });
});

describe('score fences in configurations written before them', () => {
  it('keeps a notation fence a listing in a configuration of version 19 whose text has one', async () => {
    const { migrateConfig } = await import('../bundle/configVersion.js');
    expect(migrateConfig<PostextConfig>({}, 19, { content: '```abc\nX:1\n```\n' }).scoreStyle).toEqual({ enabled: false });
    expect(migrateConfig<PostextConfig>({}, 19, { content: '```js\nlet a;\n```\n' }).scoreStyle).toBeUndefined();
    expect(migrateConfig<PostextConfig>({ scoreStyle: { enabled: true } }, 19, { content: '```abc\n```' }).scoreStyle).toEqual({ enabled: true });
    expect(migrateConfig<PostextConfig>({}, 20, { content: '```abc\nX:1\n```\n' }).scoreStyle).toBeUndefined();
  });
});
