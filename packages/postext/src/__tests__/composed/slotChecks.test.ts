import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/index.js';
import { collectContentWarnings, formatWarning } from '../../pipeline/contentWarnings.js';
import { parseMarkdownWithIssues } from '../../parse/index.js';
import { composedPages } from '../../composed/document.js';
import { checkComposedSlots } from '../../composed/slotChecks.js';
import type { ComposedPagesConfigKeys, PageTemplate } from '../../composed/types.js';
import type { PostextConfig } from '../../types.js';

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

const TEMA: PageTemplate = {
  id: 'tema-cajas',
  frames: [
    { name: 'titulo', takes: 'h1' },
    { name: 'texto', flow: true },
    { name: 'dinero', next: 'dinero-sigue' },
    { name: 'dinero-sigue' },
    { name: 'dinero-fotos' },
    { name: 'nota', optional: true },
  ],
};

const check = (md: string, templates: PageTemplate[] = [TEMA]) =>
  checkComposedSlots(composedPages(parseMarkdownWithIssues(md).blocks), { pageTemplates: templates });

describe('checkComposedSlots (#854)', () => {
  it('passes a page whose content fills its frames', () => {
    const md = [
      '::::page{template="tema-cajas"}',
      '# Title',
      'Flow text.',
      ':::frame{slot="dinero"}',
      'Money.',
      ':::',
      '::resource{id="foto" slot="dinero-fotos"}',
      '::::',
    ].join('\n');
    expect(check(md)).toEqual([]);
  });

  it('reports an unknown template at its id and skips its slots', () => {
    const md = '::::page{template="tema-cjas"}\n:::frame{slot="zzz"}\nA.\n:::\n::::';
    const found = check(md);
    expect(found).toEqual([{ kind: 'templateUnknown', template: 'tema-cjas', fenceIndex: 0, sourceStart: md.indexOf('tema-cjas'), sourceEnd: md.indexOf('tema-cjas') + 9 }]);
  });

  it('reports a fence with no template at the fence line', () => {
    const md = '::::page\nA.\n::::';
    expect(check(md)).toEqual([{ kind: 'templateUnknown', template: '', fenceIndex: 0, sourceStart: 0, sourceEnd: 8 }]);
  });

  it('reports a slot the template lacks at its first slot value', () => {
    const md = '::::page{template="tema-cajas"}\n# T\nA.\n:::frame{slot="diner"}\nB.\n:::\n:::frame{slot="dinero"}\nC.\n:::\n::resource{id="x" slot="dinero-fotos"}\n::::';
    const found = check(md);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'slotUnknown', template: 'tema-cajas', slot: 'diner' });
    expect(md.slice(found[0]!.sourceStart, found[0]!.sourceEnd)).toBe('diner');
  });

  it('reports frames left empty, not optional ones nor chain targets', () => {
    const md = '::::page{template="tema-cajas"}\n:::frame{slot="dinero"}\nC.\n:::\n::::';
    const found = check(md);
    expect(found.map((w) => w.kind === 'slotEmpty' && w.frame)).toEqual(['titulo', 'texto', 'dinero-fotos']);
    expect(found[0]).toMatchObject({ sourceStart: 0, sourceEnd: md.indexOf('\n') });
  });

  it('a heading taken by a frame does not fill the flow frame', () => {
    const md = '::::page{template="tema-cajas"}\n# T\n:::frame{slot="dinero"}\nC.\n:::\n::resource{id="x" slot="dinero-fotos"}\n::::';
    expect(check(md).map((w) => w.kind === 'slotEmpty' && w.frame)).toEqual(['texto']);
  });

  it('content sent to an unknown slot reaches the flow frame', () => {
    const md = '::::page{template="tema-cajas"}\n# T\n:::frame{slot="x"}\nC.\n:::\n:::frame{slot="dinero"}\nC.\n:::\n::resource{id="x" slot="dinero-fotos"}\n::::';
    expect(check(md).map((w) => w.kind)).toEqual(['slotUnknown']);
  });

  it('knows frames inherited through extends and added by a variant', () => {
    const child: PageTemplate = {
      id: 'hijo',
      extends: 'tema-cajas',
      frames: [{ name: 'texto', remove: true }, { name: 'extra', optional: true }],
      variants: { verso: { frames: [{ name: 'margen' }] } },
    };
    const md = '::::page{template="hijo"}\n# T\n:::frame{slot="dinero"}\nA.\n:::\n:::frame{slot="margen"}\nB.\n:::\n:::frame{slot="texto"}\nC.\n:::\n::resource{id="x" slot="dinero-fotos"}\n::::';
    // `texto` was removed by the child: naming it is unknown.
    expect(check(md, [TEMA, child]).map((w) => w.kind === 'slotUnknown' && w.slot)).toEqual(['texto']);
  });

  it('survives an extends cycle', () => {
    const a: PageTemplate = { id: 'a', extends: 'b', frames: [{ name: 'x', optional: true }] };
    const b: PageTemplate = { id: 'b', extends: 'a', frames: [{ name: 'y', optional: true }] };
    expect(check('::::page{template="a"}\n::::', [a, b])).toEqual([]);
  });
});

describe('composed-page content warnings (#854)', () => {
  const config = { pageTemplates: [TEMA] } as PostextConfig & ComposedPagesConfigKeys;

  it('collectContentWarnings lists them with absolute offsets', () => {
    const md = '---\ntitle: T\n---\n::::page{template="tema-cajas"}\n# T\nA.\n:::frame{slot="dinro"}\nB.\n:::\n::::\n';
    const found = collectContentWarnings(md, config);
    const unknown = found.find((w) => w.kind === 'slotUnknown')!;
    expect(md.slice(unknown.sourceStart, unknown.sourceEnd)).toBe('dinro');
    expect(found.filter((w) => w.kind === 'slotEmpty').map((w) => w.kind === 'slotEmpty' && w.frame)).toEqual(['dinero', 'dinero-fotos']);
    expect(formatWarning(unknown)).toContain('Slot "dinro" is no frame of template "tema-cajas"');
  });

  it('flags a composed page written with three colons and keeps the comic', () => {
    const md = ':::page{template="tema-cajas"}\n::panel\nA: Hola.\n:::\n';
    const found = collectContentWarnings(md, config);
    const w = found.find((x) => x.kind === 'pageFenceLength')!;
    expect(md.slice(w.sourceStart, w.sourceEnd)).toBe(':::page{template="tema-cajas"}');
    expect(formatWarning(w)).toContain('four colons');
    expect(collectContentWarnings(':::page{split="50%|*"}\n::panel\nA: Hola.\n:::\n', config).some((x) => x.kind === 'pageFenceLength')).toBe(false);
  });

  it('formats every new kind', () => {
    expect(formatWarning({ kind: 'templateUnknown', template: 'x', fenceIndex: 0 })).toContain('Unknown page template "x"');
    expect(formatWarning({ kind: 'templateUnknown', template: '', fenceIndex: 0 })).toContain('names no template');
    expect(formatWarning({ kind: 'slotEmpty', template: 't', frame: 'f', fenceIndex: 0 })).toContain('Frame "f" of template "t" receives no content');
  });

  it('sets the page on a page of its own, each frame read whole in the order its content first appears (#855)', () => {
    const md = [
      'Before the page.',
      '',
      '::::page{template="tema-cajas"}',
      '## Page title',
      '',
      ':::frame{slot="dinero"}',
      'Money text.',
      ':::',
      '',
      'Flow text.',
      '::::',
      '',
      'After the page.',
    ].join('\n');
    const doc = buildDocument({ markdown: md }, config);
    const pageOf = (text: string) => doc.blocks.find((b) => b.lines.some((l) => l.text.includes(text)))?.pageIndex;
    expect(pageOf('Before')).toBe(0);
    expect(pageOf('Page title')).toBe(1);
    expect(pageOf('Money text')).toBe(1);
    expect(pageOf('Flow text')).toBe(1);
    expect(pageOf('After the page')).toBe(2);
    const order = doc.blocks.map((b) => b.lines.map((l) => l.text).join(' ')).filter(Boolean);
    // The flow frame's story (the title and the text after the box) comes
    // first: its first block opens the page; the box's follows.
    expect(order.findIndex((t) => t.includes('Page title'))).toBeLessThan(order.findIndex((t) => t.includes('Flow text')));
    expect(order.findIndex((t) => t.includes('Flow text'))).toBeLessThan(order.findIndex((t) => t.includes('Money text')));
    expect(doc.pages[1]!.role).toBe('composed');
    expect(doc.contentWarnings?.find((w) => w.kind === 'slotEmpty')?.pageIndex).toBe(1);
  });

  it('a page that ends the document leaves no empty page behind', () => {
    const doc = buildDocument({ markdown: 'Text.\n\n::::page{template="tema-cajas"}\nInside.\n::::\n' }, config);
    expect(doc.pages).toHaveLength(2);
  });
});
