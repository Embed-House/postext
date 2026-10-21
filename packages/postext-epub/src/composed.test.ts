// Composed pages outside print (#862): the reflowable book reads a
// composed page as a section of its frames in Markdown order, each frame a
// block in its callout style, the decoration left out and a figure's
// labels read after its picture; the fixed layout reproduces the page with
// its frames written in reading order and painted in layer order.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildDocument, documentFontFaces } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import { renderToEpub, readEpub } from './index.js';
import type { EpubWarning, ReadEpubResult, RenderToEpubOptions } from './types.js';
import { checkXml } from './reflowable/__tests__/xml.js';
import { PAGE8_LABELS, page8Book, page8Bytes, type Page8Locale } from './__tests__/page8.js';

const options = (layout: RenderToEpubOptions['layout'], locale: Page8Locale, warnings: EpubWarning[] = []): RenderToEpubOptions => ({
  layout,
  metadata: { title: locale === 'es' ? 'El dinero' : 'Money', language: locale, modified: new Date(Date.UTC(2026, 9, 16)) },
  resourceBytes: page8Bytes,
  onWarning: (w) => warnings.push(w),
});

const text = (book: ReadEpubResult, path: string): string => new TextDecoder().decode(book.files.get(path)!);

/** The chapter's content document. */
const chapter = (book: ReadEpubResult): string => text(book, book.spine.find((s) => s.path.includes('chapter-'))!.path);

/** Plain text of markup: tags dropped, entities read, spaces collapsed. */
const plain = (xml: string): string => {
  // Read the markup piece by piece instead of rewriting it with patterns: an
  // inline tag (span, strong, em, b, i, a) joins its text to its neighbours,
  // any other tag stands for a space.
  const pieces = xml.split('<');
  let out = pieces[0]!;
  for (const piece of pieces.slice(1)) {
    const end = piece.indexOf('>');
    if (end < 0) continue;
    const inline = /^\/?(?:span|strong|em|b|i|a)(?:\s|$)/.test(piece.slice(0, end));
    out += (inline ? '' : ' ') + piece.slice(end + 1);
  }
  // `&amp;` last, so an escaped entity is read once.
  return out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

/** The text runs of the page fence's Markdown, in order: its paragraphs,
 *  list items, headings and box titles, marks and directives taken out. */
function markdownRuns(markdown: string): string[] {
  const runs: string[] = [];
  for (const raw of markdown.split('\n')) {
    let line = raw.trim();
    if (!line || /^:{3,}(page|figure)?\b/.test(line) && !line.startsWith(':::frame') || /^::(resource|label)\b/.test(line)) continue;
    const label = /^:::frame\{[^}]*label="([^"]+)"/.exec(line);
    if (label) {
      runs.push(label[1]!);
      continue;
    }
    if (line.startsWith(':::')) continue;
    line = line.replace(/^#+\s*/, '').replace(/^-\s*/, '').replace(/:chip\[([^\]]*)\]\{[^}]*\}/g, '$1').replace(/\*\*/g, '');
    runs.push(line);
  }
  return runs;
}

describe('a composed page in the reflowable EPUB (#862)', () => {
  const books = new Map<Page8Locale, { doc: VDTDocument; markdown: string; book: ReadEpubResult; xhtml: string; css: string; warnings: EpubWarning[] }>();
  beforeAll(async () => {
    for (const locale of ['es', 'en'] as const) {
      const { doc, markdown } = await page8Book(locale);
      const warnings: EpubWarning[] = [];
      const book = readEpub(await renderToEpub([doc], options('reflowable', locale, warnings)));
      books.set(locale, { doc, markdown, book, xhtml: chapter(book), css: text(book, 'OEBPS/styles/book.css'), warnings });
    }
  }, 60_000);

  for (const locale of ['es', 'en'] as const) {
    it(`reads the page's text in Markdown order (${locale})`, () => {
      const { markdown, xhtml } = books.get(locale)!;
      const body = plain(xhtml);
      let at = 0;
      const runs = markdownRuns(markdown);
      // Headings, paragraphs, list items and the three boxes' titles.
      expect(runs.length).toBeGreaterThanOrEqual(15);
      for (const run of runs) {
        const found = body.indexOf(run, at);
        expect(found, run).toBeGreaterThanOrEqual(at);
        at = found + run.length;
      }
      expect(checkXml(xhtml).errors).toEqual([]);
    });
  }

  it('sets the page as a section of its frames, each a block in its callout style, in source order', () => {
    const { xhtml } = books.get('en')!;
    const section = /<section class="pt-composed pt-composed-tema-cajas">([\s\S]*?)<\/section>/.exec(xhtml)?.[1] ?? '';
    expect(section).not.toBe('');
    const frames = [...section.matchAll(/<div class="pt-frame pt-frame-([\w-]+)((?: [\w-]+)*)">/g)].map((m) => `${m[1]}${m[2]}`);
    expect(frames).toEqual([
      'titulo pt-callout pt-callout-tab-titulo',
      'texto',
      'dinero pt-callout pt-callout-caja-azul',
      'dinero-fotos',
      'gasto pt-callout pt-callout-caja-verde',
      'gasto-fotos',
      'ahorro pt-callout pt-callout-caja-amarilla',
      'ahorro-fotos',
    ]);
    // The page's text, not asides; the box's tab is its title.
    expect(section).not.toContain('<aside');
    expect(section).toContain('<p class="pt-callout-title">What money is for</p>');
    expect(section).toMatch(/^<span epub:type="pagebreak" role="doc-pagebreak" id="page-1" aria-label="1"><\/span>/);
    expect(section).toContain('<h1 id="h-1">Money and everyday life</h1>');
  });

  it('leaves the decoration out: its background picture and its text', () => {
    const { xhtml, book } = books.get('en')!;
    expect(xhtml).not.toContain('banda-tema');
    expect(xhtml).not.toContain('Planet challenges');
    expect([...book.files.keys()].some((p) => p.includes('banda-tema'))).toBe(false);
  });

  for (const locale of ['es', 'en'] as const) {
    it(`draws a figure's labels over its picture and reads them as a list after it, out of sight (${locale})`, () => {
      const { xhtml, css } = books.get(locale)!;
      const figure = /<figure id="res-foto-gasto">([\s\S]*?)<\/figure>/.exec(xhtml)?.[1] ?? '';
      const items = PAGE8_LABELS[locale].map((l) => `<li>${l}</li>`).join('');
      // The picture and its labels in a box as wide as the image (#955),
      // then the list, which stays for the reading order.
      expect(figure).toMatch(new RegExp(`^<span class="pt-labelled"><img src="\\.\\./images/foto-gasto\\.png" alt="[^"]+"/><svg class="pt-label-layer"[^>]* aria-hidden="true"[^>]*>.*</svg></span>\\n<ul class="pt-figure-labels pt-hidden">${items}</ul>$`));
      const words = [...figure.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
      expect(words).toEqual(PAGE8_LABELS[locale]);
      // The layer is in the picture's coordinates: its viewBox is the body.
      expect(figure).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
      expect(css).toContain('.pt-labelled {');
      expect(css).toContain('.pt-label-layer {');
      // Only the figure with labels has a list.
      expect(xhtml.split('pt-figure-labels').length - 1).toBe(1);
    });
  }

  it('styles a frame set in a callout style as that style draws its box', () => {
    const { css } = books.get('en')!;
    expect(css).toMatch(/aside\.pt-callout-caja-azul, div\.pt-frame\.pt-callout-caja-azul \{\n {2}background-color: #d8ecf9;/);
    expect(css).toContain('div.pt-frame.pt-callout-caja-azul > .pt-callout-title');
    expect(css).toContain('section.pt-composed {');
    expect(css).toMatch(/\.pt-hidden \{\n {2}position: absolute;/);
  });

  it('keeps the stylesheet of a book with no composed page as it was', async () => {
    const { doc } = books.get('en')!;
    const plainDoc = buildDocument({ markdown: '# Plain\n\n:::callout\nA box.\n:::\n' }, doc.config as PostextConfig);
    const css = text(readEpub(await renderToEpub([plainDoc], options('reflowable', 'en'))), 'OEBPS/styles/book.css');
    expect(css).not.toContain('pt-frame');
    expect(css).not.toContain('pt-composed');
    expect(css).toMatch(/^aside\.pt-callout-caja-azul \{$/m);
  });

  it('reads frames in Markdown order whatever order the template lists and layers them in', async () => {
    const config: PostextConfig = {
      locale: 'en-us',
      pageTemplates: [{
        id: 't',
        frames: [
          { name: 'late', layer: 3, placement: { anchor: { to: 'container', edge: 'top-left' } } },
          { name: 'early', layer: -1, placement: { anchor: { to: 'container', edge: 'bottom-left' } } },
        ],
      }],
    };
    const markdown = ['Before the page.', '', '::::page{template="t"}', ':::frame{slot="early"}', 'Early words.', ':::', '', ':::frame{slot="late"}', 'Late words.', ':::', '::::', '', 'After the page.'].join('\n');
    const doc = buildDocument({ markdown }, config);
    const xhtml = chapter(readEpub(await renderToEpub([doc], options('reflowable', 'en'))));
    const at = ['Before the page.', 'pt-frame-early', 'Early words.', 'pt-frame-late', 'Late words.', 'After the page.'].map((s) => xhtml.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Each page starts where its text does: the composed page's in its
    // section, the next page's before the text after it.
    expect(xhtml).toMatch(/<section class="pt-composed pt-composed-t"><span epub:type="pagebreak"[^>]*id="page-2"/);
  });
});

describe('a composed page in the fixed-layout EPUB (#862)', () => {
  let doc: VDTDocument;
  let page: string;
  const warnings: EpubWarning[] = [];
  beforeAll(async () => {
    ({ doc } = await page8Book('en'));
    const book = readEpub(await renderToEpub([doc], options('fixed', 'en', warnings)));
    page = text(book, book.spine[0]!.path);
  }, 60_000);

  it('applies the template: every frame in its box, written in reading order, painted in layer order', () => {
    const frames = [...page.matchAll(/<div class="pt-frame" data-frame-id="cp0:([\w-]+)" data-layer="(-?\d+)" style="[^"]*z-index:(\d+);[^"]*">/g)]
      .map((m) => ({ name: m[1]!, layer: Number(m[2]), z: Number(m[3]) }));
    expect(frames.map((f) => f.name)).toEqual(['titulo', 'texto', 'dinero', 'dinero-fotos', 'gasto', 'gasto-fotos', 'ahorro', 'ahorro-fotos']);
    // The photos (layer 2) paint over the boxes (layer 1), whatever their
    // place in the markup.
    const z = new Map(frames.map((f) => [f.name, f.z]));
    for (const photo of ['dinero-fotos', 'gasto-fotos', 'ahorro-fotos']) {
      for (const box of ['titulo', 'texto', 'dinero', 'gasto', 'ahorro']) expect(z.get(photo)!).toBeGreaterThan(z.get(box)!);
    }
    expect(checkXml(page).errors).toEqual([]);
  });

  it('keeps the decoration under the frames, its pictures hidden from assistive technology', () => {
    const deco = /<div class="pt-frame-decoration" style="[^"]*z-index:1;">/.exec(page);
    expect(deco).not.toBeNull();
    expect(page.indexOf('pt-frame-decoration')).toBeLessThan(page.indexOf('data-frame-id="cp0:titulo"'));
    expect(page).toMatch(/<img src="\.\.\/images\/banda-tema\.png" alt="" role="presentation"/);
    // The labels are drawn over the picture as text (#860), after it in
    // the markup, so its alternative text no longer repeats them.
    expect(page).toContain('alt="A family with a shopping basket"');
    const img = page.indexOf('alt="A family with a shopping basket"');
    const words = ['Rent', 'Electricity', 'Food'].map((w) => page.indexOf(`>${w}<`, img));
    expect(words.every((i) => i > img)).toBe(true);
    expect([...words].sort((a, b) => a - b)).toEqual(words);
    expect(page).toContain('alt="A piggy bank beside some coins"');
  });

  it('reports the decoration face it has no file for, as the Sandbox collects it to embed', async () => {
    const config = structuredClone(doc.config.pageTemplates) as unknown as NonNullable<PostextConfig['pageTemplates']>;
    const { markdown } = await page8Book('en');
    const decorated = config.map((t) => ({ ...t, decoration: { ...t.decoration, elements: (t.decoration?.elements ?? []).map((e) => ('kind' in e && e.kind === 'text' ? { ...e, fontFamily: 'Decofont' } : e)) } }));
    const found: EpubWarning[] = [];
    const d = buildDocument({ markdown }, { ...(doc.config as unknown as PostextConfig), pageTemplates: decorated } as PostextConfig);
    expect(documentFontFaces(d).some((f) => f.family === 'Decofont')).toBe(true);
    await renderToEpub([d], options('fixed', 'en', found));
    expect(found).toContainEqual({ kind: 'missingFont', family: 'Decofont' });
  });
});

describe('a frame whose content goes on on an added page, in the reflowable EPUB (#859)', () => {
  const PARAS = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60).trim()} end${i}.`);
  const config: PostextConfig = {
    locale: 'en-us',
    page: { width: { value: 150, unit: 'mm' }, height: { value: 200, unit: 'mm' } } as never,
    pageTemplates: [
      {
        id: 't',
        overflowTemplate: 'more',
        frames: [
          { name: 'title', takes: 'h1' },
          { name: 'box', placement: { anchor: { to: '#title', edge: 'below' } }, height: { value: 40, unit: 'mm' }, overflow: { continueIn: 'next-page', mark: 'Turn over' } },
        ],
      },
      { id: 'more', frames: [{ name: 'box' }] },
    ],
  };
  const markdown = ['::::page{template="t"}', '# The page', '', ':::frame{slot="box"}', ...PARAS.flatMap((p) => [p, '']), ':::', '::::', '', 'After the page.'].join('\n');
  let doc: VDTDocument;
  let xhtml: string;
  beforeAll(async () => {
    doc = buildDocument({ markdown }, config);
    xhtml = chapter(readEpub(await renderToEpub([doc], options('reflowable', 'en'))));
  }, 60_000);

  it('the layout added pages', () => {
    const pages = doc.pages.filter((p) => p.composed);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]!.composed!.continuationOf).toBe(pages[0]!.index);
  });

  it('reads the box in one piece: one section, one frame, every paragraph once and whole, the mark left out', () => {
    expect(xhtml.split('<section class="pt-composed').length - 1).toBe(1);
    expect(xhtml.split('pt-frame-box').length - 1).toBe(1);
    const body = plain(xhtml);
    let at = 0;
    for (const p of PARAS) {
      const found = body.indexOf(p, at);
      expect(found, p.slice(0, 12)).toBeGreaterThanOrEqual(at);
      at = found + p.length;
    }
    expect(body).not.toContain('Turn over');
    expect(body.indexOf('After the page.')).toBeGreaterThan(at);
    expect(checkXml(xhtml).errors).toEqual([]);
  });

  it('marks the added page where its text starts, inside the box', () => {
    const frame = /<div class="pt-frame pt-frame-box">([\s\S]*?)<\/div>/.exec(xhtml)?.[1] ?? '';
    expect(frame).toContain('id="page-2"');
  });

  it('the fixed layout draws each piece on its page, the mark on the first', async () => {
    const book = readEpub(await renderToEpub([doc], options('fixed', 'en')));
    const pages = book.spine.map((s) => text(book, s.path));
    expect(pages[0]).toContain('data-frame-id="cp0:box"');
    // The mark is drawn word by word, hidden from assistive technology.
    expect(pages[0]).toContain('>Turn</span>');
    expect(pages[1]).toContain('data-frame-id="cp0:box~1"');
    expect(pages[1]).not.toContain('>Turn</span>');
  });
});
