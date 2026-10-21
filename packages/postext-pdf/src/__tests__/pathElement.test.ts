import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { DesignElement, PostextConfig } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #1060: a path element of a running head (chevrons beside the part's
// title) and of a composed page's decoration, drawn as vector outlines in
// the PDF and as a Layout artifact of the tagged PDF.

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

const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

const chevrons: DesignElement = {
  kind: 'path', id: 'chevrons', viewBox: [9, 3], fill: hex('#ff0000'),
  d: 'M0 0L1.5 1.5L0 3H1L2.5 1.5L1 0Z M3 0l1.5 1.5L3 3h1l1.5-1.5L4 0z M6 0L7.5 1.5L6 3H7L8.5 1.5L7 0Z',
  placement: { anchor: { to: '#head', edge: 'right-of', at: 'center' }, offset: { x: pt(4) }, size: { width: pt(18), height: pt(6) } },
};
const outline: DesignElement = {
  kind: 'path', id: 'arc', d: 'M0 1A1 1 0 0 1 2 1', viewBox: [2, 1], stroke: hex('#0000ff'), width: pt(2), dash: [pt(3), pt(1)],
  placement: { anchor: { to: 'container', edge: 'top-right' }, size: { width: pt(40), height: pt(20) } },
};
const config: PostextConfig = {
  page: { width: pt(300), height: pt(200), dpi: 72, margins: { top: pt(40), bottom: pt(20), left: pt(20), right: pt(20) } } as never,
  header: { elements: [
    { kind: 'text', id: 'head', content: 'Running head', fontSize: pt(8), placement: { anchor: { to: 'container', edge: 'bottom-left' } } },
    chevrons,
    outline,
  ] } as never,
};

/** The first page's content streams, inflated. */
async function firstPageContent(accessible: boolean): Promise<string> {
  const doc = buildDocument({ markdown: 'Some body text on the first page.' }, config);
  const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible } as never);
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages()[0]!;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((st) => (st instanceof PDFRawStream ? zlib.inflateSync(Buffer.from(st.contents)).toString('latin1') : '')).join('\n');
}

let plain: string;
let tagged: string;
beforeAll(async () => {
  plain = await firstPageContent(false);
  tagged = await firstPageContent(true);
}, 60_000);

describe('path elements in the PDF (#1060)', () => {
  it('fills the chevrons as three closed outlines', () => {
    const at = plain.indexOf('1 0 0 rg');
    expect(at).toBeGreaterThanOrEqual(0);
    const fill = plain.slice(at, plain.indexOf('\nf\n', at) + 3);
    expect(fill.match(/ m\n/g)).toHaveLength(3);
    expect(fill.match(/\nh\n/g)).toHaveLength(3);
  });

  it('strokes the arc as cubic curves with its width and dash, not scaled with the box', () => {
    const at = plain.indexOf('0 0 1 RG');
    expect(at).toBeGreaterThanOrEqual(0);
    const stroke = plain.slice(at, plain.indexOf('\nS\n', at) + 3);
    expect(stroke).toContain('2 w');
    expect(stroke).toContain('[3 1] 0 d');
    expect(stroke.match(/ c\n/g)).toHaveLength(2);
  });

  it('marks both as pagination artifacts in the tagged PDF', () => {
    const first = tagged.indexOf('1 0 0 rg');
    const open = tagged.lastIndexOf('/Artifact', first);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(tagged.slice(open, first)).not.toContain('EMC');
  });
});
