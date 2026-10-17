import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #955: a vertical label on the mirrored page of a right-to-left book reads
// down its column, upright, at the place its anchor says.

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
  anchors: [{ id: 'tate', x: 0.7, y: 0.2, writingMode: 'vertical-rl', align: 'start', style: 'cjk' }],
};
const config = (direction: 'ltr' | 'rtl'): PostextConfig => ({
  direction,
  locale: 'zh-Hant',
  page: { width: pt(300), height: pt(420), dpi: 72, margins: { top: pt(40), bottom: pt(40), left: pt(30), right: pt(30) } },
  bodyText: { fontFamily: 'Noto Serif TC', fontSize: pt(12) },
  labelStyles: [{ id: 'cjk', fontFamily: 'Noto Serif TC', fontSize: pt(14) }],
});

function pageOps(pdf: PDFDocument): string {
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const s = pdf.context.lookup(ref);
    return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
  }).join('\n');
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/** The text matrices of the content stream with the graphics state's `cm`
 *  applied: where each shown run starts and how it is turned. */
function runs(ops: string): { m: M }[] {
  const out: { m: M }[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  for (const line of ops.split('\n')) {
    const t = line.trim();
    if (t === 'q') stack.push([...ctm] as M);
    else if (t === 'Q') ctm = stack.pop() ?? ctm;
    else if (t.endsWith(' cm')) ctm = mul(t.slice(0, -3).split(/\s+/).map(Number) as M, ctm);
    else if (t.endsWith(' Tm')) out.push({ m: mul(t.slice(0, -3).split(/\s+/).map(Number) as M, ctm) });
  }
  return out;
}

async function render(direction: 'ltr' | 'rtl'): Promise<{ m: M }[]> {
  const markdown = [':::figure{resource="mapa"}', '::label[此開卷第一回]{at="tate"}', ':::', ''].join('\n');
  const doc = buildDocument({ markdown, resources: [MAP] }, config(direction));
  const bytes = await renderToPdf(doc, { fontProvider, resourceBytes: (id: string) => (id === 'mapa.png' ? PNG : undefined) } as never);
  const pdf = await PDFDocument.load(bytes);
  return runs(pageOps(pdf));
}

describe('a vertical figure label on a mirrored page in the PDF (#955)', () => {
  it('shows its cells upright, at the place of the picture the anchor says, as on a left-to-right page', async () => {
    const ltr = await render('ltr');
    const rtl = await render('rtl');
    // The label is the run of upright cells (a quarter turn back inside the
    // label’s quarter turn): first of the page’s text objects.
    const cell = (all: { m: M }[]) => all[0]!.m;
    for (const m of [cell(ltr), cell(rtl)]) {
      expect(m.slice(0, 4)).toEqual([1, 0, 0, 1].map((v) => expect.closeTo(v, 6)));
    }
    // Same height; across, the same fraction of the picture, which the
    // right-to-left page puts against its right margin.
    expect(cell(rtl)[5]).toBeCloseTo(cell(ltr)[5], 3);
    const pictureWidth = (cell(ltr)[4] - 30) / 0.7;
    expect(cell(rtl)[4] - (300 - 30 - pictureWidth)).toBeCloseTo(cell(ltr)[4] - 30, 3);
  }, 60_000);
});
