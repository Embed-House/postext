import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { buildDocument, createMeasurementCache, sourceAt } from 'postext';
import type { PostextConfig, Resource, VDTBlock, VDTDocument, VDTPage } from 'postext';
import { atLevel, breadcrumb, breadcrumbText, climb, pickAt, resolveSelection, selectedElement, selectionAtSource, type CrumbLabels, type PageSelection } from './pageSelection';
import { headingInChapters, sectionForConfigPath, selectionTarget } from './selectionTargets';
import { pickedMarkFor } from './pickedOverlay';
import { climbPageSelection, followFrameEditor, frameDragNow, pageSelectionNow, resetPageSelection, selectPageLevel, setPageSelection, syncPageSelection } from './selectionStore';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

// The engine's composed-page fixtures (P4's p. 8 stand-in, P7's timeline
// spread), read where they live: imported at run time, so the package's
// build (rooted at src/) does not take them in.
type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const FIXTURES = '../../../postext/src/__tests__/composed/fixtures/';
let page8Fixture: Fixture;
let timelineFixture: Fixture;
beforeAll(async () => {
  page8Fixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}page8.ts`, import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
  timelineFixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}timeline.ts`, import.meta.url).href)) as { timelineFixture: Fixture }).timelineFixture;
});

const LABELS: CrumbLabels = {
  selectionPage: 'Page __name__',
  selectionGroup: '__name__',
  selectionFrame: '__name__',
  selectionBox: 'box __n__',
  selectionParagraph: 'paragraph __n__',
  selectionHeading: 'heading __n__',
  selectionListItem: 'list item __n__',
  selectionQuote: 'quote __n__',
  selectionCode: 'code __n__',
  selectionFormula: 'formula __n__',
  selectionContents: 'contents entry __n__',
  selectionFigure: 'figure __n__',
  selectionBlock: 'block __n__',
  selectionPicture: 'picture __name__',
  selectionLabel: 'label __name__',
  selectionAttr: 'attribute __name__',
  selectionText: 'text',
  selectionDecoration: 'decoration',
  selectionHeader: 'running head',
  selectionFooter: 'footer',
  selectionDesign: '__name__',
};

const build = (markdown: string, config: PostextConfig, resources: Parameters<typeof buildDocument>[0]['resources'] = []): VDTDocument =>
  buildDocument({ markdown, resources }, config, createMeasurementCache());

const page8 = (locale: 'es' | 'en', edit?: (md: string) => string) => {
  const f = page8Fixture(locale);
  const md = edit ? edit(f.markdown) : f.markdown;
  return { md, doc: build(md, f.config, f.resources) };
};
const composedPage = (doc: VDTDocument): VDTPage => doc.pages.find((p) => p.composed)!;
const frameBlocks = (page: VDTPage, name: string): VDTBlock[] => {
  const frame = page.composed!.frames.find((f) => f.name === name)!;
  return frame.blockIds.map((id) => page.floats!.find((b) => b.id === id)!).filter(Boolean);
};
/** A point on the first glyph of a block's first line. */
const onText = (b: VDTBlock) => ({ x: b.lines[0]!.bbox.x + 3, y: b.lines[0]!.bbox.y + b.lines[0]!.bbox.height / 2 });

describe('the page selection model (#865)', () => {
  let md: string;
  let doc: VDTDocument;
  let page: VDTPage;
  let paras: VDTBlock[];
  let second: VDTBlock;
  let at: { x: number; y: number };
  beforeAll(() => {
    ({ md, doc } = page8('es'));
    page = composedPage(doc);
    paras = frameBlocks(page, 'dinero').filter((b) => b.type === 'paragraph');
    second = paras[1]!;
    at = onText(second);
  });

  it('one click picks the innermost element: the glyph, its characters in the Markdown', () => {
    const sel = pickAt(doc, page.index, at.x, at.y, null)!;
    expect(sel.level).toBe(0);
    expect(sel.chain.map((e) => e.level)).toEqual(['text', 'block', 'frame', 'group', 'template']);
    const el = selectedElement(sel);
    expect(el.source.kind).toBe('markdown');
    const src = el.source as { start: number; end: number };
    expect(md.slice(src.start, src.end)).toBe('A');
    expect(selectionTarget(doc, sel, 'content')).toEqual({ kind: 'caret', offset: src.start });
  });

  it('each further click on the spot climbs: text → paragraph → frame → group → template', () => {
    let sel = pickAt(doc, page.index, at.x, at.y, null)!;
    const seen: string[] = [selectedElement(sel).level];
    for (let i = 0; i < 4; i++) {
      sel = pickAt(doc, page.index, at.x + 0.5, at.y, sel)!;
      seen.push(selectedElement(sel).level);
    }
    expect(seen).toEqual(['text', 'block', 'frame', 'group', 'template']);
    // The top stays the top on a click; Esc past it lets go.
    expect(selectedElement(pickAt(doc, page.index, at.x, at.y, sel)!).level).toBe('template');
    expect(climb(sel)).toBeNull();
  });

  it('a click somewhere else starts again at the innermost element', () => {
    const first = atLevel(pickAt(doc, page.index, at.x, at.y, null)!, 2);
    const other = onText(paras[0]!);
    const next = pickAt(doc, page.index, other.x, other.y, first)!;
    expect(next.level).toBe(0);
  });

  it('the breadcrumb is the path from the page: Page › cajas › dinero › paragraph 2', () => {
    const sel = atLevel(pickAt(doc, page.index, at.x, at.y, null)!, 1);
    const crumbs = breadcrumb(doc, sel);
    expect(breadcrumbText(crumbs, LABELS)).toBe(`Page ${page.pageLabel} › cajas › dinero › paragraph 2`);
    expect(crumbs.map((c) => c.current)).toEqual([false, false, false, true, false]);
    // The glyph level adds «text»; each item selects its level.
    const glyph = pickAt(doc, page.index, at.x, at.y, null)!;
    const path = breadcrumb(doc, glyph);
    expect(breadcrumbText(path, LABELS)).toBe(`Page ${page.pageLabel} › cajas › dinero › paragraph 2 › text`);
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS, { all: true })).toBe(`Page ${page.pageLabel} › cajas › dinero › paragraph 2 › text`);
    expect(breadcrumb(doc, sel).map((c) => c.inner ?? false)).toEqual([false, false, false, false, true]);
    expect(path.map((c) => c.level)).toEqual([4, 3, 2, 1, 0]);
  });

  it('a paragraph, a frame and the page select their Markdown in Content mode', () => {
    const sel = pickAt(doc, page.index, at.x, at.y, null)!;
    const para = selectionTarget(doc, atLevel(sel, 1), 'content') as { start: number; end: number };
    expect(md.slice(para.start, para.end)).toMatch(/^Antes casi todo se pagaba/);
    const frame = selectionTarget(doc, atLevel(sel, 2), 'content') as { start: number; end: number };
    expect(md.slice(frame.start, frame.end)).toMatch(/^El dinero nos deja[\s\S]*\*\*transferencia\*\* desde el banco\.$/);
    const tpl = selectionTarget(doc, atLevel(sel, 4), 'content') as { start: number; end: number };
    expect(md.slice(tpl.start, tpl.end)).toMatch(/^::::page\{template="tema-cajas"/);
    // A group is form only.
    expect(selectionTarget(doc, atLevel(sel, 3), 'content')).toEqual({ kind: 'none' });
  });

  it('Design mode opens the form: the frame for the template editor, the style of a box, the template', () => {
    const sel = pickAt(doc, page.index, at.x, at.y, null)!;
    expect(selectionTarget(doc, atLevel(sel, 2), 'design')).toMatchObject({ kind: 'frame', template: 'tema-cajas', frame: { name: 'dinero', configPath: '/pageTemplates/0/frames/2' } });
    expect(selectionTarget(doc, atLevel(sel, 1), 'design')).toMatchObject({ kind: 'settings', group: 'text', section: 'bodyText' });
    expect(selectionTarget(doc, atLevel(sel, 3), 'design')).toMatchObject({ kind: 'settings', group: 'page', path: '/pageTemplates/0/groups/0' });
    expect(selectionTarget(doc, atLevel(sel, 4), 'design')).toMatchObject({ kind: 'settings', group: 'page', path: '/pageTemplates/0' });
  });

  it('a heading in a frame names itself, and its look is in Headings', () => {
    const h1 = frameBlocks(page, 'titulo').find((b) => b.type === 'heading')!;
    const p = onText(h1);
    const sel = atLevel(pickAt(doc, page.index, p.x, p.y, null)!, 1);
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS)).toBe(`Page ${page.pageLabel} › titulo › heading 1`);
    expect(selectionTarget(doc, sel, 'design')).toMatchObject({ kind: 'settings', section: 'headings' });
  });

  it('a list item and a chip: list item n; the chip’s glyph maps into its words', () => {
    const items = frameBlocks(page, 'texto').filter((b) => b.type === 'listItem');
    const item = items[1]!;
    const chip = item.lines[0]!.segments!.find((s) => s.chip);
    expect(chip).toBeDefined();
    const p = onText(item);
    const sel = pickAt(doc, page.index, p.x, p.y, null)!;
    expect(breadcrumbText(breadcrumb(doc, atLevel(sel, 1)), LABELS)).toBe(`Page ${page.pageLabel} › texto › list item 2`);
    const glyph = selectedElement(sel).source as { start: number };
    expect(md.slice(glyph.start, glyph.start + 3)).toBe('Las');
    // On the chip: a character of its words, inside `:chip[…]`.
    const line = item.lines[0]!;
    let x = line.bbox.x;
    for (const s of line.segments!) {
      if (s.chip) break;
      x += s.width;
    }
    const onChip = pickAt(doc, page.index, x + chip!.width / 2, p.y, null)!;
    const c = selectedElement(onChip).source as { start: number };
    const word = md.indexOf(':chip[familias.]');
    expect(c.start).toBeGreaterThan(word + 5);
    expect(c.start).toBeLessThan(word + 15);
  });

  it('a box’s tab goes to its label attribute in the fence', () => {
    const box = frameBlocks(page, 'dinero').find((b) => b.type === 'callout')!;
    const tab = box.designOverlay!.blocks.find((b) => b.kind === 'text')!;
    const sel = pickAt(doc, page.index, tab.bbox.x + 4, tab.bbox.y + tab.bbox.height / 2, null)!;
    const el = selectedElement(sel);
    expect(el.source).toMatchObject({ kind: 'attr', name: 'label' });
    const t = selectionTarget(doc, sel, 'content') as { kind: string; offset: number };
    expect(t.kind).toBe('caret');
    expect(md.slice(t.offset, t.offset + 4)).toBe('Para');
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS)).toBe(`Page ${page.pageLabel} › cajas › dinero › attribute label`);
  });

  it('decoration goes to its template, {attr.x} to the attribute, the folio to its design element', () => {
    const deco = page.composed!.decoration!;
    const tema = deco.blocks.find((b) => b.elementId === 'tema')!;
    const sel = pickAt(doc, page.index, tema.bbox.x + 2, tema.bbox.y + tema.bbox.height / 2, null)!;
    expect(sel.chain.map((e) => e.level)).toEqual(['text', 'design', 'slot', 'template']);
    const caret = selectionTarget(doc, sel, 'content') as { offset: number };
    expect(md.slice(caret.offset, caret.offset + 5)).toBe('Retos');
    expect(selectionTarget(doc, atLevel(sel, 1), 'content')).toEqual({ kind: 'settings', group: 'page', section: 'pageTemplates', path: '/pageTemplates/0/decoration/elements/2' });
    expect(breadcrumbText(breadcrumb(doc, atLevel(sel, 1)), LABELS)).toBe(`Page ${page.pageLabel} › decoration › tema`);

    const folio = page.footer!.blocks[0]!;
    const f = pickAt(doc, page.index, folio.bbox.x + 1, folio.bbox.y + folio.bbox.height / 2, null)!;
    expect(selectedElement(f).level).toBe('design');
    expect(selectionTarget(doc, f, 'content')).toEqual({ kind: 'settings', group: 'running', section: 'headerFooter', path: '/footer/elements/0' });
    expect(breadcrumbText(breadcrumb(doc, f), LABELS)).toBe(`Page ${page.pageLabel} › footer › folio`);
  });

  it('a picture opens its resource', () => {
    const pic = frameBlocks(page, 'dinero-fotos').find((b) => b.resourceBlock)!;
    const sel = pickAt(doc, page.index, pic.bbox.x + pic.bbox.width / 2, pic.bbox.y + pic.bbox.height / 2, null)!;
    expect(selectedElement(sel).level).toBe('resource');
    expect(selectionTarget(doc, sel, 'content')).toEqual({ kind: 'resource', resourceId: 'foto-dinero' });
    expect(selectionTarget(doc, sel, 'design')).toEqual({ kind: 'resource', resourceId: 'foto-dinero' });
  });

  it('the picked element is marked on its page, not on others; a glyph shows as the caret', () => {
    const sel = pickAt(doc, page.index, at.x, at.y, null)!;
    expect(pickedMarkFor(doc, sel, page.index)).toBeNull();
    const para = atLevel(sel, 1);
    expect(pickedMarkFor(doc, para, page.index)!.rect).toEqual(second.bbox);
    expect(pickedMarkFor(doc, para, page.index + 1)).toBeNull();
    expect(pickedMarkFor(doc, atLevel(sel, 4), page.index)!.rect).toEqual({ x: 0, y: 0, width: page.width, height: page.height });
  });

  it('the editor’s caret is followed on the page at block level', () => {
    const offset = md.indexOf('Antes casi todo') + 6;
    const sel = selectionAtSource(doc, offset)!;
    expect(sel.origin).toBe('editor');
    expect(selectedElement(sel)).toMatchObject({ level: 'block', id: second.id });
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS)).toBe(`Page ${page.pageLabel} › cajas › dinero › paragraph 2`);
  });
});

describe('the selection survives a relayout and a locale switch (#865)', () => {
  beforeEach(() => resetPageSelection());

  it('a paragraph picked is found again after text above it grows (it moved)', () => {
    const before = page8('es');
    const page = composedPage(before.doc);
    const second = frameBlocks(page, 'dinero').filter((b) => b.type === 'paragraph')[1]!;
    const p = onText(second);
    const sel = atLevel(pickAt(before.doc, page.index, p.x, p.y, null)!, 1);
    const after = page8('es', (md) => md.replace('Cada familia necesita', `${'Una frase más que alarga el texto de la página. '.repeat(8)}Cada familia necesita`));
    const moved = frameBlocks(composedPage(after.doc), 'dinero').filter((b) => b.type === 'paragraph')[1]!;
    expect(moved.bbox.y).not.toBe(second.bbox.y);
    const again = resolveSelection(after.doc, sel)!;
    expect(selectedElement(again)).toMatchObject({ level: 'block', id: second.id });
    expect(selectedElement(again).rect).toEqual(moved.bbox);
    expect(again.chain.map((e) => e.level)).toEqual(['text', 'block', 'frame', 'group', 'template']);
  });

  it('a frame picked is found again after its content changed page position, and in the other locale', () => {
    const es = page8('es');
    const page = composedPage(es.doc);
    const frame = page.composed!.frames.find((f) => f.name === 'ahorro')!;
    const sel = pickAt(es.doc, page.index, frame.rect.x + 2, frame.rect.y + frame.rect.height - 2, null)!;
    const framed = atLevel(sel, sel.chain.findIndex((e) => e.level === 'frame'));
    const en = page8('en');
    const again = resolveSelection(en.doc, framed)!;
    expect(selectedElement(again)).toMatchObject({ level: 'frame', id: frame.id });
    const enFrame = composedPage(en.doc).composed!.frames.find((f) => f.name === 'ahorro')!;
    expect(selectedElement(again).rect).toEqual(enFrame.rect);
  });

  it('a paragraph picked in Spanish is the same paragraph in English (same slot)', () => {
    const es = page8('es');
    const page = composedPage(es.doc);
    const second = frameBlocks(page, 'dinero').filter((b) => b.type === 'paragraph')[1]!;
    const p = onText(second);
    const sel = atLevel(pickAt(es.doc, page.index, p.x, p.y, null)!, 1);
    const en = page8('en');
    const again = resolveSelection(en.doc, sel)!;
    expect(selectedElement(again).id).toBe(second.id);
    const src = selectedElement(again).source as { start: number; end: number };
    expect(en.md.slice(src.start, src.end)).toMatch(/^Not long ago almost everything/);
  });

  it('the store re-reads the selection on the next document and climbs with Esc', () => {
    const es = page8('es');
    const page = composedPage(es.doc);
    const second = frameBlocks(page, 'dinero').filter((b) => b.type === 'paragraph')[1]!;
    const p = onText(second);
    const applied: string[] = [];
    setPageSelection(pickAt(es.doc, page.index, p.x, p.y, null), es.doc, (s) => applied.push(selectedElement(s).level));
    const en = page8('en');
    const found = syncPageSelection(en.doc)!;
    expect(selectedElement(found).level).toBe('text');
    expect(pageSelectionNow()!.doc).toBe(en.doc);
    expect(climbPageSelection()).toBe(true);
    expect(selectedElement(pageSelectionNow()!.selection).level).toBe('block');
    selectPageLevel(2);
    expect(applied).toEqual(['block', 'frame']);
    climbPageSelection();
    climbPageSelection();
    climbPageSelection();
    expect(pageSelectionNow()).toBeNull();
  });
});

describe('the template editor’s picks and drags (#863 events)', () => {
  beforeEach(() => resetPageSelection());

  it('a frame it picks is the selection at frame level; a drag moves the mark, a drop lets it go', () => {
    const { doc } = page8('es');
    const page = composedPage(doc);
    const frame = page.composed!.frames.find((f) => f.name === 'gasto')!;
    followFrameEditor({ type: 'select', pageIndex: page.index, templateId: 'tema-cajas', frame: 'gasto', frameId: frame.id }, doc, null);
    const sel = pageSelectionNow()!.selection;
    expect(selectedElement(sel)).toMatchObject({ level: 'frame', id: frame.id });
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS)).toBe(`Page ${page.pageLabel} › cajas › gasto`);
    const rect = { x: frame.rect.x + 30, y: frame.rect.y + 12, width: frame.rect.width, height: frame.rect.height };
    followFrameEditor({ type: 'drag', pageIndex: page.index, kind: 'move', handle: 'move', frame: 'gasto', rect }, doc, null);
    expect(frameDragNow()).toMatchObject({ frame: 'gasto', rect });
    expect(pickedMarkFor(doc, sel, page.index, frameDragNow())!.rect).toEqual(rect);
    followFrameEditor({ type: 'drop', pageIndex: page.index, kind: 'move', handle: 'move', frame: 'gasto', rect }, doc, null);
    expect(frameDragNow()).toBeNull();
    expect(pickedMarkFor(doc, sel, page.index, frameDragNow())!.rect).toEqual(frame.rect);
  });
});

describe('labels, contents entries and spreads (#865)', () => {
  it('a figure label goes to its text in the Markdown (P6 lays the label out: a rect given by hand)', () => {
    const md = '::::page{template="m"}\n:::frame{slot="pic"}\n:::figure{resource="mapa"}\n::label[Madrid]{at="madrid"}\n:::\n:::\n::::';
    const config: PostextConfig = {
      page: { width: { value: 200, unit: 'mm' }, height: { value: 260, unit: 'mm' } } as never,
      pageTemplates: [{ id: 'm', frames: [{ name: 'pic', width: { value: 120, unit: 'mm' } }] }] as never,
    };
    const resources = [{ id: 'mapa', typeId: 'figure', kind: 'bitmap', caption: '', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'm.png', format: 'png', width: 400, height: 300, resolution: 72 } }] as never;
    const doc = build(md, config, resources);
    const page = composedPage(doc);
    const pic = page.floats!.find((b) => b.resourceBlock)!;
    const label = pic.resourceBlock!.labels![0]!;
    label.rect = { x: pic.bbox.x + 10, y: pic.bbox.y + 10, width: 60, height: 20 };
    const sel = pickAt(doc, page.index, label.rect.x + 2, label.rect.y + 10, null)!;
    expect(sel.chain.slice(0, 3).map((e) => e.level)).toEqual(['text', 'label', 'resource']);
    const t = selectionTarget(doc, atLevel(sel, 1), 'content') as { start: number; end: number };
    expect(md.slice(t.start, t.end)).toBe('Madrid');
    expect(breadcrumbText(breadcrumb(doc, atLevel(sel, 1)), LABELS)).toBe(`Page ${page.pageLabel} › pic › figure 1 › picture mapa › label madrid`);
    // Climbing the label: the picture opens in Resources.
    expect(selectionTarget(doc, atLevel(sel, 2), 'content')).toEqual({ kind: 'resource', resourceId: 'mapa' });
  });

  it('a contents entry goes to the heading that produced it', () => {
    const md = '---\ntitle: Libro\n---\n:::toc\n:::\n\n# Primero\n\nTexto.\n\n# Segundo\n\nMás texto.\n';
    const config: PostextConfig = { toc: { enabled: true } as never };
    const doc = build(md, config);
    const row = doc.blocks.find((b) => b.tocEntry?.headingSource !== undefined && b.lines.some((l) => (l.segments ?? []).some((s) => s.text.includes('Segundo'))));
    expect(row).toBeDefined();
    const p = onText(row!);
    const chain = sourceAt(doc, row!.pageIndex, p.x, p.y);
    const blockAt = chain.findIndex((e) => e.level === 'block');
    const sel: PageSelection = { pageIndex: row!.pageIndex, chain, level: blockAt, point: p, origin: 'page' };
    const t = selectionTarget(doc, sel, 'content');
    expect(t.kind).toBe('heading');
    const hit = headingInChapters([{ id: 'otro', markdown: '# Nada\n' }, { id: 'c1', markdown: md }], (t as { bodyOffset: number }).bodyOffset, (t as { title: string }).title)!;
    expect(hit.chapterId).toBe('c1');
    expect(md.slice(hit.start, hit.end)).toBe('# Segundo');
    expect(breadcrumbText(breadcrumb(doc, sel), LABELS)).toMatch(/contents entry \d+$/);
  });

  it('the facing half of a spread frame selects the block it shows, on the page it is seen on', () => {
    const { markdown, config, resources } = timelineFixture('es');
    const doc = build(markdown, config, resources);
    const facing = doc.pages.flatMap((pg) => (pg.composed?.frames ?? []).flatMap((f) => (f.facingBlocks ?? []).map((b) => ({ pg, f, b })))).find((x) => x.b.lines.length > 0 && x.b.type === 'paragraph');
    expect(facing).toBeDefined();
    if (!facing) return;
    const p = onText(facing.b);
    const sel = pickAt(doc, facing.pg.index, p.x, p.y, null)!;
    const block = sel.chain.find((e) => e.level === 'block')!;
    expect(block.facing).toBe(true);
    expect(block.id.endsWith('-facing')).toBe(false);
    expect(selectionTarget(doc, atLevel(sel, sel.chain.indexOf(block)), 'content').kind).toBe('markdown');
  });

  it('a config pointer opens the section that edits it', () => {
    expect(sectionForConfigPath('/header/elements/0')).toEqual({ group: 'running', section: 'headerFooter' });
    expect(sectionForConfigPath('/headingStyles/1/header')).toEqual({ group: 'headings', section: 'headingStyles' });
    expect(sectionForConfigPath('/calloutStyles/2')).toEqual({ group: 'callouts', section: 'calloutStyles' });
    expect(sectionForConfigPath('/pageTemplates/0/decoration/elements/1')?.group).toBe('page');
    expect(sectionForConfigPath('')).toBeNull();
  });
});
