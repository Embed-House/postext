import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #1058: a map's key in the PDF — its symbols drawn (a glyph, a dashed line
// sample, a picture), its plate outlined, and its rows read as a list in
// the tagged PDF, each symbol read as its name in brackets.

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

// A 1×1 PNG: the map, and the picture of the town symbol.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A political map', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [{ id: 'key', x: 0.05, y: 0.05, align: 'start', verticalAlign: 'top', style: 'key' }],
};
const TOWN: Resource = {
  id: 'town', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'town.png', format: 'png', width: 10, height: 10 },
};
const config: PostextConfig = {
  labelStyles: [{ id: 'key', kind: 'legend', fontSize: pt(9), background: hex('#ffffff'), border: { color: hex('#333333'), width: pt(1) }, radius: pt(2), padding: pt(3) }],
};

interface Elem { type: string; alt?: string; actualText?: string; kids: Elem[] }
function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const text = (key: string): string | undefined => {
    const v = dict.get(PDFName.of(key));
    return v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined;
  };
  const alt = text('Alt');
  const actualText = text('ActualText');
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), ...(alt !== undefined ? { alt } : {}), ...(actualText !== undefined ? { actualText } : {}), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  return elem;
}
const shape = (e: Elem): string => (e.type === 'Figure' ? `Figure[${e.alt}]` : e.type === 'Span' ? `Span[${e.actualText ?? ''}]` : `${e.type}(${e.kids.map(shape).join(' ')})`);

let tree: string;
let content: string;
let images: number;

beforeAll(async () => {
  const markdown = [
    ':::figure{resource="mapa"}',
    ':::label{at="key"}',
    ':icon[Capital]{glyph="o"} Capital',
    ':icon[Border]{line="dashed" color="#8a3b52"} Border',
    ':icon[Town]{resource="town"} Town',
    ':icon[]{line="solid"} Road',
    ':::',
    ':::',
    '',
  ].join('\n');
  const doc = buildDocument({ markdown, resources: [MAP, TOWN] }, config);
  const bytes = await renderToPdf(doc, {
    fontProvider: async () => new Uint8Array(fontBytes),
    accessible: true,
    resourceBytes: (id: string) => (id === 'mapa.png' || id === 'town.png' ? PNG : undefined),
  } as never);
  const pdf = await PDFDocument.load(bytes);
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const top = readElem(pdf, (root.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
  tree = top.kids.map(shape).join(' ');
  const page = pdf.getPages()[0]!;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  content = streams.map((st) => (st instanceof PDFRawStream ? zlib.inflateSync(Buffer.from(st.contents)).toString('latin1') : '')).join('\n');
  images = (content.match(/ Do\b/g) ?? []).length;
}, 60_000);

describe('a legend in the PDF (#1058)', () => {
  it('reads the key as a list after the figure, each symbol as its name in brackets', () => {
    expect(tree).toContain('Figure[A political map] Div(L(LI(LBody(Span[[Capital]])) LI(LBody(Span[[Border]])) LI(LBody(Span[[Town]])) LI(LBody())))');
  });

  it('draws the dashed sample, the picture of the town and the outlined plate', () => {
    // A dash pattern of three and two stroke widths.
    expect(content).toMatch(/\[[\d.]+ [\d.]+\] 0 d/);
    // The map and the town's picture.
    expect(images).toBeGreaterThanOrEqual(2);
    // The plate's rounded outline is a path filled even-odd or stroked.
    expect(content).toMatch(/ c\n/);
  });
});
