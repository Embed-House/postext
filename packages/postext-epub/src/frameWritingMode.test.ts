// A frame set in its own writing mode (#944) in the reflowable EPUB (#960):
// its box carries the mode and the length its lines run along, so a reader
// sets the text in that mode rather than in the book's.

import { describe, it, expect } from 'vitest';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { renderToEpub, readEpub } from './index.js';
import type { ReadEpubResult } from './types.js';
import { checkXml } from './reflowable/__tests__/xml.js';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 6 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const config = (extra: Partial<PostextConfig> = {}, mode: 'vertical-rl' | 'horizontal-tb' = 'vertical-rl'): PostextConfig => ({
  page: { width: pt(400), height: pt(500), dpi: 72, margins: { top: pt(40), bottom: pt(40), left: pt(40), right: pt(40) } },
  bodyText: { fontFamily: 'Lora', fontSize: pt(10), lineHeight: pt(20) },
  pageTemplates: [{
    id: 'sheet',
    frames: [
      { name: 'main', flow: true, width: pt(200), height: pt(200), placement: { anchor: { to: 'container', edge: 'top-left' } } },
      { name: 'side', writingMode: mode, width: pt(60), height: pt(200), placement: { anchor: { to: 'container', edge: 'top-right' } } },
    ],
  }],
  ...extra,
} as PostextConfig);
const md = '::::page{template="sheet"}\nThe page.\n\n:::frame{slot="side"}\nSide card\n:::\n::::\n';

const read = async (cfg: PostextConfig): Promise<{ xhtml: string; css: string }> => {
  const doc = buildDocument({ markdown: md }, cfg);
  const book: ReadEpubResult = readEpub(await renderToEpub([doc], { layout: 'reflowable', metadata: { title: 'T', language: 'en', modified: new Date(Date.UTC(2026, 9, 17)) } }));
  const text = (path: string) => new TextDecoder().decode(book.files.get(path)!);
  return { xhtml: text(book.spine.find((s) => s.path.includes('chapter-'))!.path), css: text('OEBPS/styles/book.css') };
};

describe('a frame set in its own writing mode, in the reflowable EPUB (#960)', () => {
  it('a vertical frame of a horizontal book is a box set vertically, as long as the frame is tall', async () => {
    const { xhtml, css } = await read(config());
    // 200 pt of a 10 pt body: 20 em.
    expect(xhtml).toMatch(/<div class="pt-frame pt-frame-side pt-frame-vertical" style="height:20em">/);
    expect(css).toContain('div.pt-frame-vertical');
    expect(css).toMatch(/div\.pt-frame-vertical \{[^}]*writing-mode: vertical-rl/);
    expect(checkXml(xhtml).errors).toEqual([]);
  });

  it('a horizontal card of a vertical book is a box set across, as wide as the card', async () => {
    const { xhtml, css } = await read(config({ layout: { writingMode: 'vertical-rl', layoutType: 'single' } as never }, 'horizontal-tb'));
    expect(xhtml).toMatch(/pt-frame-horizontal" style="width:6em">/);
    expect(css).toMatch(/div\.pt-frame-horizontal \{[^}]*writing-mode: horizontal-tb/);
  });

  it('a frame in the book\'s own mode is written as before', async () => {
    const { xhtml } = await read(config({}, 'horizontal-tb'));
    expect(xhtml).toContain('<div class="pt-frame pt-frame-side">');
    expect(xhtml).not.toContain('pt-frame-vertical');
    expect(xhtml).not.toContain('pt-frame-horizontal"');
  });
});
