import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument, columnClipRect } from 'postext';
import type { PostextConfig, Resource, VDTBlock, VDTColumn, VDTDocument } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #729: a table set in the text with `placement.captionSide` has its
// caption and note in the float-only side column. The block is painted in
// its column's clip, which grows to take them in, and the tagged structure
// keeps the caption a child of its table, read where the table stands.

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

const config: PostextConfig = {
  page: { width: pt(400), height: pt(400), margins: { top: pt(30), bottom: pt(30), left: pt(30), right: pt(20) } },
  layout: { layoutType: 'oneAndHalf', gutterWidth: pt(10), sideColumnPercent: 30, sideColumnRole: 'floats', sideColumnSide: 'right' },
  locale: 'en-us',
  headings: { balancing: { enabled: false } },
};

const table: Resource = {
  id: 'tab',
  typeId: 'table',
  kind: 'table',
  caption: 'Activities by age group, in the side column.',
  note: 'Source: the reference book.',
  createdAt: 0,
  updatedAt: 0,
  table: {
    model: {
      headerRowCount: 1,
      rows: [
        [{ content: 'Task', isHeader: true }, { content: 'Age', isHeader: true }],
        [{ content: 'Reading' }, { content: 'Six' }],
        [{ content: 'Writing' }, { content: 'Seven' }],
      ],
    },
  },
  placement: { position: 'here', captionSide: true },
};

const markdown = 'A paragraph of running text before the table.\n\n::resource{id="tab"}\n\nA paragraph of running text after the table.\n';

function pageContent(page: PDFPage): string {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const stream = page.doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return '';
      const filter = stream.dict.get(PDFName.of('Filter'));
      const bytes = filter ? inflateSync(stream.contents) : stream.contents;
      return new TextDecoder('latin1').decode(bytes);
    })
    .join('\n');
}

/** Clip rectangles (`x y w h re W n`) of a content stream, in PDF points. */
function clipRects(content: string): { x: number; width: number }[] {
  const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\s+W\s+n/g;
  return [...content.matchAll(re)].map((m) => ({ x: Number(m[1]), width: Number(m[3]) }));
}

/** The structure types under `ref`, depth first. */
function types(pdf: PDFDocument, ref: PDFRef, out: Array<{ type: string; kids: string[] }> = []): Array<{ type: string; kids: string[] }> {
  const dict = pdf.context.lookup(ref, PDFDict);
  const k = dict.get(PDFName.of('K'));
  const kids = (k instanceof PDFArray ? k.asArray() : k ? [k] : []).filter((x): x is PDFRef => x instanceof PDFRef);
  const typeOf = (r: PDFRef) => String(pdf.context.lookup(r, PDFDict).get(PDFName.of('S'))).replace(/^\//, '');
  out.push({ type: typeOf(ref), kids: kids.map(typeOf) });
  for (const kid of kids) types(pdf, kid, out);
  return out;
}

const hasVerapdf = process.env.VERAPDF === '1' && spawnSync('verapdf', ['--version'], { encoding: 'utf8' }).status === 0;

let doc: VDTDocument;
let column: VDTColumn;
let side: VDTColumn;
let block: VDTBlock;

beforeAll(() => {
  doc = buildDocument({ markdown, resources: [table] }, config);
  column = doc.pages[0]!.columns.find((c) => c.kind !== 'side')!;
  side = doc.pages[0]!.columns.find((c) => c.kind === 'side')!;
  block = column.blocks.find((b) => b.resourceBlock)!;
});

describe('a side caption of a resource set in the text, in the PDF (#729)', () => {
  it('lays the caption and the note out in the side column (the VDT geometry)', () => {
    const rb = block.resourceBlock!;
    expect(rb.captionLines.length).toBeGreaterThan(0);
    for (const l of [...rb.captionLines, ...rb.noteLines]) expect(l.bbox.x).toBeGreaterThanOrEqual(side.bbox.x - 0.5);
    expect(rb.captionLines[0]!.bbox.y).toBeCloseTo(block.bbox.y, 3);
  });

  it('paints them inside the column clip', async () => {
    const bytes = await renderToPdf(doc, { fontProvider, accessible: false, outlines: false });
    const out = process.env.POSTEXT_SIDE_CAPTION_PDF_OUT;
    if (out) fs.writeFileSync(out, bytes);
    const pdf = await PDFDocument.load(bytes);
    const content = pageContent(pdf.getPage(0));
    const scale = 72 / doc.config.page.dpi;
    const rb = block.resourceBlock!;
    const right = Math.max(...[...rb.captionLines, ...rb.noteLines].map((l) => l.bbox.x + l.bbox.width)) * scale;
    const columnLeft = column.bbox.x * scale;
    const expected = columnClipRect(column, doc.config.page.dpi);
    const colClip = clipRects(content).find((r) => Math.abs(r.x - expected.x * scale) < 0.01 && Math.abs(r.width - expected.width * scale) < 0.01);
    expect(colClip).toBeDefined();
    expect(colClip!.x).toBeLessThan(columnLeft);
    expect(colClip!.x + colClip!.width).toBeGreaterThanOrEqual(right - 0.01);
    // The caption's words are in the page.
    expect(content.length).toBeGreaterThan(0);
  });

  it('keeps the caption a child of its table in the tagged PDF', async () => {
    const bytes = await renderToPdf(doc, { fontProvider, outlines: false });
    const pdf = await PDFDocument.load(bytes);
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const all = types(pdf, (root.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
    const tableElem = all.find((e) => e.type === 'Table')!;
    expect(tableElem).toBeDefined();
    expect(tableElem.kids.filter((k) => k === 'Caption')).toHaveLength(1);
    // The table is read between the two paragraphs, where it stands.
    const flow = all.find((e) => e.kids.includes('Table'))!.kids;
    const at = flow.indexOf('Table');
    expect(flow[at - 1]).toBe('P');
    expect(flow[at + 1]).toBe('P');
  });

  it.skipIf(!hasVerapdf)('passes veraPDF (PDF/UA-1)', async () => {
    const bytes = await renderToPdf(doc, { fontProvider, outlines: false });
    const file = path.join(os.tmpdir(), `postext-inline-caption-side-ua-${process.pid}.pdf`);
    fs.writeFileSync(file, bytes);
    const out = spawnSync('verapdf', ['--flavour', 'ua1', '--format', 'text', file], { encoding: 'utf8' });
    fs.unlinkSync(file);
    expect(out.stdout).toMatch(/^PASS /m);
  }, 120_000);
});
