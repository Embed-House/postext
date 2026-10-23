import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { renderToPdf, type PdfFontProvider } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #1217. Every face was embedded as soon as its file arrived, and pdf-lib
// numbers a font's objects when it is embedded, so the same document came
// out with its font subsets in another order (other bytes) whenever the
// files arrived in another order. The faces are now embedded in the order
// the pages ask for them, however the provider's answers arrive.

const font = (name: string) => fs.readFileSync(new URL(`../../../../apps/web/public/fonts/${name}`, import.meta.url));
const files: Record<string, Buffer> = {
  '400 normal': font('Lora-Regular.ttf'),
  '400 italic': font('Fraunces-Regular.ttf'),
  '700 normal': font('Fraunces-Bold.ttf'),
  '700 italic': font('CormorantGaramond.ttf'),
};
const face = fontkit.create(files['400 normal']!);

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
const config: PostextConfig = {
  page: { width: pt(300), height: pt(420), margins: { top: pt(30), bottom: pt(30), left: pt(24), right: pt(24) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontFamily: 'Lora' },
};

/** A provider whose answers arrive in the order `order` lists the faces. */
function providerAnswering(order: string[]): PdfFontProvider {
  return (_family, weight, style) => {
    const key = `${weight >= 600 ? 700 : 400} ${style}`;
    const delay = 5 * (order.indexOf(key) + 1);
    return new Promise((resolve) => setTimeout(() => resolve(new Uint8Array(files[key]!)), delay));
  };
}

describe('font order in the PDF (#1217)', () => {
  it('writes the same bytes whatever order the font files arrive in', async () => {
    const doc = buildDocument({ markdown: 'Some *italic*, **bold** and ***both*** words.' }, config);
    const order = Object.keys(files);
    const date = new Date('2026-01-01T00:00:00Z');
    const first = await renderToPdf(doc, { fontProvider: providerAnswering(order), date });
    const second = await renderToPdf(doc, { fontProvider: providerAnswering([...order].reverse()), date });
    expect(first.length).toBeGreaterThan(0);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  }, 60_000);
});
