import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #902: a label set in vertical writing is drawn as a vertical page's flow
// is, its characters upright in their cells through an Identity-V twin of
// the font, down a column turned by the label's matrix.

const FIXTURES = new URL('./fixtures/cjk/', import.meta.url);
const TC = new Uint8Array(fs.readFileSync(new URL('noto-serif-tc-vertical.ttf', FIXTURES)));
const face = fontkit.create(Buffer.from(TC));
const fontProvider = async () => TC;

class StubCtx {
  font = '';
  letterSpacing = '0px';
  measureText(s: string) {
    const f = parseFontString(this.font);
    const run = face.layout(s);
    const k = (f?.sizePx ?? 16) / face.unitsPerEm;
    let w = 0;
    for (const p of run.positions) w += p.xAdvance;
    const b = run.glyphs[0]?.bbox;
    return {
      width: w * k,
      actualBoundingBoxAscent: b ? b.maxY * k : 0,
      actualBoundingBoxDescent: b ? -b.minY * k : 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: w * k,
    };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const pt = (value: number) => ({ value, unit: 'pt' as const });
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A map', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [
    { id: 'tate', x: 0.7, y: 0.2, writingMode: 'vertical-rl', align: 'start', style: 'cjk' },
    { id: 'yoko', x: 0.3, y: 0.7, style: 'cjk' },
  ],
};
const config: PostextConfig = {
  locale: 'zh-Hant',
  page: { width: pt(300), height: pt(420), dpi: 72, margins: { top: pt(40), bottom: pt(40), left: pt(30), right: pt(30) } },
  bodyText: { fontFamily: 'Noto Serif TC', fontSize: pt(12) },
  labelStyles: [{ id: 'cjk', fontFamily: 'Noto Serif TC', fontSize: pt(14) }],
};

function pageOps(pdf: PDFDocument): string {
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const s = pdf.context.lookup(ref);
    return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
  }).join('\n');
}

describe('vertical figure labels in the PDF (#902)', () => {
  it('shows a vertical label through an Identity-V twin, upright in a frame turned a quarter turn', async () => {
    const markdown = [':::figure{resource="mapa"}', '::label[此開卷第一回]{at="tate"}', '::label[横書き]{at="yoko"}', ':::', ''].join('\n');
    const doc = buildDocument({ markdown, resources: [MAP] }, config);
    const bytes = await renderToPdf(doc, { fontProvider, resourceBytes: (id: string) => (id === 'mapa.png' ? PNG : undefined) } as never);
    const pdf = await PDFDocument.load(bytes);
    const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const encodings = [...fonts.entries()].map(([, ref]) => String(pdf.context.lookup(ref as PDFRef, PDFDict).get(PDFName.of('Encoding'))));
    // The horizontal label is shown through the font as it is; the vertical
    // one through its twin.
    expect(encodings).toContain('/Identity-V');
    expect(encodings).toContain('/Identity-H');
    const ops = pageOps(pdf);
    // An upright cell run: a text matrix of a quarter turn back.
    expect(ops).toMatch(/0 1 -1 0 [-\d.]+ [-\d.]+ Tm/);
  }, 60_000);
});
