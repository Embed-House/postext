import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { preloadResourceImages } from '../pdf-backend/renderResourceBlock';
import { parseFontString } from '../fontString';

// A picture in a composed page's decoration (a ground drawn to the bleed,
// #878) is embedded like a running head's: the PDF used to paint the grey
// placeholder for it and report it as a missing image.

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

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#1d659c"/></svg>',
);
const mm = (value: number) => ({ value, unit: 'mm' as const });
const resources: Resource[] = [{
  id: 'sky', typeId: 'figure', kind: 'svg', caption: '', createdAt: 0, updatedAt: 0,
  svg: { fileId: 'sky.svg', width: 200, height: 100 },
} as Resource];
const config: PostextConfig = {
  locale: 'en-us',
  page: { dpi: 72 },
  header: { elements: [] },
  footer: { elements: [] },
  pageTemplates: [{
    id: 'cover',
    decoration: { elements: [{ kind: 'image', id: 'sky', resourceId: 'sky', decorative: true,
      placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: mm(80) } } }] },
    frames: [{ name: 'title', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { y: mm(90) } } }],
  }],
} as PostextConfig;
const markdown = '::::page{template="cover"}\n# Water on the move\n::::\n';

describe('pictures of a composed page decoration in the PDF (#878)', () => {
  it('are preloaded with the page design slots', async () => {
    const doc = buildDocument({ markdown, resources }, config);
    expect(doc.pages[0]!.composed?.decoration?.blocks.some((b) => b.kind === 'image')).toBe(true);
    const images = await preloadResourceImages(await PDFDocument.create(), doc, (id) => (id === 'sky.svg' ? SVG : undefined));
    expect(images.get('sky.svg')?.kind).toBe('vector');
  });

  it('are painted, not reported as missing', async () => {
    const doc = buildDocument({ markdown, resources }, config);
    const warnings: string[] = [];
    await renderToPdf(doc, {
      fontProvider: async () => new Uint8Array(fontBytes),
      resourceBytes: (id) => (id === 'sky.svg' ? SVG : undefined),
      onWarning: (w) => warnings.push(w.kind),
    });
    expect(warnings).not.toContain('missingImage');
  });
});
