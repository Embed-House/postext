// #1054: a label tab's glyph icon is decoration to a reader. The fixed
// layout paints it hidden from assistive technology; the reflowable book
// reads the box's tab as its words, without the glyph.

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
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14) },
  calloutStyles: [{
    id: 'tab', title: '',
    label: {
      fontSize: pt(10), position: 'top-left', height: pt(14), paddingX: pt(6), offset: pt(7), color: hex('#123456'),
      icon: { glyph: '◉', placement: 'inside', gap: pt(3), color: hex('#cc0000') },
    },
  }] as never,
};

const options = (layout: RenderToEpubOptions['layout']): RenderToEpubOptions => ({
  layout,
  metadata: { title: 'Tabs', language: 'en', modified: new Date(Date.UTC(2026, 9, 20)) },
});
const text = (book: ReadEpubResult, path: string): string => new TextDecoder().decode(book.files.get(path)!);
const contents = (book: ReadEpubResult): string => book.spine.map((s) => text(book, s.path)).join('\n');

describe('a glyph tab icon in the EPUB (#1054)', () => {
  let doc: VDTDocument;
  beforeAll(() => {
    doc = buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody of the box.\n:::' }, config);
  });

  it('the fixed layout paints the glyph in its colour, hidden from assistive technology', async () => {
    const xhtml = contents(readEpub(await renderToEpub([doc], options('fixed'))));
    const at = xhtml.indexOf('◉');
    expect(at).toBeGreaterThan(-1);
    const div = xhtml.slice(xhtml.lastIndexOf('<div', at), at);
    expect(div).toContain('aria-hidden="true"');
    expect(div).toContain('color:#cc0000');
    // The words are read.
    const words = xhtml.indexOf('>Money<');
    expect(words).toBeGreaterThan(-1);
    expect(xhtml.slice(xhtml.lastIndexOf('<div', words), words)).not.toContain('aria-hidden');
  });

  it('the reflowable book reads the tab\'s words without the glyph', async () => {
    const xhtml = contents(readEpub(await renderToEpub([doc], options('reflowable'))));
    expect(xhtml).toContain('Money');
    expect(xhtml).not.toContain('◉');
  });
});
