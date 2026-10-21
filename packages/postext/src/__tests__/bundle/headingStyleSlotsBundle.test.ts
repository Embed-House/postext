import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildBundle, createBundle, openBundle } from '../../bundle/index.js';
import { buildDocument } from '../../pipeline/index.js';
import type { DesignElement, PostextConfig } from '../../types.js';
import type { VDTDocument } from '../../vdt.js';

// #694: a bundle stores its configuration stripped of defaults, and the
// strip dropped a heading style's empty `header` or `footer`. A cover that
// silences the folio opened with the document's folio on it.

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

const pt = (value: number) => ({ value, unit: 'pt' as const });
const folio: DesignElement = {
  kind: 'text', id: 'folio', content: '{pageNumber}', fontSize: pt(8),
  placement: { anchor: { to: 'container', edge: 'top' } },
} as DesignElement;
const config: PostextConfig = {
  header: { elements: [] },
  footer: { elements: [folio] },
  headings: { levels: [{ level: 1, breakBefore: { enabled: true, parity: 'any' } }] },
  headingStyles: [{ id: 'cover', numbered: false, toc: false, footer: { elements: [] } }],
};
const markdown = '# The cover {style="cover"}\n\nA line under the title.\n\n# One\n\nThe first chapter.\n';
const manifestOf = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(unzipSync(bytes)['preset.json']));
/** The text the foot of each page prints. */
const feet = (doc: VDTDocument) => doc.pages.map((page) => (page.footer?.blocks ?? [])
  .flatMap((block) => (block.kind === 'text' ? block.lines.map((line) => line.text) : [])).join(''));

describe('a bundle keeps the slot a heading style empties (#694)', () => {
  it('lays the cover out with no folio, as the document it was written from', async () => {
    const pen = buildDocument({ markdown }, config);
    expect(feet(pen)).toEqual(['', '2']);
    const { bytes } = await createBundle({ name: 'Cover', markdown, config });
    expect(manifestOf(bytes).config.headingStyles).toEqual([{ id: 'cover', numbered: false, toc: false, footer: { elements: [] } }]);
    const opened = await openBundle(bytes);
    const [doc] = buildBundle(opened);
    expect(feet(doc!)).toEqual(feet(pen));
  });

  it('written again from what was read, it is the same bundle', async () => {
    const first = await createBundle({ name: 'Cover', markdown, config, mtime: new Date(1980, 0, 1) });
    const opened = await openBundle(first.bytes);
    const again = await createBundle({ name: 'Cover', markdown, config: opened.config, mtime: new Date(1980, 0, 1) });
    expect(again.manifest.config!.headingStyles).toEqual(first.manifest.config!.headingStyles);
    expect(again.manifest.config!.footer).toEqual(first.manifest.config!.footer);
  });

  it('gives a cover with no slot of its own the document\'s folio', () => {
    const plain: PostextConfig = { ...config, headingStyles: [{ id: 'cover', numbered: false, toc: false }] };
    expect(feet(buildDocument({ markdown }, plain))).toEqual(['1', '2']);
  });
});
