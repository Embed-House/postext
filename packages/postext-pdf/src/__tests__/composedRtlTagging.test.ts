import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildDocument, resolveParagraph } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';
import { complexShaperReady, shapeRun } from '../complexShaping.js';

// #900: on a right-to-left page a picture is painted turned back in its
// box (`counterFlipPx`), and the graphics state pushed for that closed the
// figure's marked content, so the picture was painted untagged and the
// page failed PDF/UA-1 7.1-3: an Arabic composed page (a `takes: h1` title
// frame and a frame holding a `:::figure` with labels) did, and so did a
// figure in the flow of any right-to-left page.

const AMIRI = new Uint8Array(fs.readFileSync(new URL('./fixtures/arabic/amiri-subset.ttf', import.meta.url)));
const fontProvider = async () => AMIRI;

class HarfBuzzCtx {
  font = '';
  measureText(s: string): { width: number } {
    const sizePx = parseFontString(this.font)?.sizePx ?? 16;
    const run = complexShaperReady() ? shapeRun(AMIRI, s, { direction: (resolveParagraph(s).paragraphLevel === 1 ? 'rtl' : 'ltr') }) : undefined;
    if (!run) return { width: s.length * sizePx * 0.5 };
    return { width: (run.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) / run.upem) * sizePx };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): HarfBuzzCtx {
    return new HarfBuzzCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
));
const map: Resource = {
  id: 'map', typeId: 'map', kind: 'bitmap', caption: '', altText: 'خريطة', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'map.png', format: 'png', width: 1600, height: 1100 },
};

function config(): PostextConfig {
  return {
    direction: 'rtl',
    locale: 'ar',
    page: { width: mm(170), height: mm(130), dpi: 72, margins: { top: mm(8), bottom: mm(8), left: mm(8), right: mm(8) } },
    layout: { layoutType: 'single' },
    bodyText: { fontFamily: 'Amiri', fontSize: pt(10), lineHeight: pt(16), hyphenation: { enabled: false } },
    headings: { levels: [{ level: 1, fontFamily: 'Amiri', fontSize: pt(16), lineHeight: pt(24), breakBefore: { enabled: false } }] },
    header: { elements: [] },
    footer: { elements: [] },
    // A map with no number and no caption, as the #900 book has (the
    // fixture font holds the test sentences' letters only).
    resourceTypes: [{ id: 'map', name: 'Map', shortLabel: 'Map', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }],
    pageTemplates: [{
      id: 'map',
      header: false,
      frames: [
        { name: 'title', takes: 'h1', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(8), y: mm(5) } }, width: mm(154) },
        { name: 'map', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(8), y: mm(18) } }, width: mm(154) },
      ],
    }],
  } as PostextConfig;
}

/** The page's content stream, decoded. */
function pageContent(pdf: PDFDocument, index: number): string {
  const contents = pdf.getPage(index).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return refs
    .map((ref) => {
      const s = pdf.context.lookup(ref);
      return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
    })
    .join('\n');
}

/** The painting operators (`Do`, text objects) found outside any marked
 *  content sequence: neither tagged nor an artifact. */
function unmarked(content: string): string[] {
  let depth = 0;
  const found: string[] = [];
  for (const line of content.split('\n')) {
    const op = line.trim().split(/\s+/).pop();
    if (op === 'BDC' || op === 'BMC') depth++;
    else if (op === 'EMC') depth--;
    else if ((op === 'Do' || op === 'BT') && depth === 0) found.push(line.trim());
  }
  return found;
}

const hasVerapdf = process.env.VERAPDF === '1' && spawnSync('verapdf', ['--version'], { encoding: 'utf8' }).status === 0;

async function ua1(bytes: Uint8Array): Promise<string> {
  const file = path.join(os.tmpdir(), `postext-rtl-ua-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  const out = spawnSync('verapdf', ['--flavour', 'ua1', '--format', 'text', file], { encoding: 'utf8' });
  fs.unlinkSync(file);
  return out.stdout;
}

const composedMarkdown = [
  '::::page{template="map"}',
  '# السلام عليكم',
  '',
  ':::figure{resource="map" slot="map"}',
  '::label[السلام]{at="20% 30%"}',
  '::label[عليكم]{at="70% 60%"}',
  ':::',
  '::::',
].join('\n');

let composed: Uint8Array;
let flow: Uint8Array;

beforeAll(async () => {
  // Load HarfBuzz for the measurement too: one render first.
  const warm = buildDocument({ markdown: '# السلام' }, config());
  await renderToPdf(warm, { fontProvider, accessible: true });
  const doc = buildDocument({ markdown: composedMarkdown, resources: [map] }, config());
  expect(doc.pages).toHaveLength(1);
  expect(doc.pages[0]!.composed?.frames.map((f) => f.name)).toEqual(['title', 'map']);
  composed = await renderToPdf(doc, { fontProvider, accessible: true, resourceBytes: () => PNG });
  const flowDoc = buildDocument({ markdown: '# السلام عليكم\n\nالسلام عليكم.\n\n::resource{id="map"}\n\nعليكم السلام.', resources: [map] }, config());
  flow = await renderToPdf(flowDoc, { fontProvider, accessible: true, resourceBytes: () => PNG });
}, 60_000);

describe('a picture on a right-to-left page is tagged (#900)', () => {
  it('paints the figure of an Arabic composed page inside marked content', async () => {
    const pdf = await PDFDocument.load(composed);
    const content = pageContent(pdf, 0);
    expect(content).toMatch(/ Do$/m);
    expect(unmarked(content)).toEqual([]);
  });

  it('paints a figure of a right-to-left flow inside marked content', async () => {
    const pdf = await PDFDocument.load(flow);
    for (let i = 0; i < pdf.getPageCount(); i++) expect(unmarked(pageContent(pdf, i))).toEqual([]);
  });

  it.skipIf(!hasVerapdf)('passes veraPDF (PDF/UA-1): the Arabic composed page with labels', async () => {
    expect(await ua1(composed)).toMatch(/^PASS /m);
  }, 120_000);

  it.skipIf(!hasVerapdf)('passes veraPDF (PDF/UA-1): a figure in a right-to-left flow', async () => {
    expect(await ua1(flow)).toMatch(/^PASS /m);
  }, 120_000);
});
