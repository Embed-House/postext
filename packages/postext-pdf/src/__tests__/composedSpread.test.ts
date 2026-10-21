import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument, VDTPage } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #861: a spread template in the PDF is two pages, each painting its share
// of the sheet (clipped to its bleed box); the half of a frame crossing the
// spine that the facing page holds is an artifact there, so the tagged
// text reads it once.

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

const mm = (value: number) => ({ value, unit: 'mm' as const });
const config: PostextConfig = {
  page: { width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  calloutStyles: [{ id: 'band', backgroundEnabled: true, background: { hex: '#f2a65a' } } as never],
  pageTemplates: [{
    id: 'tl',
    spread: true,
    gutter: mm(10),
    grid: { columns: 4, rows: 4, columnGap: mm(12) },
    decoration: { elements: [{ kind: 'box', id: 'card', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(10), y: mm(10) }, size: { width: mm(380), height: mm(240) } }, style: { backgroundColor: { hex: '#ffffff' } } }] } as never,
    frames: [
      { name: 'band', style: 'band', crossGutter: true, grid: { col: 1, row: 1, cols: 4 } },
      { name: 'left', grid: { col: 1, row: 2 } },
      { name: 'right', grid: { col: 4, row: 2 } },
    ],
  }],
};
const markdown = [
  'Before the spread.',
  '',
  '::::page{template="tl" spread}',
  ':::frame{slot="band"}',
  'Band across the spine',
  ':::',
  '',
  ':::frame{slot="left"}',
  'Left card',
  ':::',
  '',
  ':::frame{slot="right"}',
  'Right card',
  ':::',
  '::::',
].join('\n');

interface Elem { type: string; kids: Elem[] }
function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) {
    if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  }
  return elem;
}
const count = (e: Elem, type: string): number => (e.type === type ? 1 : 0) + e.kids.reduce((n, k) => n + count(k, type), 0);
function pageText(pdf: PDFDocument, index: number): string {
  const contents = pdf.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n');
}
async function render(doc: VDTDocument): Promise<{ pdf: PDFDocument; root: Elem }> {
  const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
  const pdf = await PDFDocument.load(bytes);
  const treeRoot = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const k = treeRoot.get(PDFName.of('K'));
  const first = k instanceof PDFArray ? k.get(0) : k;
  return { pdf, root: readElem(pdf, first as PDFRef) };
}

let doc: VDTDocument;
let verso: VDTPage;
let recto: VDTPage;
let out: Awaited<ReturnType<typeof render>>;

beforeAll(async () => {
  doc = buildDocument({ markdown }, config);
  [verso, recto] = doc.pages.filter((p) => p.composed?.spread) as [VDTPage, VDTPage];
  out = await render(doc);
}, 60_000);

describe('a spread template in the PDF (#861)', () => {
  it('writes the sheet as two facing pages after the text before it', () => {
    expect(out.pdf.getPageCount()).toBe(3);
    expect([verso.index, recto.index]).toEqual([1, 2]);
    expect(verso.composed!.spread).toBe('left');
  });

  it('clips each page to its share of the sheet', () => {
    const s = 72 / doc.config.page.dpi;
    for (const page of [verso, recto]) {
      const c = page.composed!.sheetClip!;
      const H = page.height * s;
      const re = [c.x * s, H - (c.y + c.height) * s, c.width * s, c.height * s];
      const ops = pageText(out.pdf, page.index).split(/\s+/);
      const found = ops.some((op, i) => op === 're' && ops[i + 1] === 'W' && ops[i + 2] === 'n'
        && ops.slice(i - 4, i).every((v, j) => Math.abs(Number(v) - re[j]!) < 0.01));
      expect(found).toBe(true);
      expect(ops.filter((o) => o === 'q').length).toBe(ops.filter((o) => o === 'Q').length);
    }
  });

  it('paints the facing half of the band as a layout artifact, so its text is tagged once', async () => {
    const band = recto.composed!.frames.find((f) => f.name === 'band')!;
    expect(band.facingBlocks!.length).toBeGreaterThan(0);
    expect(pageText(out.pdf, recto.index)).toMatch(/\/Artifact\s*<<\s*\/Type\s*\/Layout\s*>>\s*BDC/);
    // Without the copy the structure tree is the same.
    const bare = buildDocument({ markdown }, config);
    for (const p of bare.pages) for (const f of p.composed?.frames ?? []) delete f.facingBlocks;
    const plain = await render(bare);
    expect(count(out.root, 'P')).toBe(count(plain.root, 'P'));
    expect(count(out.root, 'P')).toBeGreaterThan(0);
  });
});
