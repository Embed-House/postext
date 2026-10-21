import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #876 (R3, the school atlas): on a right-to-left page the frames are set
// through the mirrored flow and the decoration on the sheet; a title
// frame above layer 0 still paints over the band of the decoration, and
// a frame below layer 0 under it.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const face = fontkit.create(fontBytes);
const fontProvider = async () => new Uint8Array(fontBytes);

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const sizePx = parseFontString(this.font)?.sizePx ?? 16;
    const run = face.layout(s);
    return { width: (run.advanceWidth / face.unitsPerEm) * sizePx };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const config = (direction: 'ltr' | 'rtl'): PostextConfig => ({
  locale: 'en-us',
  direction,
  header: { elements: [] },
  footer: { elements: [] },
  headings: { levels: [{ level: 1, breakBefore: { enabled: false } }] },
  pageTemplates: [{
    id: 'sheet',
    frames: [
      { name: 'title', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
      { name: 'under', layer: -1, width: mm(40), height: mm(10), placement: { anchor: { to: 'container', edge: 'bottom-left' } } },
    ],
    decoration: { elements: [{ kind: 'box', id: 'band', style: { backgroundColor: { hex: '#1d5f73', model: 'hex' } },
      placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: mm(50) } } }] },
  }],
} as PostextConfig);
const markdown = '::::page{template="sheet"}\n# Title on the band\n\n:::frame{slot="under"}\nUnder the band\n:::\n::::\n';

function pageText(pdf: PDFDocument, index: number): string {
  const contents = pdf.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n');
}

describe('the layers of a composed page on a right-to-left page (#876)', () => {
  for (const direction of ['ltr', 'rtl'] as const) {
    it(`${direction}: a text object under the band, the band, then a text object over it`, async () => {
      const doc = buildDocument({ markdown }, config(direction));
      const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider }));
      const ops = pageText(pdf, 0).split(/\s+/);
      // The band's fill colour, #1d5f73.
      const band = ops.findIndex((op, i) => op === 'rg' && Math.abs(Number(ops[i - 3]) - 0x1d / 255) < 0.002 && Math.abs(Number(ops[i - 2]) - 0x5f / 255) < 0.002);
      expect(band).toBeGreaterThan(0);
      const texts = ops.map((op, i) => (op === 'BT' ? i : -1)).filter((i) => i >= 0);
      expect(texts.filter((i) => i < band).length).toBeGreaterThanOrEqual(1);
      expect(texts.filter((i) => i > band).length).toBeGreaterThanOrEqual(1);
    }, 60_000);
  }
});
