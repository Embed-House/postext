import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #859: a frame whose content goes on on pages added after its composed
// page is one box in the tagged PDF: one Div holding every paragraph, a
// paragraph cut between the pages one P, the continuation mark an
// artifact.

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
const shape = (e: Elem): string => `${e.type}(${e.kids.map(shape).join(' ')})`;

const PARAS = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'word '.repeat(160).trim()} end${i}.`);
const config: PostextConfig = {
  locale: 'en-us',
  page: { width: { value: 150, unit: 'mm' }, height: { value: 200, unit: 'mm' } } as never,
  pageTemplates: [
    {
      id: 't',
      overflowTemplate: 'more',
      frames: [
        { name: 'title', takes: 'h1' },
        { name: 'box', placement: { anchor: { to: '#title', edge: 'below' } }, height: { value: 40, unit: 'mm' }, overflow: { continueIn: 'next-page' } },
      ],
    },
    { id: 'more', frames: [{ name: 'box' }] },
  ],
};
const markdown = ['::::page{template="t"}', '# The page', '', ':::frame{slot="box"}', ...PARAS.flatMap((p) => [p, '']), ':::', '::::', '', 'After the page.'].join('\n');

let doc: VDTDocument;
let root: Elem;
beforeAll(async () => {
  doc = buildDocument({ markdown }, config);
  const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
  const pdf = await PDFDocument.load(bytes);
  const treeRoot = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  root = readElem(pdf, (treeRoot.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
}, 60_000);

describe('a frame continued on added pages in the tagged PDF (#859)', () => {
  it('the box went on over more than one page, a paragraph cut between them', () => {
    const pages = doc.pages.filter((p) => p.composed);
    expect(pages.length).toBeGreaterThan(1);
    const box = (i: number) => pages[i]!.floats!.filter((b) => pages[i]!.composed!.frames.find((f) => f.name === 'box')!.blockIds.includes(b.id) && b.type === 'paragraph');
    // The first piece ends inside a paragraph the next piece opens with.
    expect(box(0)[box(0).length - 1]!.contentIndex).toBe(box(1)[0]!.contentIndex);
  });

  it('reads the box as one Div of its six paragraphs, the title first and the text after the page last', () => {
    expect(root.kids.map(shape)).toEqual([
      'Div(H1())',
      `Div(${PARAS.map(() => 'P()').join(' ')})`,
      'P()',
    ]);
  });
});
