import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { createMeasurementCache } from '../../measure/index.js';
import { formatWarning } from '../../pipeline/contentWarnings.js';
import type { ContentWarning, DesignElement, PageTemplate, PostextConfig, VDTDocument } from '../../index.js';

// #1163: among the pages of one composed template and side, a page that
// draws no folio or running foot its siblings draw is reported; a page that
// switches it off on purpose is not.

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
const PAGE = {
  page: { width: mm(170), height: mm(240), dpi: 150, margins: { top: mm(20), bottom: mm(20), left: mm(18), right: mm(18) } },
} as unknown as PostextConfig;

const text = (id: string, content: string, extra: Record<string, unknown> = {}): DesignElement => ({
  kind: 'text', id, content,
  placement: { anchor: { to: 'page', edge: 'bottom-center' }, offset: { y: mm(-8) } },
  ...extra,
} as unknown as DesignElement);

const SHELL: PageTemplate = {
  id: 'shell',
  frames: [{ name: 'texto', flow: true }],
  footer: { elements: [text('folio', '{pageNumber}', { unless: 'frontmatter' }), text('foot', '{attr.foot}', { placement: { anchor: { to: 'page', edge: 'bottom-left' }, offset: { y: mm(-8) } } })] },
};

const page = (attrs: string, template = 'shell') => `::::page{template="${template}"${attrs ? ` ${attrs}` : ''}}\n\nSome words on the page.\n\n::::`;

function build(fences: string[], templates: PageTemplate[] = [SHELL]): VDTDocument {
  return buildDocument({ markdown: ['# Chapter', '', ...fences].join('\n\n') }, { ...PAGE, pageTemplates: templates } as PostextConfig, createMeasurementCache());
}

const missing = (doc: VDTDocument) =>
  (doc.contentWarnings ?? []).filter((w): w is Extract<ContentWarning, { kind: 'folioMissing' }> => w.kind === 'folioMissing');

describe('folioMissing (#1163)', () => {
  it('reports the page whose running foot reads an attribute its fence leaves unset', () => {
    const fences = ['foot="Unit 1"', 'foot="Unit 1"', 'foot="Unit 1"', 'foot="Unit 1"', '', 'foot="Unit 1"', 'foot="Unit 1"'].map((a) => page(a));
    const doc = build(fences);
    const composed = doc.pages.filter((p) => p.composed);
    expect(composed).toHaveLength(7);
    const ws = missing(doc);
    expect(ws).toHaveLength(1);
    const w = ws[0]!;
    expect(w).toMatchObject({ template: 'shell', elementId: 'foot', slot: 'footer', folio: false, side: 'verso', drawnOn: 3, siblings: 3 });
    expect(w.pageIndex).toBe(composed[4]!.index);
    expect(formatWarning(w)).toContain('"shell"');
    expect(formatWarning(w)).toContain('running foot "foot"');
  });

  it('says nothing of pages whose fence switches the folio off (unless)', () => {
    const fences = ['frontmatter foot="x"', 'frontmatter foot="x"', 'frontmatter foot="x"', 'foot="x"', 'foot="x"', 'foot="x"', 'foot="x"', 'foot="x"'].map((a) => page(a));
    expect(missing(build(fences))).toEqual([]);
  });

  it('says nothing of a template with no folio (an opener) among the pages of another', () => {
    const opener: PageTemplate = { id: 'opener', frames: [{ name: 'texto', flow: true }], footer: false };
    const fences = [page('', 'opener'), ...Array.from({ length: 6 }, () => page('foot="x"'))];
    expect(missing(build(fences, [SHELL, opener]))).toEqual([]);
  });

  it('reports a decoration folio a page lost, and needs two pages that draw it', () => {
    const deco: PageTemplate = {
      id: 'deco',
      frames: [{ name: 'texto', flow: true }],
      footer: false,
      decoration: { elements: [text('pn', 'p. {pageNumber}{attr.blank}', {}), text('band', 'Plain words', { placement: { anchor: { to: 'page', edge: 'top-left' } } })] },
    };
    // An element that writes `{attr.blank}` draws as long as its page
    // number does: every page draws it, nothing is reported.
    const fences = Array.from({ length: 6 }, () => page('', 'deco'));
    expect(missing(build(fences, [deco]))).toEqual([]);
    // A running unit name in the decoration that one page leaves empty.
    const unit: PageTemplate = { ...deco, id: 'unit', decoration: { elements: [text('unit', '{attr.unit}')] } };
    const doc = build(['unit="A"', 'unit="A"', 'unit="A"', 'unit="A"', 'unit="A"', 'unit="A"', ''].map((a) => page(a, 'unit')), [unit]);
    expect(missing(doc).map((w) => [w.slot, w.elementId, w.pageIndex])).toEqual([['decoration', 'unit', doc.pages.filter((p) => p.composed)[6]!.index]]);
    // Two pages of a side, one with and one without: not enough to judge.
    const pair: PageTemplate = { ...SHELL, id: 'pair' };
    expect(missing(build([page('foot="x"', 'pair'), page('foot="x"', 'pair'), page('', 'pair')], [pair]))).toEqual([]);
  });

  it('honours when on the element: a page that does not set it is no sibling', () => {
    const gated: PageTemplate = {
      ...SHELL,
      id: 'gated',
      footer: { elements: [text('foot', '{attr.foot}', { when: 'body' })] },
    };
    const fences = ['', '', 'body foot="x"', 'body foot="x"', 'body foot="x"', 'body foot="x"', 'body foot="x"'].map((a) => page(a, 'gated'));
    expect(missing(build(fences, [gated]))).toEqual([]);
  });
});
