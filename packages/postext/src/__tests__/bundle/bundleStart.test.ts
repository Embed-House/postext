import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { buildBundle, bundleStart, createBundle, isBundleManifest, openBundle, pickBundleStart } from '../../bundle/index.js';
import type { BundleManifest, BundleStart } from '../../bundle/index.js';
import { buildDocument, continuationAfter } from '../../pipeline/index.js';
import type { DesignElement, LayoutContinuation, PostextConfig } from '../../types.js';
import type { VDTDocument } from '../../vdt.js';

// #695: a bundle that holds part of a longer book says where it starts,
// the `continuation` of its first chapter, so it lays out as the document
// it was written from: the same page sides, folios and chapter numbers.

// Deterministic text measurement stub (no DOM in the node test env).
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const text = (id: string, content: string, parity: 'odd' | 'even' | 'all' = 'all'): DesignElement => ({
  kind: 'text', id, content, parity, fontSize: pt(8),
  placement: { anchor: { to: 'container', edge: 'top' } },
} as DesignElement);
const config: PostextConfig = {
  page: { width: pt(360), height: pt(480), margins: { top: pt(36), bottom: pt(36), left: pt(54), right: pt(24), mirror: true } },
  headings: { levels: [{ level: 1, numberingTemplate: 'Chapter {1}', breakBefore: { enabled: false } }, { level: 2, numberingTemplate: '{1}.{2}' }] },
  header: { elements: [text('recto', 'recto {partTitle}', 'odd'), text('verso', 'verso {partTitle}', 'even')] },
  footer: { elements: [text('folio', '{pageNumber} of {bookTotalPages}')] },
};
const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ';
const chapter = (title: string) => `# ${title}\n\n## A section\n\n${`${paragraph.repeat(8)}\n\n`.repeat(14)}`;
const start: BundleStart = { pageIndexOffset: 57, pageNumbering: { startAt: 58 }, headings: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } };

const manifestOf = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(unzipSync(bytes)['preset.json'])) as BundleManifest & Record<string, unknown>;
/** The same archive with `preset.json` rewritten. */
const withManifest = (bytes: Uint8Array, edit: (manifest: Record<string, unknown>) => void): Uint8Array => {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['preset.json']));
  edit(manifest);
  return zipSync({ ...files, 'preset.json': new TextEncoder().encode(JSON.stringify(manifest)) });
};
const slotText = (slot: VDTDocument['pages'][number]['header']) => (slot?.blocks ?? [])
  .flatMap((block) => (block.kind === 'text' ? block.lines.map((line) => line.text) : [])).join('|');
/** What a reader sees of a document: every page's side, folio, running
 *  head and content box, and every block's place and text. */
const pagesOf = (doc: VDTDocument) => JSON.stringify({
  offset: doc.pageIndexOffset ?? 0,
  pages: doc.pages.map((page) => ({
    label: page.pageLabel, head: slotText(page.header), foot: slotText(page.footer), content: page.contentArea,
  })),
  blocks: doc.blocks.map((b) => ({ type: b.type, page: b.pageIndex, bbox: b.bbox, number: b.numberPrefix, lines: b.lines?.map((l) => l.text) })),
});
const headingNumbers = (doc: VDTDocument) => doc.blocks.filter((b) => b.type === 'heading').map((b) => b.numberPrefix?.trim() ?? '');

describe('a bundle records where its book starts (#695)', () => {
  it('writes the start in preset.json and reads it back', async () => {
    const { bytes, manifest } = await createBundle({ name: 'Excerpt', markdown: chapter('Four'), config, start });
    expect(manifest.version).toBe(2);
    expect(manifest.start).toEqual(start);
    expect(manifestOf(bytes).start).toEqual(start);
    const opened = await openBundle(bytes);
    expect(opened.start).toEqual(start);
    // Written again from what was read, it is the same bundle.
    const again = await createBundle({ name: 'Excerpt', markdown: opened.chapters[0]!.markdown, config, start: opened.start });
    expect(again.manifest.start).toEqual(manifest.start);
  });

  it('writes nothing for a book that starts at its beginning', async () => {
    const mtime = new Date(1980, 0, 1);
    const plain = await createBundle({ name: 'Book', markdown: chapter('One'), config, mtime });
    expect('start' in plain.manifest).toBe(false);
    expect((await openBundle(plain.bytes)).start).toBeUndefined();
    // An empty start, or one of fields the format does not carry, is none.
    for (const empty of [{}, { bookPageCount: 320 } as BundleStart]) {
      const same = await createBundle({ name: 'Book', markdown: chapter('One'), config, mtime, start: empty });
      expect(Array.from(same.bytes)).toEqual(Array.from(plain.bytes));
    }
  });

  it('lays the bundle out as the document built with that continuation', async () => {
    const markdown = chapter('Four');
    const pen = buildDocument({ markdown, continuation: start }, config);
    const { bytes } = await createBundle({ name: 'Excerpt', markdown, config, start });
    const opened = await openBundle(bytes);
    const [doc] = buildBundle(opened);
    expect(pagesOf(doc!)).toBe(pagesOf(pen));
    expect(doc!.pages.length).toBeGreaterThan(1);
    expect(pagesOf(doc!)).toContain('Lorem ipsum');
    // Page 58 is a verso, the chapter is the fourth, and the book counts
    // the pages before it.
    expect(doc!.pageIndexOffset).toBe(57);
    expect(doc!.pages[0]!.pageLabel).toBe('58');
    expect(slotText(doc!.pages[0]!.header)).toBe('verso ');
    expect(headingNumbers(doc!)).toEqual(['Chapter 4', '4.1']);
    expect(slotText(doc!.pages[0]!.footer)).toBe(`58 of ${57 + doc!.pages.length}`);
    // Without it, the same bundle opens on page 1, a recto, in chapter 1.
    const [bare] = buildBundle({ ...opened, start: undefined });
    expect(bare!.pages[0]!.pageLabel).toBe('1');
    expect(slotText(bare!.pages[0]!.header)).toBe('recto ');
    expect(headingNumbers(bare!)).toEqual(['Chapter 1', '1.1']);
    expect(pagesOf(bare!)).not.toBe(pagesOf(pen));
  });

  it('chains the chapters after the first from the start', async () => {
    const chapters = [{ markdown: chapter('Four') }, { markdown: chapter('Five') }];
    const { bytes } = await createBundle({ name: 'Excerpt', chapters, config, start: { ...start, part: { number: 'II', title: 'Fieldwork' } } });
    const opened = await openBundle(bytes);
    const docs = buildBundle(opened);
    // By hand: the second chapter after the pages and counters of the first.
    const first = buildDocument({ markdown: chapters[0]!.markdown, continuation: opened.start }, opened.config);
    const last = first.pages[first.pages.length - 1]!;
    const total = 57 + docs[0]!.pages.length + docs[1]!.pages.length;
    const after: LayoutContinuation = {
      ...continuationAfter({ markdown: chapters[0]!.markdown }, opened.config, { headings: start.headings, part: opened.start!.part }),
      pageIndexOffset: 57 + first.pages.length,
      pageNumbering: { startAt: last.pageNumberValue + 1, format: last.pageNumberFormat },
      bookPageCount: total,
    };
    const second = buildDocument({ markdown: chapters[1]!.markdown, continuation: after }, opened.config);
    expect(pagesOf(docs[1]!)).toBe(pagesOf(second));
    expect(headingNumbers(docs[1]!)).toEqual(['Chapter 5', '5.1']);
    expect(docs[1]!.pageIndexOffset).toBe(57 + docs[0]!.pages.length);
    // The part left open before the excerpt names the running heads of both.
    expect(slotText(docs[0]!.pages[0]!.header)).toBe('verso Fieldwork');
    expect(slotText(docs[1]!.pages[0]!.header)).toContain('Fieldwork');
    expect(slotText(docs[1]!.pages[0]!.footer)).toBe(`${last.pageNumberValue + 1} of ${total}`);
  });

  it('completes the heading counters and leaves out what it cannot read', () => {
    expect(bundleStart({ headings: { h1: 3 } })).toEqual({ headings: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } });
    expect(bundleStart({
      pageIndexOffset: 9.7, pageNumbering: { format: 'lower-roman', startAt: 10, other: true }, bookPageCount: 320,
      footnoteNumber: 12, lineNumber: 40, afterPartPage: true, unknown: 1,
      part: { number: 'I', title: 'One', palette: { band: '#f6c297', wrong: 3 } },
      resourceCounters: { figure: { counter: 2, heading: { h1: 3 } }, table: 'x' },
      resourceNumbers: { fig1: { number: '3.1', typeId: 'figure', heading: { h1: 3 } }, bad: { number: 3 } },
      statementCounters: { equation: { counter: 4, heading: {} } },
    })).toEqual({
      pageIndexOffset: 9, pageNumbering: { format: 'lower-roman', startAt: 10 },
      footnoteNumber: 12, lineNumber: 40, afterPartPage: true,
      part: { number: 'I', title: 'One', palette: { band: '#f6c297' } },
      resourceCounters: { figure: { counter: 2, heading: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } } },
      resourceNumbers: { fig1: { number: '3.1', typeId: 'figure', heading: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } } },
      statementCounters: { equation: { counter: 4, heading: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } } },
    });
    for (const none of [undefined, null, 'x', 3, [], {}, { pageIndexOffset: -1 }, { pageNumbering: {} }, { headings: 'x' }, { afterPartPage: false }]) {
      expect(bundleStart(none), JSON.stringify(none)).toBeUndefined();
    }
  });

  it('reads a start written by hand, and rejects one that is no object', async () => {
    const { bytes } = await createBundle({ name: 'Excerpt', markdown: chapter('Four'), config });
    const byHand = withManifest(bytes, (manifest) => { manifest.start = { pageIndexOffset: 1, headings: { h1: 3 }, pageNumbering: { startAt: 'x' } }; });
    const opened = await openBundle(byHand);
    expect(opened.start).toEqual({ pageIndexOffset: 1, headings: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } });
    expect(headingNumbers(buildBundle(opened)[0]!)).toEqual(['Chapter 4', '4.1']);
    const manifest = manifestOf(bytes);
    expect(isBundleManifest({ ...manifest, start: { pageIndexOffset: 1 } })).toBe(true);
    expect(isBundleManifest({ ...manifest, start: 'page 58' })).toBe(false);
    expect(isBundleManifest({ ...manifest, start: [58] })).toBe(false);
    await expect(openBundle(withManifest(bytes, (m) => { m.start = 58; }))).rejects.toThrow();
  });

  it('gives a language of the bundle a start of its own', async () => {
    const { bytes, manifest } = await createBundle({
      name: 'Two', locale: 'en', markdown: chapter('Four'), config, start,
      localized: {
        ja: { chapters: [{ markdown: chapter('四') }], start: { pageIndexOffset: 58, headings: { h1: 3 } } as BundleStart },
        es: { chapters: [{ markdown: chapter('Cuatro') }], start },
        fr: { chapters: [{ markdown: chapter('Quatre') }], start: {} },
      },
    });
    expect(manifest.start).toEqual(start);
    expect(manifest.localized!.ja!.start).toEqual({ pageIndexOffset: 58, headings: start.headings });
    // The shared start is not written again; an edition that starts at
    // its beginning says so with an empty one.
    expect('start' in manifest.localized!.es!).toBe(false);
    expect(manifest.localized!.fr!.start).toEqual({});
    expect(pickBundleStart(manifest, 'ja')).toEqual({ pageIndexOffset: 58, headings: start.headings });
    expect((await openBundle(bytes, { locale: 'ja' })).start).toEqual({ pageIndexOffset: 58, headings: start.headings });
    expect((await openBundle(bytes, { locale: 'es' })).start).toEqual(start);
    expect((await openBundle(bytes, { locale: 'fr' })).start).toBeUndefined();
    expect((await openBundle(bytes)).start).toEqual(start);
    // The Japanese edition opens on a recto, the English one on a verso.
    const side = async (locale: string) => slotText(buildBundle(await openBundle(bytes, { locale }))[0]!.pages[0]!.header);
    expect(await side('ja')).toBe('recto ');
    expect(await side('en')).toBe('verso ');
  });

  it('keeps the page numbering the configuration sets when the start names none', async () => {
    const numbered: PostextConfig = { ...config, page: { ...config.page, pageNumbering: { format: 'lower-roman', startAt: 5 } } };
    const { bytes } = await createBundle({ name: 'Front', markdown: chapter('Preface'), config: numbered, start: { pageIndexOffset: 4 } });
    const opened = await openBundle(bytes);
    const [doc] = buildBundle(opened);
    expect(doc!.pages[0]!.pageLabel).toBe('v');
    expect(pagesOf(doc!)).toBe(pagesOf(buildDocument({ markdown: chapter('Preface'), continuation: { pageIndexOffset: 4 } }, numbered)));
  });
});
