import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { renderToPdf, type PdfWarning } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #1054: a label tab's glyph icon is drawn as text in the PDF, in its own
// colour; a tagged PDF marks it a layout artifact, so the tab's tagged
// content is its words alone; a glyph the face lacks is reported.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const fontProvider = async () => new Uint8Array(fontBytes);
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

// The words in #123456, the glyph in #cc0000 (a bullet, which Lora has).
const config = (glyph: string): PostextConfig => ({
  page: { width: pt(300), height: pt(400), dpi: 72, margins: { top: pt(40), bottom: pt(30), left: pt(30), right: pt(30) } },
  locale: 'en-us',
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontFamily: 'Lora', fontSize: pt(10), lineHeight: pt(14) },
  calloutStyles: [{
    id: 'tab', title: '',
    label: {
      fontFamily: 'Lora', fontSize: pt(10), fontWeight: 400, position: 'top-left', height: pt(14), paddingX: pt(6), offset: pt(7),
      color: hex('#123456'), background: hex('#eeeeee'),
      icon: { kind: 'glyph', glyph, placement: 'inside', gap: pt(3), color: hex('#cc0000') },
    },
  }] as never,
});

function pageContent(pdf: PDFDocument): string {
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const s = pdf.context.lookup(ref);
      return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
    })
    .join('\n');
}

async function render(glyph: string, accessible: boolean): Promise<{ content: string; warnings: PdfWarning[] }> {
  const doc = buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody of the box.\n:::' }, config(glyph));
  const warnings: PdfWarning[] = [];
  const bytes = await renderToPdf(doc, { fontProvider, accessible, onWarning: (w) => warnings.push(w) });
  return { content: pageContent(await PDFDocument.load(bytes)), warnings };
}

/** `#cc0000` and `#123456` as fill colours of the content stream. */
const GLYPH_FILL = /0\.8 0 0 rg/;
const WORDS_FILL = /0\.0\d+ 0\.20\d* 0\.33\d* rg/;

describe('a glyph tab icon in the PDF (#1054)', () => {
  it('draws the glyph as text, in its own colour', async () => {
    const { content, warnings } = await render('•', false);
    const at = content.search(GLYPH_FILL);
    expect(at).toBeGreaterThan(-1);
    // A text object follows the colour: the glyph is shown, not drawn as a path.
    const after = content.slice(at);
    expect(after.indexOf('Tj') === -1 ? after.indexOf('TJ') : after.indexOf('Tj')).toBeGreaterThan(-1);
    expect(content).toMatch(WORDS_FILL);
    expect(warnings.filter((w) => w.kind === 'missingGlyph')).toEqual([]);
  });

  it('marks the glyph a layout artifact in a tagged PDF and tags the words', async () => {
    const { content } = await render('•', true);
    const glyphAt = content.search(GLYPH_FILL);
    const wordsAt = content.search(WORDS_FILL);
    expect(glyphAt).toBeGreaterThan(-1);
    expect(wordsAt).toBeGreaterThan(-1);
    const beforeGlyph = content.slice(0, glyphAt);
    expect(beforeGlyph.lastIndexOf('/Artifact')).toBeGreaterThan(beforeGlyph.lastIndexOf('/MCID'));
    expect(beforeGlyph.slice(beforeGlyph.lastIndexOf('/Artifact'))).toMatch(/^\/Artifact\s*<<[^>]*\/Layout/);
    const beforeWords = content.slice(0, wordsAt);
    expect(beforeWords.lastIndexOf('/MCID')).toBeGreaterThan(beforeWords.lastIndexOf('/Artifact'));
  });

  it('reports a glyph the face does not have', async () => {
    const { warnings } = await render('◉', false);
    const missing = warnings.filter((w) => w.kind === 'missingGlyph');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ family: 'Lora', characters: ['◉'] });
  });
});
