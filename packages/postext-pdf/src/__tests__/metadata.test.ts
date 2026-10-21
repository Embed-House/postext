import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { DocumentMetadata, PostextConfig, VDTDocument } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

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
  page: { width: pt(220), height: pt(300), margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
  headings: { levels: [{ level: 1, breakBefore: { enabled: false } }] },
};

// EF-11: YAML frontmatter is typed — `title: 1984` is a number. The PDF
// title and author must still be set (and the render must not throw).
describe('PDF metadata from typed frontmatter', () => {
  it('sets the title and author of numeric frontmatter values', async () => {
    const doc = buildDocument({ markdown: '---\ntitle: 1984\nauthor: 2001\n---\n\n# One\n\nText.' }, config);
    for (const accessible of [true, false]) {
      const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider, accessible }));
      expect(pdf.getTitle()).toBe('1984');
      expect(pdf.getAuthor()).toBe('2001');
    }
  });

  it('coerces a non-string title handed straight to the renderer', async () => {
    const doc = buildDocument({ markdown: '# One\n\nText.' }, config);
    const raw: VDTDocument = { ...doc, metadata: { title: 1984, author: ['Ana', 'Luis'] } as unknown as DocumentMetadata };
    const pdf = await PDFDocument.load(await renderToPdf(raw, { fontProvider }));
    expect(pdf.getTitle()).toBe('1984');
    expect(pdf.getAuthor()).toBe('Ana, Luis');
    // An object has no text form: the first heading titles the PDF instead.
    const odd: VDTDocument = { ...doc, metadata: { title: { a: 1 } } as unknown as DocumentMetadata };
    expect((await PDFDocument.load(await renderToPdf(odd, { fontProvider }))).getTitle()).toBe('One');
  });
});

// #734: pdf-lib stamps a new file with the time of the call, so two renders
// of one document differed in their two Info dates (and in the
// cross-reference stream they move): a capture rewrote 56 PDFs whose
// pages had not changed.
describe('RenderToPdfOptions.date (#734)', () => {
  const doc = () => buildDocument({ markdown: '---\ntitle: Dated\n---\n\n# One\n\nText with a [link](https://example.com).' }, config);

  it('gives the same bytes for two renders with one date', async () => {
    const date = new Date('2026-09-27T00:00:00Z');
    for (const accessible of [true, false]) {
      const a = await renderToPdf(doc(), { fontProvider, accessible, date });
      // The clock moves between the two renders.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const b = await renderToPdf(doc(), { fontProvider, accessible, date });
      expect(Buffer.from(a).equals(Buffer.from(b)), `accessible ${accessible}`).toBe(true);
      const pdf = await PDFDocument.load(a, { updateMetadata: false });
      expect(pdf.getCreationDate()?.toISOString()).toBe('2026-09-27T00:00:00.000Z');
      expect(pdf.getModificationDate()?.toISOString()).toBe('2026-09-27T00:00:00.000Z');
    }
  }, 20_000);

  it('takes a date, a time in milliseconds or a string, as createBundle\'s mtime does', async () => {
    const stamp = Date.UTC(2026, 8, 27);
    const bytes = await Promise.all([new Date(stamp), stamp, '2026-09-27T00:00:00Z', '2026-09-27'].map((date) => renderToPdf(doc(), { fontProvider, date })));
    for (const other of bytes.slice(1)) expect(Buffer.from(other).equals(Buffer.from(bytes[0]!))).toBe(true);
  });

  it('stamps the file with the time of the call when no date is given', async () => {
    const before = Date.now();
    const pdf = await PDFDocument.load(await renderToPdf(doc(), { fontProvider }), { updateMetadata: false });
    const after = Date.now();
    for (const stamped of [pdf.getCreationDate(), pdf.getModificationDate()]) {
      // A PDF date keeps whole seconds.
      expect(stamped!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped!.getTime()).toBeLessThanOrEqual(after + 1000);
    }
  });

  it('refuses an invalid date, naming the option', async () => {
    await expect(renderToPdf(doc(), { fontProvider, date: 'not a date' })).rejects.toThrow(/renderToPdf's `date` is not a valid date \(got not a date\)/);
    await expect(renderToPdf(doc(), { fontProvider, date: Number.NaN })).rejects.toThrow(/`date`/);
  });
});
