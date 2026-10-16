import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #850: a contents block cut between columns repeats its head row at the
// top of each column it goes on in (`tocEntry.continued` /
// `tocPart.continued`). The repeat is pagination furniture: the tagged PDF
// reads it as an artifact, so the contents keep one `TOCI` per head, and
// it carries no link annotation of its own.

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
  page: {
    width: pt(360), height: pt(260),
    margins: { top: pt(18), bottom: pt(18), left: pt(18), right: pt(18) },
  },
  layout: { layoutType: 'single' },
  locale: 'en-us',
  headings: { levels: [{ level: 1, breakBefore: { enabled: false } }] },
  headingStyles: [{ id: 'front', numbered: false }],
  toc: { levels: [{ level: 1 }, { level: 2 }] },
};

const chapters = (title: string, n: number, sections = 0) => Array.from({ length: n }, (_, i) =>
  `# ${title} ${i + 1}\n\nText.${Array.from({ length: sections }, (_, j) => `\n\n## ${title} ${i + 1}.${j + 1}\n\nText.`).join('')}`).join('\n\n');

interface Elem { type: string; kids: Elem[]; contents?: string }

const textOf = (v: unknown): string | undefined => (v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined);

function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) {
    if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
    else if (kid instanceof PDFDict && (kid.get(PDFName.of('Type')) as PDFName | undefined)?.decodeText() === 'OBJR') {
      elem.contents = textOf(kid.lookup(PDFName.of('Obj'), PDFDict).get(PDFName.of('Contents')));
    }
  }
  return elem;
}


async function tagged(doc: VDTDocument): Promise<{ root: Elem; links: number }> {
  const bytes = await renderToPdf(doc, { fontProvider });
  const pdf = await PDFDocument.load(bytes);
  const treeRoot = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const root = readElem(pdf, (treeRoot.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
  let links = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    for (const a of annots?.asArray() ?? []) {
      const dict = pdf.context.lookup(a, PDFDict);
      if ((dict.get(PDFName.of('Subtype')) as PDFName | undefined)?.decodeText() === 'Link') links++;
    }
  }
  return { root, links };
}

const continued = (doc: VDTDocument) => doc.blocks.filter((b) => b.tocEntry?.continued || b.tocPart?.continued);
const listed = (doc: VDTDocument) => doc.blocks.filter((b) => (b.tocEntry || b.tocPart) && !b.tocEntry?.continued && !b.tocPart?.continued);

describe('repeated contents head rows in the tagged PDF (#850)', () => {
  it('reads a repeated part row as an artifact: one TOCI per row of the contents', async () => {
    const markdown = `# Contents {style="front" toc="false"}\n\n:::toc{keep="part" levels="1"}\n\n:::part{number="I" title="Long"}\n:::\n\n${chapters('Chapter', 30)}`;
    const doc = buildDocument({ markdown, metadata: { title: 'Kept contents' } }, config);
    expect(continued(doc).length).toBeGreaterThan(0);
    const { root, links } = await tagged(doc);
    const tocs = root.kids.filter((k) => k.type === 'TOC');
    expect(tocs).toHaveLength(1);
    const items = tocs[0]!.kids;
    expect(items.every((k) => k.type === 'TOCI')).toBe(true);
    expect(items).toHaveLength(listed(doc).length);
    expect(items.filter((k) => JSON.stringify(k).includes('Long'))).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain('(cont.)');
    expect(links).toBe(items.length);
  }, 60_000);

  it('does the same for a repeated numbered entry row', async () => {
    const markdown = `# Contents {style="front" toc="false"}\n\n:::toc{keep="1" levels="1-2"}\n\n${chapters('Chapter', 2, 18)}`;
    const doc = buildDocument({ markdown, metadata: { title: 'Kept contents' } }, config);
    const repeats = continued(doc);
    expect(repeats.length).toBeGreaterThan(0);
    expect(repeats.every((b) => b.tocEntry?.continued && b.lines.some((l) => l.text.includes('(cont.)')))).toBe(true);
    const { root, links } = await tagged(doc);
    const items = root.kids.find((k) => k.type === 'TOC')!.kids;
    expect(items.every((k) => k.type === 'TOCI')).toBe(true);
    expect(items).toHaveLength(listed(doc).length);
    expect(JSON.stringify(items)).not.toContain('(cont.)');
    expect(links).toBe(items.length);
  }, 60_000);
});
