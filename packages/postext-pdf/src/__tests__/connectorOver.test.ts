import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #1076: a connector that ends at an anchor of a picture is painted after
// every frame, so the line shows over the picture's frame at its default
// layer; left to right and through the mirrored flow of a right-to-left
// page; a Layout artifact in a tagged PDF. With `over: false` it is
// painted with the decoration, before the picture.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const face = fontkit.create(fontBytes);
const fontProvider = async () => new Uint8Array(fontBytes);
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
const mm = (value: number) => ({ value, unit: 'mm' as const });
const PLAN: Resource = {
  id: 'plan', typeId: 'figure', kind: 'bitmap', altText: 'A plan of a garden', caption: '', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'plan.png', format: 'png', width: 400, height: 300 },
  anchors: [{ id: 'pond', x: 0.4, y: 0.5 }],
};
const config = (direction: 'ltr' | 'rtl', over?: boolean): PostextConfig => ({
  locale: 'en-us',
  direction,
  header: { elements: [] },
  footer: { elements: [] },
  pageTemplates: [{
    id: 'plan',
    frames: [
      { name: 'note', width: mm(40), height: mm(20), placement: { anchor: { to: 'container', edge: 'top-left' } } },
      { name: 'picture', width: mm(90), height: mm(70), placement: { anchor: { to: 'container', edge: 'top-right' } } },
    ],
    decoration: { elements: [{
      kind: 'connector', id: 'pointer', routing: 'straight', from: { to: '#note', side: 'end' }, to: { to: '#picture', anchor: 'pond' },
      endCap: 'dot', color: { hex: '#c0392b', model: 'hex' }, ...(over === undefined ? {} : { over }),
    }] },
  }],
} as PostextConfig);
const markdown = '::::page{template="plan"}\n:::frame{slot="note"}\nThe pond\n:::\n:::frame{slot="picture"}\n:::figure{resource="plan"}\n:::\n:::\n::::\n';

async function pageOps(direction: 'ltr' | 'rtl', over?: boolean, accessible = false): Promise<string[]> {
  const doc = buildDocument({ markdown, resources: [PLAN] }, config(direction, over));
  const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider, accessible, resourceBytes: (id: string) => (id === 'plan.png' ? PNG : undefined) } as never));
  const contents = pdf.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n').split(/\s+/);
}
/** The first stroking colour op of the pointer's red (#c0392b). */
const red = (ops: string[]): number => ops.findIndex((op, i) => op === 'RG' && Math.abs(Number(ops[i - 3]) - 0xc0 / 255) < 0.002 && Math.abs(Number(ops[i - 2]) - 0x39 / 255) < 0.002);
/** The picture's paint (`/ImN Do`). */
const image = (ops: string[]): number => ops.findIndex((op, i) => op === 'Do' && /^\/Im|^\/I\d|^\/X/.test(ops[i - 1] ?? ''));

describe('a connector into a picture in the PDF (#1076)', () => {
  for (const direction of ['ltr', 'rtl'] as const) {
    it(`${direction}: stroked after the picture by default, before it with over: false`, async () => {
      const ops = await pageOps(direction);
      expect(image(ops)).toBeGreaterThan(0);
      expect(red(ops)).toBeGreaterThan(image(ops));
      const under = await pageOps(direction, false);
      expect(red(under)).toBeGreaterThan(-1);
      expect(red(under)).toBeLessThan(image(under));
    }, 60_000);
  }

  it('is a Layout artifact in a tagged PDF', async () => {
    const ops = await pageOps('ltr', undefined, true);
    const at = red(ops);
    expect(at).toBeGreaterThan(image(ops));
    // An artifact opened after the picture and still open at the stroke.
    const open = ops.lastIndexOf('/Artifact', at);
    expect(open).toBeGreaterThan(image(ops));
    expect(ops.slice(open, at)).not.toContain('EMC');
  }, 60_000);
});
