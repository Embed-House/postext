import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';
import type { PostextConfig } from 'postext';

// #855: a composed page laid out by the engine (a tabbed title, running
// text, two boxes with tabs, one turned) and written as a tagged PDF.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const face = fontkit.create(fontBytes);
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const sizePx = parseFontString(this.font)?.sizePx ?? 16;
    return { width: (face.layout(s).advanceWidth / face.unitsPerEm) * sizePx };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

describe('composed page to PDF (#855)', () => {
  it('writes a composed page as one tagged page', async () => {
    const mm = (value: number) => ({ value, unit: 'mm' as const });
    const config: PostextConfig = {
      calloutStyles: [{ id: 'box', backgroundEnabled: true, background: { hex: '#d8ecf9' }, label: { position: 'top-left', offset: mm(5), height: mm(5) } } as never],
      pageTemplates: [{
        id: 'page',
        decoration: { elements: [{ kind: 'box', id: 'card', placement: { anchor: { to: 'container', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } }, style: { backgroundColor: { hex: '#ffffff' } } }] } as never,
        frames: [
          { name: 'title', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
          { name: 'text', flow: true, placement: { anchor: { to: '#title', edge: 'below' } } },
          { name: 'money', style: 'box', width: mm(100), placement: { anchor: { to: '#text', edge: 'below' }, offset: { y: mm(8) } } },
          { name: 'saving', style: 'box', width: mm(80), rotate: -4, layer: 2, height: mm(15), placement: { anchor: { to: '#money', edge: 'below' }, offset: { y: mm(8) } } },
        ],
      }],
    };
    const markdown = [
      '::::page{template="page"}',
      '# Money and everyday life',
      '',
      'Every family needs food, clothes and a home.',
      '',
      ':::frame{slot="money" label="What money is for"}',
      'Money lets us swap our work for the things we need.',
      ':::',
      '',
      ':::frame{slot="saving" label="Saving"}',
      'When we spend less than we earn, we can save for later. '.repeat(6),
      ':::',
      '::::',
    ].join('\n');
    const doc = buildDocument({ markdown }, config);
    expect(doc.pages[0]!.composed!.frames.find((f) => f.name === 'saving')!.overflowPx).toBeGreaterThan(0);
    expect(doc.pages[0]!.composed).toBeDefined();
    const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
