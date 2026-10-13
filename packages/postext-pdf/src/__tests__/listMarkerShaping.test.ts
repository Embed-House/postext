import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import fontkit from '@pdf-lib/fontkit';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';
import { paintedGlyphs } from './glyphPositions';

// #770: the marker of a right-to-left list item is measured, and painted on
// the canvas and in the HTML, as one text set right to left. Its runs with
// no letter are pieces of that text there, in the face's default forms; the
// PDF, which draws the marker run by run, shaped each as a word of its own,
// in Latin forms. Amiri bold: `(١)` is 1.501 em wide as the one text
// (Chrome 154: 40.647 px at 27.083 px) and 1.153 em with Latin brackets.

const fontBytes = fs.readFileSync(new URL('./fixtures/arabic/amiri-bold-subset.ttf', import.meta.url));
const fontProvider = async () => new Uint8Array(fontBytes);
const face = fontkit.create(Buffer.from(fontBytes));

class StubCtx {
  font = '';
  letterSpacing = '0px';
  lang = 'inherit';
  direction = 'ltr';
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
const config = (shapingLanguage: 'host' | 'document'): PostextConfig => ({
  locale: 'ar',
  page: { width: pt(300), height: pt(200), dpi: 72, margins: { top: pt(30), bottom: pt(30), left: pt(30), right: pt(30) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontFamily: 'Amiri', fontWeight: 700, fontSize: pt(20), lineHeight: pt(30), textAlign: 'left', hyphenation: { enabled: false }, shapingLanguage },
  orderedLists: { levels: [{ level: 1, numberFormat: 'arabic', prefix: '(', separator: ')' }] } as unknown as PostextConfig['orderedLists'],
});

/** The marker's advance in the PDF, in ems: from its leftmost glyph to the
 *  pen after its rightmost. */
async function markerEms(shapingLanguage: 'host' | 'document'): Promise<number> {
  const doc = buildDocument({ markdown: '1. باب' }, config(shapingLanguage));
  const item = doc.blocks.find((b) => b.type === 'listItem')!;
  expect(item.bulletText).toBe('(١)');
  expect(item.bulletDirection).toBe('rtl-arabic');
  const glyphs = (await paintedGlyphs(await renderToPdf(doc, { fontProvider })))[0]!;
  const marker = glyphs.filter((g) => g.text === '(' || g.text === ')' || g.text === '١');
  expect(marker).toHaveLength(3);
  const left = Math.min(...marker.map((g) => Math.min(g.x, g.end)));
  const right = Math.max(...marker.map((g) => Math.max(g.x, g.end)));
  return (right - left) / marker[0]!.size;
}

describe('the runs of a right-to-left marker in the PDF (#770)', () => {
  it('shaped in its own language: as pieces of the one text the canvas paints', async () => {
    expect(await markerEms('document')).toBeCloseTo(1.501, 2);
  });

  it('keeping its host\'s language: as it was', async () => {
    expect(await markerEms('host')).toBeCloseTo(1.501, 2);
  });
});
