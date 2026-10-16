import { describe, it, expect, beforeAll } from 'vitest';
import type { VDTDocument } from 'postext';
import { renderToEpub, readEpub } from '../index';
import type { EpubWarning, EpubProgress, ReadEpubResult } from '../types';
import { buildFixedPublication } from './index';
import { fontUses, missingFaces, stackFamilies } from './fontUse';
import { nestOutline } from './outline';
import { LORA, PNG, sampleBook, layOutBook } from '../__tests__/sampleBook';

const MODIFIED = new Date(Date.UTC(2026, 9, 4));

describe('fontUse', () => {
  it('reads families, weights and styles from style attributes', () => {
    const html = '<div style="font:italic 700 12px &quot;Lora&quot;, &quot;Noto Serif SC&quot;, serif;color:red"></div><span style="font-family:Inter, sans-serif"></span>';
    expect(fontUses(html)).toEqual([
      { family: 'Lora', weight: 700, style: 'italic' },
      { family: 'Noto Serif SC', weight: 700, style: 'italic' },
      { family: 'Inter', weight: 400, style: 'normal' },
    ]);
    expect(stackFamilies(`"A, B", 'C', D E, monospace`)).toEqual(['A, B', 'C', 'D E']);
  });

  it('reports missing families once and missing faces of a present family', () => {
    const fonts = [{ family: 'Lora', weight: '400 700', style: 'normal' as const, bytes: LORA, format: 'ttf' as const }];
    expect(missingFaces([
      { family: 'Lora', weight: 700, style: 'normal' },
      { family: 'Lora', weight: 400, style: 'italic' },
      { family: 'Inter', weight: 400, style: 'normal' },
      { family: 'Inter', weight: 700, style: 'normal' },
    ], fonts)).toEqual([{ family: 'Lora', weight: 400, style: 'italic' }, { family: 'Inter' }]);
  });
});

describe('nestOutline', () => {
  it('nests by level without skipping', () => {
    expect(nestOutline([
      { title: 'Part I', level: 0, file: 'p1.xhtml' },
      { title: 'One', level: 1, file: 'p2.xhtml', anchorId: 'h' },
      { title: 'One.a', level: 3, file: 'p2.xhtml' },
      { title: 'Two', level: 1, file: 'p3.xhtml' },
    ], 'pages/')).toEqual([{
      label: 'Part I', href: 'pages/p1.xhtml', children: [
        { label: 'One', href: 'pages/p2.xhtml#h', children: [{ label: 'One.a', href: 'pages/p2.xhtml' }] },
        { label: 'Two', href: 'pages/p3.xhtml' },
      ],
    }]);
  });
});

describe('fixed layout from a real two-chapter book', () => {
  let docs: VDTDocument[];
  let book: ReadEpubResult;
  let bytes: Uint8Array;
  const warnings: EpubWarning[] = [];
  const progress: EpubProgress[] = [];
  const page = (i: number): string => new TextDecoder().decode(book.files.get(book.spine[i]!.path)!);

  beforeAll(async () => {
    docs = sampleBook();
    bytes = await renderToEpub(docs, {
      layout: 'fixed',
      metadata: { title: 'Sample book', creators: ['Ada Lovelace'], language: 'en-US', modified: MODIFIED },
      fonts: [{ family: 'Lora', weight: 400, style: 'normal', bytes: LORA, format: 'ttf' }],
      resourceBytes: (fileId) => fileId === 'f1.png' ? { bytes: PNG, mediaType: 'image/png' } : undefined,
      onWarning: (w) => warnings.push(w),
      onProgress: (p) => progress.push(p),
    });
    book = readEpub(bytes);
  });

  it('writes one pre-paginated page per printed page', () => {
    const pages = docs.reduce((n, d) => n + d.pages.length, 0);
    expect(docs.length).toBe(2);
    expect(book.layout).toBe('fixed');
    expect(book.spine.length).toBe(pages);
    expect(book.spine[0]!.path).toBe('OEBPS/pages/page-0001.xhtml');
    // 360×480 pt is 480×640 CSS px.
    expect(book.viewport).toEqual({ width: 480, height: 640 });
    expect(page(0)).toContain('<meta name="viewport" content="width=480, height=640"/>');
  });

  it('alternates spreads from a right-hand first page', () => {
    expect(book.spine.slice(0, 3).map((s) => s.properties)).toEqual([['page-spread-right'], ['page-spread-left'], ['page-spread-right']]);
    expect(book.pageProgression).toBe('ltr');
  });

  it('sets language, the page box and the shared stylesheet', () => {
    const p = page(0);
    expect(p).toContain('lang="en-US" xml:lang="en-US" dir="ltr"');
    expect(p).toContain('<link rel="stylesheet" type="text/css" href="../styles/fixed.css"/>');
    expect(p).toMatch(/<div class="pt-page" id="pt-p-0" dir="ltr" style="width:1500px;height:2000px;[^"]*transform:scale\(0\.32\);"/);
    const css = new TextDecoder().decode(book.files.get('OEBPS/styles/fixed.css')!);
    expect(css).toContain('src: url("../fonts/lora-400-normal.ttf") format("truetype");');
    expect(css).not.toMatch(/(^|[;\s])direction:/);
  });

  it('writes the picture as a file and links to it', () => {
    expect(book.manifest.get('img-f1')).toEqual({ path: 'OEBPS/images/f1.png', mediaType: 'image/png', properties: [] });
    const all = book.spine.map((_, i) => page(i)).join('');
    expect(all).toContain('src="../images/f1.png" alt="A red square on white"');
    expect(all).not.toContain('data:image');
  });

  it('rewrites cross-chapter links to the page files that hold their targets', () => {
    const files = book.spine.map((s) => s.path.replace('OEBPS/pages/', ''));
    const holder = (id: string) => files.find((_, i) => page(i).includes(`id="${id}"`));
    const closing = holder('pt-a-closing');
    const opening = holder('pt-a-opening');
    expect(closing).toBeDefined();
    expect(opening).toBe('page-0001.xhtml');
    expect(page(0)).toContain(`href="${closing}#pt-a-closing"`);
    const second = files.findIndex((f) => page(files.indexOf(f)).includes('#pt-a-opening"'));
    expect(second).toBeGreaterThan(0);
    // No link points at a fragment no page holds.
    for (const [i] of files.entries()) {
      for (const m of page(i).matchAll(/href="([^"#]*)#([^"]+)"/g)) {
        const target = m[1] ? files.indexOf(m[1]) : i;
        expect(page(target)).toContain(`id="${m[2]}"`);
      }
    }
  });

  it('builds the TOC from the headings and the page list from the labels', () => {
    expect(book.toc.map((t) => t.label)).toEqual(['Opening chapter', 'Second chapter']);
    expect(book.toc[0]!.children?.map((t) => t.label)).toEqual(['A section']);
    expect(book.toc[0]!.href).toMatch(/^OEBPS\/pages\/page-0001\.xhtml#h-1-1$/);
    expect(page(0)).toContain('id="h-1-1"');
    expect(book.pageList.length).toBe(book.spine.length);
    expect(book.pageList.slice(0, 2).map((p) => p.label)).toEqual(['1', '2']);
  });

  it('lists landmarks: the first page as cover and the body', () => {
    const nav = new TextDecoder().decode(book.files.get('OEBPS/nav.xhtml')!);
    expect(nav).toContain('<a epub:type="cover" href="pages/page-0001.xhtml">Cover</a>');
    expect(nav).toContain('<a epub:type="bodymatter" href="pages/page-0001.xhtml#h-1-1">');
  });

  it('declares fixed layout, spreads and accessibility in the OPF', () => {
    const opf = new TextDecoder().decode(book.files.get('OEBPS/content.opf')!);
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    expect(opf).toContain('<meta property="rendition:spread">landscape</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">printPageNumbers</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
  });

  it('reports progress and fonts it could not embed', () => {
    expect(progress.at(-1)).toEqual({ phase: 'package', done: 1, total: 1 });
    expect(progress.some((p) => p.phase === 'documents' && p.done === p.total)).toBe(true);
    const families = warnings.filter((w) => w.kind === 'missingFont').map((w) => (w as { family: string }).family);
    expect(families).not.toContain('Lora');
  });

  it('is deterministic', async () => {
    const again = await renderToEpub(docs, {
      layout: 'fixed',
      metadata: { title: 'Sample book', creators: ['Ada Lovelace'], language: 'en-US', modified: MODIFIED },
      fonts: [{ family: 'Lora', weight: 400, style: 'normal', bytes: LORA, format: 'ttf' }],
      resourceBytes: (fileId) => fileId === 'f1.png' ? { bytes: PNG, mediaType: 'image/png' } : undefined,
    });
    expect(again).toEqual(bytes);
  });

  it('puts a given cover picture first, on a page of its own', async () => {
    const pub = await buildFixedPublication(docs, {
      layout: 'fixed',
      metadata: { title: 'Sample book', language: 'en' },
      cover: { bytes: PNG, mediaType: 'image/png' },
    });
    expect(pub.spine[0]).toEqual({ idref: 'cover', properties: ['rendition:page-spread-center'] });
    expect(pub.items.find((i) => i.id === 'cover-image')?.properties).toEqual(['cover-image']);
    expect(pub.landmarks[0]).toEqual({ type: 'cover', label: 'Cover', href: 'pages/cover.xhtml' });
    expect(String(pub.items.find((i) => i.id === 'cover')!.data)).toContain('<img class="pt-cover" src="../images/cover.png" alt="Sample book"/>');
  });

  it('keeps a picture of the first page as the cover image only, the page itself the cover', async () => {
    const pub = await buildFixedPublication(docs, {
      layout: 'fixed',
      metadata: { title: 'Sample book', language: 'en' },
      cover: { bytes: PNG, mediaType: 'image/png', showsFirstPage: true },
    });
    expect(pub.spine[0]!.idref).not.toBe('cover');
    expect(pub.items.some((i) => i.id === 'cover')).toBe(false);
    expect(pub.items.find((i) => i.id === 'cover-image')?.properties).toEqual(['cover-image']);
    expect(pub.landmarks[0]).toEqual({ type: 'cover', label: 'Cover', href: 'pages/page-0001.xhtml' });
  });

  it('links the rows of the printed contents to the pages they list', async () => {
    const chapters = ['# Contents {toc="false"}\n\n:::toc\n:::', '# One\n\nText of the first chapter.', '# Two\n\nText of the second chapter.'];
    const pub = await buildFixedPublication(layOutBook(chapters), { layout: 'fixed', metadata: { title: 'T', language: 'en' } });
    const first = String(pub.items.find((i) => i.href === 'pages/page-0001.xhtml')!.data);
    const links = [...first.matchAll(/<a class="pt-toc-link" href="([^"]*)" aria-label="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(links.length).toBe(2);
    expect(links[0]![1]).toContain('One');
    expect(links[1]![1]).toContain('Two');
    // Each goes to the page file its chapter opens on.
    for (const [href] of links) {
      const [file, id] = href!.split('#');
      const target = String(pub.items.find((i) => i.href === `pages/${file}`)!.data);
      expect(target).toContain(`id="${id}"`);
    }
  });

  it('runs right to left for a right-bound book', async () => {
    const rtl = docs.map((d) => ({ ...d, binding: 'right' as const }));
    const pub = await buildFixedPublication(rtl, { layout: 'fixed', metadata: { title: 'T', language: 'en' } });
    expect(pub.pageProgression).toBe('rtl');
    expect(pub.spine.slice(0, 2).map((s) => s.properties)).toEqual([['page-spread-left'], ['page-spread-right']]);
  });

  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(renderToEpub(docs, { layout: 'fixed', metadata: { title: 'T', language: 'en' }, signal: ctrl.signal })).rejects.toThrow();
  });

  it('draws the box of a task item on the page, as an image named by its character (#765)', async () => {
    const tasks = layOutBook(['- [ ] Buy the paper\n- [x] Set the type']);
    const made = readEpub(await renderToEpub(tasks, {
      layout: 'fixed',
      metadata: { title: 'Tasks', language: 'en', modified: MODIFIED },
      fonts: [{ family: 'Lora', weight: 400, style: 'normal', bytes: LORA, format: 'ttf' }],
    }));
    const first = made.spine[0]!;
    const xhtml = new TextDecoder().decode(made.files.get(first.path)!);
    const boxes = [...xhtml.matchAll(/<div class="pt-bullet pt-task-box" role="img" aria-label="(.)"[^>]*>(.*?)<\/div>/g)];
    expect(boxes.map((m) => m[1])).toEqual(['\u2610', '\u2611']);
    // The SVG is XML here, in its namespace, and the page says it holds one.
    expect(boxes[0]![2]).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" [^>]*viewBox="0 0 100 100"[^>]*><rect [^>]*\/><\/svg>\u2610$/);
    expect(boxes[1]![2]).toContain('<path d="M22 52L42 72L78 28"');
    expect([...made.manifest.values()].find((item) => item.path === first.path)!.properties).toContain('svg');
    // No face is asked for the bullets' weight: the box is not text.
    expect(xhtml).not.toMatch(/<div class="pt-bullet" aria-hidden="true"/);
  });
});

describe('fixed layout of a right-to-left book', () => {
  it('reads right to left, mirrored pages turned back by a head style', async () => {
    const docs = layOutBook(['# الفصل الأول\n\n' + 'هذا نص عربي يملأ السطر ويستمر في الفقرة. '.repeat(20)], { locale: 'ar' });
    expect(docs[0]!.binding).toBe('right');
    const pub = await buildFixedPublication(docs, { layout: 'fixed', metadata: { title: 'كتاب', language: 'ar' } });
    expect(pub.pageProgression).toBe('rtl');
    expect(pub.spine[0]!.properties).toEqual(['page-spread-left']);
    const first = String(pub.items.find((i) => i.id === 'page-0001')!.data);
    expect(first).toContain('lang="ar" xml:lang="ar" dir="rtl"');
    // The page box runs right to left, as the renderer's root does: a word
    // box's comma or full stop stays at its left end.
    expect(first).toMatch(/<div class="pt-page" id="pt-p-0" dir="rtl"/);
    expect(first).toMatch(/<head>[\s\S]*<style>\.pt-flow-mirrored[\s\S]*<\/head>/);
    expect(first).not.toMatch(/<body[\s\S]*<style>/);
    expect(pub.toc[0]!.label).toBe('الفصل الأول');
  });

  it('paints the tatweels of justification but keeps them out of copied text (#402)', async () => {
    const docs = layOutBook(['قال AAA إن الملك شهريار كان يحكم بلاد الهند والصين، وكتب المؤلف جمـيل. '.repeat(12)], {
      locale: 'ar',
      bodyText: { textAlign: 'justify' },
    });
    const segments = docs[0]!.pages[0]!.columns[0]!.blocks.flatMap((b) => b.lines.flatMap((l) => l.segments ?? []));
    expect(segments.some((s) => s.kashida && s.kashida.length > 0)).toBe(true);
    const pub = await buildFixedPublication(docs, { layout: 'fixed', metadata: { title: 'كتاب', language: 'ar' } });
    const first = String(pub.items.find((i) => i.id === 'page-0001')!.data);
    // Inserted tatweels sit in spans no selection reaches; the one the
    // author typed (جمـيل) is plain text.
    expect(first).toMatch(/<span style="-webkit-user-select:none;user-select:none;">ـ+<\/span>/);
    expect(first).toContain('جمـيل.');
    expect(first).toMatch(/<span dir="ltr" style="[^"]*">AAA<\/span>/);
  });
});

describe('fixed layout of a spread template (#861)', () => {
  const mm = (value: number) => ({ value, unit: 'mm' as const });
  const template = {
    id: 'tl',
    spread: true,
    gutter: mm(6),
    frames: [
      { name: 'band', crossGutter: true, height: mm(20), width: 'fill' as const, placement: { anchor: { to: 'container' as const, edge: 'top-left' as const } } },
      { name: 'text', flow: true, placement: { anchor: { to: '#band', edge: 'below' as const } } },
    ],
  };
  const md = 'Before the spread.\n\n::::page{template="tl" spread}\n:::frame{slot="band"}\nBand across the spine\n:::\n\nText under it.\n::::\n\nAfter.';
  const props = async (docs: VDTDocument[]) =>
    (await buildFixedPublication(docs, { layout: 'fixed', metadata: { title: 'T', language: docs[0]!.config.locale ?? 'en' } })).spine.map((s) => s.properties);

  it('shows the two pages side by side in any orientation, the verso on the left', async () => {
    const docs = layOutBook([md], { pageTemplates: [template] } as never);
    const pages = docs[0]!.pages;
    expect(pages.filter((p) => p.composed?.spread).map((p) => [p.index, p.composed!.spread])).toEqual([[1, 'left'], [2, 'right']]);
    expect(await props(docs)).toEqual([['page-spread-right'], ['page-spread-left', 'rendition:spread-both'], ['page-spread-right', 'rendition:spread-both'], ['page-spread-left']]);
  });

  it('puts the verso on the right in a right-to-left book', async () => {
    const docs = layOutBook([md], { pageTemplates: [template], locale: 'ar' } as never);
    expect(docs[0]!.binding).toBe('right');
    const spread = docs[0]!.pages.filter((p) => p.composed?.spread);
    expect(spread.map((p) => p.composed!.spread)).toEqual(['right', 'left']);
    expect((await props(docs)).slice(1, 3)).toEqual([['page-spread-right', 'rendition:spread-both'], ['page-spread-left', 'rendition:spread-both']]);
  });

  it('paints the facing half of the band hidden from assistive technology', async () => {
    const docs = layOutBook([md], { pageTemplates: [template] } as never);
    const pub = await buildFixedPublication(docs, { layout: 'fixed', metadata: { title: 'T', language: 'en' } });
    const recto = String(pub.items.find((i) => i.id === 'page-0003')!.data);
    expect(recto).toMatch(/data-facing="true" aria-hidden="true"/);
    expect(recto).toContain('pt-sheet-clip');
    const verso = String(pub.items.find((i) => i.id === 'page-0002')!.data);
    expect(verso).not.toContain('data-facing');
  });
});
