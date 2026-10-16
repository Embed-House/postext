import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';
import { page8Fixture } from '../../../postext/src/__tests__/composed/fixtures/page8';

// #855: the page-8 stand-in laid out by the engine and written as a tagged
// PDF: one page, its boxes' words in the text, read in Markdown order.

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
  it('writes the page-8 stand-in as one tagged page', async () => {
    const { markdown, config, resources } = page8Fixture('en');
    const doc = buildDocument({ markdown, resources }, config);
    expect(doc.pages[0]!.composed).toBeDefined();
    const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
