import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const fontProvider = async () => new Uint8Array(fontBytes);
const face = fontkit.create(fontBytes);

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

const pt = (value: number) => ({ value, unit: 'pt' as const });

function pageContent(doc: PDFDocument): string {
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const s = doc.context.lookup(ref);
      return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
    })
    .join('\n');
}

// #1104: a map legend's swatches, set at their own size with an outline and
// rounded corners, and room after them for their label.
const config: PostextConfig = {
  page: { width: pt(220), height: pt(160), margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
  layout: { layoutType: 'single' },
  bodyText: { textAlign: 'left', hyphenation: { enabled: false } },
  colorPalette: [{ id: 'edge', name: 'Edge', value: { hex: '#334455', model: 'hex' } }],
};

const legend = [
  ':swatch{color="#e8b04a" size=10pt border="0.75pt edge" radius=2pt gap=3pt}Farmland',
  '',
  ':swatch{color="#5a9e5a" size=10pt border=none radius=5pt gap=3pt}Forest',
  '',
  ':swatch{color="#7fb2d9"} Water (a plain swatch)',
].join('\n');

describe(':swatch size, border, radius and gap in the PDF (#1104)', () => {
  it('fills and outlines the rounded square, the plain swatch as before', async () => {
    const doc = buildDocument({ markdown: legend }, config);
    const bytes = await renderToPdf(doc, { fontProvider });
    // POSTEXT_PDF_OUT=/path/out.pdf keeps the file for a visual check.
    if (process.env.POSTEXT_PDF_OUT) fs.writeFileSync(process.env.POSTEXT_PDF_OUT, bytes);
    const content = pageContent(await PDFDocument.load(bytes));
    // The farmland fill (#e8b04a) and the palette outline (#334455).
    expect(content).toMatch(/0\.9098\d* 0\.6901\d* 0\.2901\d* rg/);
    expect(content).toMatch(/0\.2 0\.2666\d* 0\.3333\d* RG/);
    // Rounded corners are Bézier curves.
    expect(/ c\n/.test(content)).toBe(true);
    // A stroke of 0.75 pt.
    expect(content).toMatch(/\n0\.75 w\n/);
    expect((content.match(/\bq\b/g) ?? []).length).toBe((content.match(/\bQ\b/g) ?? []).length);
  });
});
