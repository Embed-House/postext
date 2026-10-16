import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #860: a figure's labels drawn on its picture are text in the PDF — read
// after the figure, one paragraph each, their halos and plates artifacts —
// and leave the figure's alternative text.

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

// A 1×1 PNG: the picture the labels stand on.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A map of two islands', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [
    { id: 'velmar', x: 0.3, y: 0.3, style: 'pais' },
    { id: 'rio', x: 0.5, y: 0.6, rotate: 60, style: 'pais' },
  ],
};
const config: PostextConfig = {
  labelStyles: [{ id: 'pais', fontSize: pt(9), halo: { color: hex('#ffffff'), width: pt(1) }, background: hex('#ffeecc') }],
};

interface Elem { type: string; alt?: string; kids: Elem[] }
function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const altObj = dict.get(PDFName.of('Alt'));
  const alt = altObj instanceof PDFHexString || altObj instanceof PDFString ? altObj.decodeText() : undefined;
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), ...(alt !== undefined ? { alt } : {}), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  return elem;
}
const shape = (e: Elem): string => (e.type === 'Figure' ? `Figure[${e.alt}]` : `${e.type}(${e.kids.map(shape).join(' ')})`);

let tree: string;
let content: string;

beforeAll(async () => {
  const markdown = ['Before.', '', ':::figure{resource="mapa"}', '::label[Velmar]{at="velmar"}', '::label[Senne]{at="rio"}', '::label[Nowhere]{at="nada"}', ':::', '', 'After.', ''].join('\n');
  const doc = buildDocument({ markdown, resources: [MAP] }, config);
  const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true, resourceBytes: (id: string) => (id === 'mapa.png' ? PNG : undefined) } as never);
  const pdf = await PDFDocument.load(bytes);
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const top = readElem(pdf, (root.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
  tree = top.kids.map(shape).join(' ');
  // The page's content streams, inflated.
  const contents = pdf.getPages()[0]!.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  content = streams.map((st) => (st instanceof PDFRawStream ? zlib.inflateSync(Buffer.from(st.contents)).toString('latin1') : '')).join('\n');
}, 60_000);

describe('figure labels in the tagged PDF (#860)', () => {
  it('reads the drawn labels after the figure, one paragraph each, and keeps only the undrawn one in its Alt', () => {
    expect(tree).toContain('Figure[A map of two islands (Nowhere)] Div(P() P())');
    expect(tree.indexOf('Div(P() P())')).toBeLessThan(tree.lastIndexOf('P()'));
  });

  it('marks the halo and the plate as artifacts: the words are tagged once', () => {
    // The halo is the glyphs stroked hollow (text render mode 1), inside
    // an artifact.
    const halo = content.indexOf('1 Tr');
    expect(halo).toBeGreaterThan(-1);
    expect(content.lastIndexOf('/Artifact', halo)).toBeGreaterThan(content.lastIndexOf('/P <<', halo));
  });
});
