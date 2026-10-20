import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument, figureLabelLeaderPath } from 'postext';
import type { PostextConfig, Resource, VDTBlock } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #1057: a label set away from its point draws its leader in the PDF as
// vector lines with a dot on the point, under the label, a layout artifact
// in the tagged PDF (the label's words are still read once).

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

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A map', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [{ id: 'lake', x: 0.3, y: 0.7, labelAt: { x: 0.7, y: 0.25 }, style: 'name', leader: true }],
};
const config: PostextConfig = {
  labelStyles: [{ id: 'name', fontSize: pt(9), leader: { color: hex('#7a3b10'), width: pt(1) } }],
};

let content: string;
let tree: string;
let block: VDTBlock;

interface Elem { type: string; kids: Elem[] }
function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  return elem;
}
const shape = (e: Elem): string => (e.kids.length ? `${e.type}(${e.kids.map(shape).join(' ')})` : e.type);

beforeAll(async () => {
  const doc = buildDocument({ markdown: ':::figure{resource="mapa"}\n::label[Lake Orla]{at="lake"}\n:::\n', resources: [MAP] }, config);
  block = [...doc.blocks, ...doc.pages.flatMap((p) => [...p.columns.flatMap((c) => c.blocks), ...(p.floats ?? [])])].find((b) => b.resourceBlock?.labels)!;
  const bytes = await renderToPdf(doc, {
    fontProvider: async () => new Uint8Array(fontBytes),
    accessible: true,
    resourceBytes: (id: string) => (id === 'mapa.png' ? PNG : undefined),
  } as never);
  const pdf = await PDFDocument.load(bytes);
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  tree = shape(readElem(pdf, (root.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef));
  const page = pdf.getPages()[0]!;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  content = streams.map((st) => (st instanceof PDFRawStream ? zlib.inflateSync(Buffer.from(st.contents)).toString('latin1') : '')).join('\n');
}, 60_000);

describe('a label leader in the PDF (#1057)', () => {
  it('strokes the line in its colour and width and fills a dot on the point, as an artifact before the label', () => {
    const rb = block.resourceBlock!;
    const path = figureLabelLeaderPath(rb.labels![0]!.layout!, block.bbox.x + rb.bodyRect.x, block.bbox.y + rb.bodyRect.y);
    expect(path).toBeDefined();
    // The leader's colour (#7a3b10) as a stroking colour, a 1 pt width.
    expect(content).toMatch(/0\.478\d* 0\.231\d* 0\.0627?\d* RG/);
    expect(content).toMatch(/ RG\n(0\.99\d*|1) w\n[\d.]+ [\d.]+ m\n[\d.]+ [\d.]+ l\nS\n/);
    const stroke = content.search(/ RG\n/);
    // A dot is four curves, filled.
    expect(content.slice(stroke)).toMatch(/( c\n[^]*){4}h?\n?f/);
    // Marked as a layout artifact, before the label's words.
    expect(content.slice(0, stroke)).toMatch(/\/Artifact <<\n\/Type \/Layout\n>> BDC\nq\n[^\n]*$/);
    expect(content.indexOf('Tj', stroke) > stroke || content.indexOf('TJ', stroke) > stroke).toBe(true);
  });

  it('leaves the structure as it was: the figure and its label read once', () => {
    expect(tree).toContain('Figure');
    expect((tree.match(/\bP\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
