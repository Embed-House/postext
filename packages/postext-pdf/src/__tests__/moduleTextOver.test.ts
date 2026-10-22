import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #1189: a text of a module template is painted after the module's frames
// (a label on its picture shows), left to right and through the mirrored
// flow of a right-to-left page. With `over: false` it is painted with the
// decoration, before the picture.

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
};
const config = (direction: 'ltr' | 'rtl', over?: boolean): PostextConfig => ({
  locale: 'en-us',
  direction,
  header: { elements: [] },
  footer: { elements: [] },
  pageTemplates: [
    { id: 'shell', groups: [{ name: 'body', modules: true, placement: { anchor: { to: 'container', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } } }] },
    {
      id: 'card',
      role: 'module',
      frames: [{ name: 'picture', width: mm(90), height: mm(70), placement: { anchor: { to: 'container', edge: 'top-left' } } }],
      decoration: { elements: [{
        kind: 'text', id: 'label', content: '{attr.label}', fontSize: { value: 10, unit: 'pt' }, color: { hex: '#c0392b', model: 'hex' },
        placement: { anchor: { to: '#picture', edge: 'top-left' }, offset: { x: mm(3), y: mm(3) } }, ...(over === undefined ? {} : { over }),
      }] },
    },
  ],
} as PostextConfig);
const markdown = '::::page{template="shell"}\n:::module{template="card" label="Pond"}\n:::frame{slot="picture"}\n:::figure{resource="plan"}\n:::\n:::\n:::\n::::\n';

async function pageOps(direction: 'ltr' | 'rtl', over?: boolean): Promise<string[]> {
  const doc = buildDocument({ markdown, resources: [PLAN] }, config(direction, over));
  const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider, resourceBytes: (id: string) => (id === 'plan.png' ? PNG : undefined) } as never));
  const contents = pdf.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n').split(/\s+/);
}
/** The first filling colour op of the label's red (#c0392b). */
const red = (ops: string[]): number => ops.findIndex((op, i) => op === 'rg' && Math.abs(Number(ops[i - 3]) - 0xc0 / 255) < 0.002 && Math.abs(Number(ops[i - 2]) - 0x39 / 255) < 0.002);
/** The picture's paint (`/ImN Do`). */
const image = (ops: string[]): number => ops.findIndex((op, i) => op === 'Do' && /^\/Im|^\/I\d|^\/X/.test(ops[i - 1] ?? ''));

describe('a module text in the PDF (#1189)', () => {
  for (const direction of ['ltr', 'rtl'] as const) {
    it(`${direction}: filled after the module's picture by default, before it with over: false`, async () => {
      const ops = await pageOps(direction);
      expect(image(ops)).toBeGreaterThan(0);
      expect(red(ops)).toBeGreaterThan(image(ops));
      const under = await pageOps(direction, false);
      expect(red(under)).toBeGreaterThan(-1);
      expect(red(under)).toBeLessThan(image(under));
    }, 60_000);
  }
});
