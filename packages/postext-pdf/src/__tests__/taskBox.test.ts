import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTBlock } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// #765: the box of a task item is drawn with path operators. The PDF shows
// no text for it and asks no face for the character; in a tagged file the
// item's `Lbl` reads as the character the box stands for.

const BOX = '\u2610';
const TICKED = '\u2611';

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
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
const config = (extra: Partial<PostextConfig> = {}): PostextConfig => ({
  page: { dpi: 72, width: pt(300), height: pt(400), margins: { top: pt(24), bottom: pt(24), left: pt(24), right: pt(24) } },
  locale: 'en-us',
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  ...extra,
});

const MD = ['A list of things to do:', '', '- [ ] Buy the paper', '- [x] Set the type'].join('\n');
const build = (extra: Partial<PostextConfig> = {}) => buildDocument({ markdown: MD, metadata: { title: 'Things to do' } }, config(extra));

/** Every face the render asked for, by font string. */
async function render(doc: ReturnType<typeof build>): Promise<{ pdf: PDFDocument; bytes: Uint8Array; asked: string[] }> {
  const asked: string[] = [];
  const bytes = await renderToPdf(doc, {
    fontProvider: async (family, weight) => {
      asked.push(`${weight} ${family}`);
      return new Uint8Array(fontBytes);
    },
  });
  return { pdf: await PDFDocument.load(bytes), bytes, asked };
}

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

/** The marked-content sequences of the page's list labels. */
const labels = (content: string): string[] => [...content.matchAll(/\/Lbl <<\n\/MCID \d+\n>> BDC\n([\s\S]*?)\nEMC/g)].map((m) => m[1]!);

/** The `/ActualText` of every `Lbl` of the structure tree, in the order of
 *  the file. */
function labelTexts(pdf: PDFDocument): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('S')) !== PDFName.of('Lbl')) continue;
    const text = obj.get(PDFName.of('ActualText'));
    out.push(text instanceof PDFHexString || text instanceof PDFString ? text.decodeText() : undefined);
  }
  return out;
}

const hasVerapdf = process.env.VERAPDF === '1' && spawnSync('verapdf', ['--version'], { encoding: 'utf8' }).status === 0;

describe('the box of a task item in the PDF (#765)', () => {
  const doc = build();
  const items: VDTBlock[] = doc.blocks.filter((b) => b.type === 'listItem');

  it('draws each box with path operators and shows no text for it', async () => {
    expect(items.map((b) => b.bulletBox?.checked)).toEqual([false, true]);
    const { pdf } = await render(doc);
    const content = pageContent(pdf);
    const [open, done] = labels(content);
    expect(labels(content)).toHaveLength(2);
    for (const label of [open!, done!]) {
      expect(label).not.toMatch(/\bBT\b|\bT[jJ]\b|\bTf\b/);
      // The outline: one rectangle, stroked.
      expect(label.match(/ re\n/g)).toHaveLength(1);
      expect(label).toMatch(/ re\nS\n/);
    }
    // The tick: three points with round ends, on the done item only.
    expect(open!).not.toMatch(/ m\n/);
    expect(done!).toMatch(/1 J\n1 j\n[\d. -]+ m\n[\d. -]+ l\n[\d. -]+ l\nS\n/);
    // The item's own words are still text.
    expect(content).toMatch(/\bBT\b/);
  });

  it('puts the box where the layout has it, the stroke inside the square', async () => {
    const { pdf } = await render(doc);
    const [open] = labels(pageContent(pdf));
    const item = items[0]!;
    const { side, stroke } = item.bulletBox!;
    const [, x, y, w, h] = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/.exec(open!)!.map(Number);
    // 72 dpi: a px is a point; y runs up from the foot of a 400 pt page.
    expect(x).toBeCloseTo(item.bulletOffsetX! + stroke / 2, 3);
    expect(y).toBeCloseTo(400 - (item.bulletY! + (side - stroke) / 2), 3);
    expect(w).toBeCloseTo(side - stroke, 3);
    expect(h).toBeCloseTo(side - stroke, 3);
    expect(Number(/([\d.]+) w\n/.exec(open!)![1])).toBeCloseTo(stroke, 3);
  });

  it('asks no face for the box: the bold face of the bullets is not embedded for it', async () => {
    const { asked } = await render(doc);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((f) => f.startsWith('400 '))).toBe(true);
    // The character of postext 1.28 is set in the bullets' face, weight 700.
    const legacy = await render(build({ unorderedLists: { taskBox: 'character' } }));
    expect(legacy.asked.some((f) => f.startsWith('700 '))).toBe(true);
    for (const label of labels(pageContent(legacy.pdf))) expect(label).toMatch(/\bBT\b/);
  });

  it('reads the state of each item: the Lbl stands for the character', async () => {
    const { pdf } = await render(doc);
    expect(labelTexts(pdf)).toEqual([BOX, TICKED]);
    // A text marker needs no replacement text.
    const legacy = await render(build({ unorderedLists: { taskBox: 'character' } }));
    expect(labelTexts(legacy.pdf)).toEqual([undefined, undefined]);
  });

  it.skipIf(!hasVerapdf)('passes veraPDF (PDF/UA-1)', async () => {
    const file = path.join(os.tmpdir(), `postext-taskbox-ua-${process.pid}.pdf`);
    fs.writeFileSync(file, (await render(doc)).bytes);
    const out = spawnSync('verapdf', ['--flavour', 'ua1', '--format', 'text', file], { encoding: 'utf8' });
    fs.unlinkSync(file);
    expect(out.stdout).toMatch(/^PASS /m);
  }, 120_000);
});
