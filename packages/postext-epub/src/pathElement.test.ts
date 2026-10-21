// #1060: a path element of a running head is painted by the fixed layout
// as an inline SVG hidden from assistive technology, and left out of the
// reflowable book (page furniture is not reflowed).

import { describe, it, expect, beforeAll } from 'vitest';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToEpub, readEpub } from './index.js';
import type { ReadEpubResult, RenderToEpubOptions } from './types.js';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: [...s].length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const config: PostextConfig = {
  page: { width: pt(300), height: pt(400), dpi: 72, margins: { top: pt(40), bottom: pt(30), left: pt(30), right: pt(30) } },
  locale: 'en-us',
  layout: { layoutType: 'single' },
  header: { elements: [
    { kind: 'text', id: 'head', content: 'Running head', fontSize: pt(8), placement: { anchor: { to: 'container', edge: 'bottom-left' } } },
    {
      kind: 'path', id: 'chevrons', viewBox: [9, 3], fill: hex('#c0392b'),
      d: 'M0 0L1.5 1.5L0 3H1L2.5 1.5L1 0Z M3 0l1.5 1.5L3 3h1l1.5-1.5L4 0z M6 0L7.5 1.5L6 3H7L8.5 1.5L7 0Z',
      placement: { anchor: { to: '#head', edge: 'right-of', at: 'center' }, offset: { x: pt(4) }, size: { width: pt(18), height: pt(6) } },
    },
  ] } as never,
  footer: { elements: [] },
};

const options = (layout: RenderToEpubOptions['layout']): RenderToEpubOptions => ({
  layout,
  metadata: { title: 'Chevrons', language: 'en', modified: new Date(Date.UTC(2026, 9, 20)) },
});
const text = (book: ReadEpubResult, path: string): string => new TextDecoder().decode(book.files.get(path)!);
const contents = (book: ReadEpubResult): string => book.spine.map((s) => text(book, s.path)).join('\n');

describe('a path element in the EPUB (#1060)', () => {
  let doc: VDTDocument;
  beforeAll(() => {
    doc = buildDocument({ markdown: 'Body text of the page.' }, config);
  });

  it('the fixed layout paints the chevrons as an inline SVG, hidden from assistive technology', async () => {
    const xhtml = contents(readEpub(await renderToEpub([doc], options('fixed'))));
    const at = xhtml.indexOf('fill="#c0392b"');
    expect(at).toBeGreaterThan(-1);
    const svg = xhtml.slice(xhtml.lastIndexOf('<svg', at), xhtml.indexOf('</svg>', at));
    expect(svg).toContain('aria-hidden="true"');
    expect(svg.match(/Z/g)).toHaveLength(3);
  });

  it('the reflowable book leaves them out', async () => {
    const xhtml = contents(readEpub(await renderToEpub([doc], options('reflowable'))));
    expect(xhtml).toContain('Body text');
    expect(xhtml).not.toContain('#c0392b');
  });
});
