import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFBool, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import UPNG from '@pdf-lib/upng';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';

// #995: a label tab's picture painted in the label's text colour. A vector
// drawing is recoloured (its own Form XObject), a bitmap is painted through
// a stencil of its alpha; a picture without the tint is left as it is.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const fontProvider = async () => new Uint8Array(fontBytes);

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

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><circle cx="5" cy="5" r="4" fill="#ff0000"/><rect x="11" y="1" width="8" height="8" fill="none" stroke="#00aa00" stroke-width="1"/></svg>');
// A 4 × 2 PNG: the left half opaque, the right half transparent.
const rgba = new Uint8Array(4 * 2 * 4);
for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) rgba.set(x < 2 ? [200, 20, 20, 255] : [200, 20, 20, 0], (y * 4 + x) * 4);
const PNG = new Uint8Array(UPNG.encode([rgba.buffer as ArrayBuffer], 4, 2, 0));

const svgRing: Resource = { id: 'ring', typeId: 'figure', kind: 'svg', altText: '', createdAt: 0, updatedAt: 0, svg: { fileId: 'ring.svg', width: 20, height: 10 } };
const bitmapRing: Resource = { id: 'ring', typeId: 'figure', kind: 'bitmap', altText: '', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'ring.png', format: 'png', width: 4, height: 2 } };

const config = (tint: boolean): PostextConfig => ({
  page: { width: pt(300), height: pt(400), dpi: 72, margins: { top: pt(40), bottom: pt(30), left: pt(30), right: pt(30) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14) },
  calloutStyles: [{
    id: 'tab', title: '',
    label: { fontSize: pt(10), fontWeight: 400, position: 'top-left', height: pt(14), paddingX: pt(6), offset: pt(7), color: { hex: '#123456', source: 'custom' }, icon: { resourceId: 'ring', width: pt(16), gap: pt(3), placement: 'inside', tint } },
  }] as never,
});

interface Rendered {
  /** The page's content stream. */
  page: string;
  /** The content streams of the Form XObjects. */
  forms: string[];
  /** The image XObjects' dictionaries have `ImageMask true`. */
  stencils: number;
}

async function render(resource: Resource, tint: boolean): Promise<Rendered> {
  const doc = buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody of the box.\n:::', resources: [resource] }, config(tint));
  const bytes = await renderToPdf(doc, { fontProvider, accessible: false, resourceBytes: (id) => (id === 'ring.svg' ? SVG : id === 'ring.png' ? PNG : undefined) });
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const decode = (stream: PDFRawStream): string => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  const page = refs.map((ref) => decode(pdf.context.lookup(ref) as PDFRawStream)).join('');
  const forms: string[] = [];
  let stencils = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Form')) forms.push(decode(obj));
    if (subtype === PDFName.of('Image') && obj.dict.get(PDFName.of('ImageMask')) === PDFBool.True) stencils++;
  }
  return { page, forms, stencils };
}

/** `#123456` as the content stream writes it. */
const TINT = /0\.0\d+ 0\.20\d* 0\.33\d* (rg|RG)/;

describe('label.icon.tint in the PDF (#995)', () => {
  it('recolours a vector picture: its fill and its stroke take the label colour', async () => {
    const tinted = await render(svgRing, true);
    expect(tinted.forms.length).toBeGreaterThan(0);
    const form = tinted.forms.join('\n');
    expect(form).toMatch(/0\.0\d+ 0\.20\d* 0\.33\d* rg/);
    expect(form).toMatch(/0\.0\d+ 0\.20\d* 0\.33\d* RG/);
    // Neither of its own colours is left.
    expect(form).not.toMatch(/\b1 0 0 rg/);
    expect(form).not.toMatch(/\b0 (0\.6\d*|0\.67\d*) 0 (rg|RG)/);
  });

  it('leaves the picture as it is without the tint', async () => {
    const plain = await render(svgRing, false);
    const form = plain.forms.join('\n');
    expect(form).toMatch(/\b1 0 0 rg/);
    expect(form).not.toMatch(TINT);
  });

  it('paints a bitmap through a stencil of its alpha, filled with the label colour', async () => {
    const tinted = await render(bitmapRing, true);
    expect(tinted.stencils).toBe(1);
    expect(tinted.page).toMatch(/0\.0\d+ 0\.20\d* 0\.33\d* rg[\s\S]*?\/Image[\w-]* Do/);
  });

  it('writes no stencil for a bitmap left in its own colours', async () => {
    const plain = await render(bitmapRing, false);
    expect(plain.stencils).toBe(0);
  });
});
