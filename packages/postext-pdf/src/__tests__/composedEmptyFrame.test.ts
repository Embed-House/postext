import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #1084: a `:::frame` fence with nothing in it, for a frame with a callout
// style, draws the style's fill, border and tab (with its label) in the PDF.

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
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const config: PostextConfig = {
  page: { width: mm(200), height: mm(260), dpi: 72, margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontFamily: 'Lora' },
  calloutStyles: [{
    id: 'caja', backgroundEnabled: true, background: hex('#ffeb99'),
    border: { enabled: true, color: hex('#222222') }, padding: { top: mm(3), right: mm(5), bottom: mm(3), left: mm(5) },
    label: { color: hex('#ffffff'), background: hex('#333333'), height: mm(6), paddingX: mm(3), fontFamily: 'Lora' },
  }],
  pageTemplates: [{
    id: 't',
    frames: [{ name: 'caja', style: 'caja', width: mm(100), minHeight: mm(30), placement: { anchor: { to: 'container', edge: 'top-left' } } }],
  }],
} as PostextConfig;
const markdown = (fence: string) => ['::::page{template="t"}', '', fence, ':::', '', '::::'].join('\n');

async function contentOf(doc: VDTDocument): Promise<string> {
  const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: false }));
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const s = pdf.context.lookup(ref);
      return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
    })
    .join('\n');
}

/** Each fill colour set (`r g b rg`), as hex. */
const fills = (content: string): string[] =>
  [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) => `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('')}`);
const strokes = (content: string): string[] =>
  [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) RG/g)].map((m) => `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('')}`);

describe('an empty styled frame in the PDF (#1084)', () => {
  it('paints the fill, the border and the tab with its word', async () => {
    const content = await contentOf(buildDocument({ markdown: markdown(':::frame{slot="caja" label="Tab"}') }, config));
    expect(fills(content)).toEqual(expect.arrayContaining(['#ffeb99', '#333333', '#ffffff']));
    expect(strokes(content)).toContain('#222222');
    expect(content).toMatch(/\bTJ|\bTj/);
  });

  it('a fence without a label: the box, no text', async () => {
    const content = await contentOf(buildDocument({ markdown: markdown(':::frame{slot="caja"}') }, config));
    expect(fills(content)).toContain('#ffeb99');
    expect(fills(content)).not.toContain('#333333');
    expect(content).not.toMatch(/\bTJ|\bTj/);
  });
});
