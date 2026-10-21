// #1045: a host whose page is not a leaf (the Sandbox's HTML viewer, whose
// pages are a screen wide and a scroll tall) lays composed pages out on the
// print leaf (`composedViewerLeaf`), so their frames keep the print
// geometry instead of anchoring to a page 200,000 px tall.

import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build.js';
import { createMeasurementCache } from '../../measure/index.js';
import type { PageTemplate } from '../../composed/types.js';
import type { DesignElement, PostextConfig, VDTDocument, VDTPage } from '../../index.js';
import { altWithLabels, labelPlainText } from '../../composed/labelText.js';

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
const px = (value: number) => ({ value, unit: 'px' as const });
const DPI = 144;
const MM = DPI / 25.4;
const MARGINS = { top: mm(20), bottom: mm(20), left: mm(15), right: mm(15) };

const template: PageTemplate = {
  id: 'sheet',
  frames: [
    { name: 'title', placement: { anchor: { to: 'container', edge: 'top-left' } }, width: mm(120) },
    { name: 'foot', placement: { anchor: { to: 'container', edge: 'bottom-left' } }, width: mm(120), height: mm(10) },
  ],
  decoration: { elements: [
    { kind: 'box', id: 'band', placement: { anchor: { to: 'page', edge: 'top-left' }, size: { width: { to: 'page', edge: 'right' }, height: mm(30) } }, style: { backgroundColor: { hex: '#1b6aa0', model: 'hex' } } },
  ] as DesignElement[] },
};

const PRINT: PostextConfig = {
  page: { width: mm(210), height: mm(280), dpi: DPI, margins: MARGINS } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: false } }] } as never,
  header: { elements: [] },
  footer: { elements: [] },
  pageTemplates: [template],
};
/** What the viewer lays out with: a page a measure wide and a scroll
 *  tall, no margins, and the print leaf for composed pages. */
const VIEWER: PostextConfig = {
  ...PRINT,
  page: { width: px(750), height: px(200_000), dpi: DPI, margins: { top: px(0), bottom: px(0), left: px(0), right: px(0) } } as never,
  composedViewerLeaf: { width: mm(210), height: mm(280), margins: MARGINS },
};

const MD = [
  'Before the page.',
  '',
  '::::page{template="sheet"}',
  ':::frame{slot="title"}',
  '# A title',
  ':::',
  ':::frame{slot="foot"}',
  'Set in a face.',
  ':::',
  '::::',
  '',
  'After the page.',
].join('\n');

const build = (config: PostextConfig): VDTDocument => buildDocument({ markdown: MD }, config, createMeasurementCache());
const composedOf = (doc: VDTDocument): VDTPage => doc.pages.find((p) => p.composed)!;
const rect = (page: VDTPage, name: string) => page.composed!.frames.find((f) => f.name === name)!.rect;

describe('composed pages on a host’s leaf (composedViewerLeaf, #1045)', () => {
  it('lays the composed page on the leaf, with the print geometry', () => {
    const print = composedOf(build(PRINT));
    const view = composedOf(build(VIEWER));
    expect(view.width).toBeCloseTo(210 * MM, 3);
    expect(view.height).toBeCloseTo(280 * MM, 3);
    expect(view.contentArea).toEqual(print.contentArea);
    for (const name of ['title', 'foot']) expect(rect(view, name)).toEqual(rect(print, name));
    // The foot frame sits at the leaf's foot, not a scroll further down.
    const foot = rect(view, 'foot');
    expect(foot.y + foot.height).toBeCloseTo((280 - 20) * MM, 3);
  });

  it('lays the decoration on the leaf: an element to the page edge runs to the leaf’s', () => {
    const band = composedOf(build(VIEWER)).composed!.decoration!.blocks.find((b) => b.elementId === 'band')!;
    expect(band.bbox.width).toBeCloseTo(210 * MM, 3);
  });

  it('leaves the pages of the flow on the host’s page', () => {
    const doc = build(VIEWER);
    const flow = doc.pages.filter((p) => !p.composed);
    expect(flow.length).toBeGreaterThan(0);
    for (const p of flow) {
      expect(p.width).toBe(750);
      expect(p.height).toBe(200_000);
    }
  });

  it('changes nothing without a leaf', () => {
    const doc = build({ ...PRINT, page: VIEWER.page });
    expect(composedOf(doc).width).toBe(750);
    expect(doc.config.composedViewerLeaf).toBeUndefined();
  });
});

describe('labels read as one line (#1045)', () => {
  it('a forced break is a space in the accessible text', () => {
    expect(labelPlainText('Pico Albar \\\\ 2565 m')).toBe('Pico Albar 2565 m');
    expect(labelPlainText('Pico Albar \\\\\n2565 m')).toBe('Pico Albar 2565 m');
    expect(labelPlainText('  Lago   Ormo ')).toBe('Lago Ormo');
    expect(altWithLabels('Mapa', [{ text: 'Pico Albar \\\\ 2565 m' }, { text: 'Lago Ormo' }])).toBe('Mapa (Pico Albar 2565 m, Lago Ormo)');
  });
});
