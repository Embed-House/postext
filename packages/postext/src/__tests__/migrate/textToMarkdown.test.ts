import { describe, it, expect } from 'vitest';
import { buildDocument, collectConfigWarnings, configDesignSlots, moveTextToMarkdown } from '../../index.js';
import { createMeasurementCache } from '../../measure/index.js';
import { scanChapter } from '../../migrate/markdownRuns.js';
import { joinLines } from '../../migrate/pageDesign.js';
import type { PageTemplate, PostextConfig } from '../../index.js';
import { PORT_CHAPTERS, PORT_CONFIG } from './fixtures/textbookPort.js';

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

const metadata = { title: 'Our World' };
const run = (opts = {}) => moveTextToMarkdown({ config: PORT_CONFIG, chapters: PORT_CHAPTERS, metadata }, opts);
const contentWarnings = (config: PostextConfig) => collectConfigWarnings(config, { metadata }).filter((w) => w.kind === 'contentInConfig');
const template = (config: PostextConfig, id: string): PageTemplate => config.pageTemplates!.find((t) => t.id === id)!;

describe('moveTextToMarkdown (#874)', () => {
  it('leaves no content in the configuration but the style no heading uses, and removes that one when asked', () => {
    expect(contentWarnings(PORT_CONFIG).length).toBe(8);
    const kept = run();
    expect(kept.unchanged).toBe(false);
    // Only the unused style still holds a sentence.
    expect(contentWarnings(kept.config).map((w) => w.ownerId)).toEqual(['topic--p9']);
    expect(kept.report.unusedStyles).toEqual(['topic--p9']);
    expect(kept.report.left).toContainEqual({ path: 'headingStyles[id=topic--p9]', reason: 'unused' });
    const removed = run({ unusedStyles: 'remove' });
    expect(contentWarnings(removed.config)).toEqual([]);
    expect(removed.report.contentInConfigAfter).toEqual({ warnings: 0, elements: 0, chars: 0 });
    expect(removed.report.contentInConfigBefore.warnings).toBe(8);
    expect(removed.report.headingStylesRemoved).toEqual(['topic--p9']);
    expect(removed.report.configBytesAfter).toBeLessThan(removed.report.configBytesBefore);
  });

  it('writes a page fence per page, with the text in frame slots, the page picture as an attribute and the hard breaks kept', () => {
    const { chapters, report } = run();
    const ch1 = chapters.find((c) => c.id === 'ch1')!.markdown;
    // The front matter and the headings stay; each design's run is a fence.
    expect(ch1.startsWith('---\ntitle: "Our World"\n---')).toBe(true);
    expect(ch1.match(/^::::page\{/gm)!.length).toBe(2);
    expect(ch1).toMatch(/::::page\{template="page-base" background="art-p1"\}\n# Rivers and seas \{style="topic" id="t-rivers"\}\n\n# Where rivers start \{style="next--p1" id="t-springs"\}/);
    // A highlight box under a bold word became the book's chip of its colour.
    expect(ch1).toContain('Water covers most of the planet. :chip[Rivers]{style="key"} carry it from the hills\\\ndown to the sea');
    expect(ch1).toContain(':::frame{slot="shared-');
    expect(ch1).toMatch(/:::paragraphs\{style="fixture-stamp-32-center"\}\nRivers and seas\n:::\n:::/);
    expect(report.chips).toBe(3);
    expect(report.pages.map((p) => [p.chapterId, p.fence, p.template])).toEqual([
      ['ch1', 0, 'page-base'], ['ch1', 1, 'p2'], ['ch2', 0, 'p3'], ['ch2', 1, 'p3'], ['ch2', 2, 'spread'], ['ch2', 3, 'spread'],
    ]);
  });

  it('joins text blocks of one look set under one another into one frame', () => {
    const { config, chapters, report } = run();
    const ch1 = chapters.find((c) => c.id === 'ch1')!.markdown;
    const body = ch1.slice(ch1.indexOf('Water covers'), ch1.indexOf('never stop.') + 'never stop.'.length);
    // Three elements, three paragraphs of one frame.
    expect(body.split('\n\n').length).toBe(3);
    expect(body).not.toContain(':::');
    // Kicker, title and body on three pages, a label, the spread's three;
    // the atlas line keeps its placeholder.
    expect(report.movedElements).toBe(5 + 6 + 5 + 3);
    const style = config.paragraphStyles!.find((p) => p.id === 'fixture-sans-11')!;
    expect(style).toMatchObject({ fontFamily: 'Fixture Sans', lineHeight: { value: 1.5, unit: 'em' }, textAlign: 'left', hyphenation: false, spaceBetween: { value: 0, unit: 'mm' }, snapToGrid: false });
  });

  it('proposes a shared template for pages with frames in the same places, and the pages’ own extend it', () => {
    const { config, report } = run();
    const base = report.templates.find((t) => t.id === 'page-base')!;
    // The first page draws nothing of its own: it is laid on the base.
    expect(base).toMatchObject({ pages: 1 });
    const t = template(config, 'page-base');
    expect(t.frames!.map((f) => f.name)).toEqual(['flow', 'shared-1', 'shared-2', 'shared-3']);
    expect(t.frames![0]).toEqual({ name: 'flow', flow: true, optional: true, layer: -1 });
    // The page picture is the page's attribute, shared by every page.
    expect(t.decoration!.elements[0]).toMatchObject({ kind: 'image', resourceId: '{attr.background}' });
    expect(t.header).toBe(false);
    expect(t.footer).toBe(false);
    expect(template(config, 'p2').extends).toBe('page-base');
    expect(template(config, 'p2').frames!.map((f) => f.name)).toEqual(['text-1']);
    // The card is drawn by every page (under its own id): the base's.
    expect(t.decoration!.elements.map((e) => e.id)).toEqual(['page', 'card-p1']);
    expect(template(config, 'p3').decoration!.elements.map((e) => e.id)).toEqual(['folio-p3']);
    // No sharing: one template per page design.
    const solo = run({ shareTemplates: false });
    expect(solo.config.pageTemplates!.every((x) => x.extends === undefined)).toBe(true);
    expect(solo.report.templates.length).toBe(4);
    expect(solo.report.templates.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'spread']);
  });

  it('merges the page styles left the same, renames them in the Markdown and drops the headings that only switched the page', () => {
    const { config, chapters, report } = run();
    expect(report.headingStylesMerged).toEqual([
      { into: 'topic', from: ['topic--p1', 'topic--p2', 'topic--p3'] },
    ]);
    const ids = config.headingStyles!.map((s) => s.id);
    expect(ids).toEqual(['topic', 'next--p1', 'cont--p3', 'spread', 'cont--spread', 'topic--p9']);
    expect(config.headingStyles!.find((s) => s.id === 'topic')).not.toHaveProperty('header');
    const ch2 = chapters.find((c) => c.id === 'ch2')!.markdown;
    expect(ch2).toContain('# Maps and plans {style="topic" id="t-maps"}');
    expect(ch2).not.toContain('###### ·');
    // Bare breaks next to composed pages go; the spread's side is a break's.
    expect(ch2).not.toMatch(/^:::pagebreak$/m);
    expect(ch2).toContain(':::pagebreak{parity="even"}\n\n::::page{template="spread"}');
    expect(report.headingsDropped).toBe(1);
  });

  it('keeps a text that mixes words and a placeholder in the decoration and says so', () => {
    const { config, report } = run();
    expect(report.left).toContainEqual({ path: 'headingStyles[3] #folio-p3', reason: 'placeholder' });
    expect(JSON.stringify(template(config, 'p3'))).toContain('Atlas page {pageNumber}');
  });

  it('sets a spread’s sides from the opening heading’s parity: verso frames in the verso variant, recto in the recto', () => {
    const { config, chapters, report } = run();
    const t = template(config, 'spread');
    expect(t.variants?.verso?.frames?.length).toBe(1);
    expect(t.variants?.recto?.frames?.length).toBe(2);
    const spreadPages = report.pages.filter((p) => p.template === 'spread');
    expect(spreadPages.map((p) => p.side)).toEqual(['verso', 'recto']);
    expect(spreadPages[0]!.differences).toContain('flow');
    const ch2 = chapters.find((c) => c.id === 'ch2')!.markdown;
    const first = ch2.slice(ch2.indexOf('# Long ago'), ch2.indexOf('::::', ch2.indexOf('# Long ago')));
    expect(first).toContain('Long ago people lived in caves');
    expect(first).not.toContain('built towns');
    expect(first).toContain('Some running text');
    // The second page's own text, recto frames merged into one.
    const second = ch2.slice(ch2.lastIndexOf('::::page'));
    expect(second).toContain('Later they built towns and wrote down their laws.');
    expect(second).toContain('Writing changed how people kept their history.');
  });

  it('lays out: every fence is a composed page, every moved text is set in its frame, the contents still finds the headings', () => {
    const { config, chapters } = run({ unusedStyles: 'remove' });
    for (const ch of chapters) {
      const doc = buildDocument({ markdown: ch.markdown }, config, createMeasurementCache());
      const fences = ch.markdown.match(/^::::page\{/gm)!.length;
      const composed = doc.pages.filter((p) => p.composed);
      expect(composed.length).toBe(fences);
      // The spread opens on a verso, as its heading asked: page 3 is blank.
      expect(doc.pages.length).toBe(ch.id === 'ch2' ? fences + 1 : fences);
      if (ch.id === 'ch2') expect(composed.slice(-2).map((p) => p.composed!.variant)).toEqual(['verso', 'recto']);
      const kinds = new Set([...(doc.contentWarnings ?? []), ...(doc.warnings ?? [])].map((w: { kind: string }) => w.kind));
      for (const k of ['slotUnknown', 'templateUnknown', 'pageFenceLength', 'unknownDirective']) expect(kinds.has(k)).toBe(false);
      const words = composed.flatMap((p) => p.composed!.frames.flatMap((f) => f.blockIds.map((id) => p.floats!.find((b) => b.id === id)!).flatMap((b) => b.lines.map((l) => l.text)))).join(' ');
      if (ch.id === 'ch1') {
        expect(words).toContain('Water covers most of the planet.');
        expect(words).toContain('Rain gauge');
      } else {
        expect(words).toContain('Writing changed how people kept their history.');
      }
    }
  });

  it('gives back the book unchanged when nothing is held in a page design', () => {
    const clean: PostextConfig = { headingStyles: [{ id: 'plain', header: { elements: [{ kind: 'text', id: 'h', content: '{chapterTitle}', fontSize: { value: 9, unit: 'pt' }, placement: { anchor: { to: 'page', edge: 'top-left' } } }] } } as never] };
    const res = moveTextToMarkdown({ config: clean, chapters: [{ id: 'a', markdown: '# A {style="plain"}\n' }] });
    expect(res.unchanged).toBe(true);
    expect(res.config).toBe(clean);
    expect(res.chapters[0]!.markdown).toBe('# A {style="plain"}\n');
  });

  it('turns highlights into chips only when asked', () => {
    const off = run({ highlightsToChips: false });
    expect(off.report.chips).toBe(0);
    expect(off.chapters[0]!.markdown).toContain('**Rivers**');
    expect(JSON.stringify(off.config.pageTemplates)).toContain('hl-p1');
  });
});

describe('scanChapter (#874)', () => {
  const designOf = (id: string) => (id.startsWith('a') ? 'A' : id.startsWith('b') ? 'B' : undefined);
  const scan = (md: string) => scanChapter(md, { designOf, breaksPage: (h) => h.level === 1 });

  it('closes a run at another design, a part and the chapter end; carries containers and code along', () => {
    const md = [
      '# One {style="a1"}', 'text', ':::callout', '# not a heading here {style="b1"}', ':::', '```', '# code {style="b1"}', '```',
      '## sub', '# Two {style="b1"}', 'more', ':::part{title="P"}', ':::', '# Three {style="a2"}',
    ].join('\n');
    const s = scan(md);
    expect(s.runs.map((r) => [r.design, r.startLine, r.endLine])).toEqual([['A', 0, 8], ['B', 9, 10], ['A', 13, 13]]);
  });

  it('starts a new page at a page break or a heading that breaks the page, and drops the breaks next to runs', () => {
    const md = ['# One {style="a1"}', 'x', '', ':::pagebreak', '', '###### · {style="a2"}', '# Again {style="a3"}', ':::pagebreak', '# Other {style="b1"}'].join('\n');
    const s = scan(md);
    expect(s.runs[0]!.pages.map((p) => [p.startLine, p.endLine])).toEqual([[0, 1], [5, 5], [6, 6]]);
    expect(s.runs[0]!.endLine).toBe(6);
    expect(s.runs[1]!.startLine).toBe(8);
    expect(s.dropBreaks).toEqual([7]);
  });
});

describe('text as Markdown (#874)', () => {
  it('prints a design text as the design printed it: marks kept or escaped, dollars and backslashes literal', () => {
    const el = (id: string, content: string, inlineMarks: boolean, y: number) => ({ kind: 'text', id, content, inlineMarks, fontSize: { value: 11, unit: 'pt' }, align: 'left', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: { value: 20, unit: 'mm' }, y: { value: y, unit: 'mm' } }, size: { width: { value: 150, unit: 'mm' } } } });
    const config = { headingStyles: [{ id: 's', hidden: true, header: { elements: [
      el('a', 'Costs $5 *each* in C:\\shop, said the sign', false, 20),
      el('b', 'The **key** word, and $3 too', true, 60),
    ] } }] } as unknown as PostextConfig;
    const res = moveTextToMarkdown({ config, chapters: [{ id: 'c', markdown: '# Shop {style="s"}\n' }] });
    const doc = buildDocument({ markdown: res.chapters[0]!.markdown }, res.config, createMeasurementCache());
    const page = doc.pages.find((p) => p.composed)!;
    const texts = page.composed!.frames.flatMap((f) => f.blockIds.map((id) => page.floats!.find((b) => b.id === id)!).filter((b) => b.type === 'paragraph').map((b) => b.lines.map((l) => l.text).join(' ')));
    expect(texts).toContain('Costs $5 *each* in C:\\shop, said the sign');
    expect(texts).toContain('The key word, and $3 too');
  });
});

describe('moveTextToMarkdown carries tracking (#907)', () => {
  /** The port with its page titles tracked +15/1000 em, as the textbook's
   *  are: on most pages in em, on the third in points (0.48 pt of 32 pt). */
  const tracked = (): PostextConfig => {
    const json = JSON.parse(JSON.stringify(PORT_CONFIG)) as PostextConfig;
    for (const style of json.headingStyles ?? []) {
      for (const el of (style.header?.elements ?? []) as { kind: string; id: string; letterSpacing?: unknown }[]) {
        if (el.kind !== 'text' || !el.id.startsWith('title-')) continue;
        el.letterSpacing = el.id === 'title-p3' ? { value: 0.48, unit: 'pt' } : { value: 0.015, unit: 'em' };
      }
    }
    return json;
  };

  it('writes a moved text’s letter spacing into the paragraph style it creates, in ems of its size', () => {
    const { config, chapters, report } = moveTextToMarkdown({ config: tracked(), chapters: PORT_CHAPTERS, metadata });
    const titles = config.paragraphStyles!.filter((p) => p.fontFamily === 'Fixture Stamp' && p.fontSize && (p.fontSize as { value: number }).value === 32);
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t.letterSpacing).toEqual({ value: 0.015, unit: 'em' });
    // The pages no longer report tracking as a difference.
    expect(report.pages.flatMap((p) => p.differences)).not.toContain('letterSpacing');
    // An untracked look gets none.
    expect(config.paragraphStyles!.find((p) => p.id === 'fixture-sans-11')!.letterSpacing).toBeUndefined();
    // Laid out, the title is set tracked in its frame.
    const ch1 = chapters.find((c) => c.id === 'ch1')!;
    const doc = buildDocument({ markdown: ch1.markdown }, config, createMeasurementCache());
    const page = doc.pages.find((p) => p.composed)!;
    const title = (page.floats ?? []).find((b) => b.type === 'paragraph' && b.lines[0]?.text === 'RIVERS AND SEAS');
    const sizePx = (32 / 72) * doc.config.page.dpi;
    expect(title?.letterSpacing).toBeCloseTo(0.015 * sizePx, 5);
  });

  it('keeps tracked and untracked texts of one look apart', () => {
    const config = tracked();
    const p1 = config.headingStyles!.find((s) => (s.header?.elements ?? []).some((e) => e.id === 'title-p1'))!;
    const el = (p1.header!.elements as { id: string; letterSpacing?: unknown }[]).find((e) => e.id === 'title-p1')!;
    delete el.letterSpacing;
    const out = moveTextToMarkdown({ config, chapters: PORT_CHAPTERS, metadata }).config;
    const titles = out.paragraphStyles!.filter((p) => p.fontFamily === 'Fixture Stamp' && (p.fontSize as { value: number }).value === 32);
    expect(titles.some((t) => t.letterSpacing === undefined)).toBe(true);
    expect(titles.some((t) => t.letterSpacing !== undefined)).toBe(true);
  });
});

describe('joinLines (#874)', () => {
  it('breaks lines with a backslash, and on the same line where the next would start a list', () => {
    expect(joinLines(['a', 'b'])).toBe('a\\\nb');
    expect(joinLines(['1978. A year', '- next'])).toBe('​1978. A year \\\\ - next');
  });
});

describe('configDesignSlots and page templates (#874)', () => {
  it('lists a template’s decoration, running heads and variants, so the check reads them', () => {
    const config: PostextConfig = {
      pageTemplates: [{
        id: 't',
        decoration: { elements: [{ kind: 'text', id: 'x', content: 'A whole sentence written into the template itself.', fontSize: { value: 9, unit: 'pt' }, placement: { anchor: { to: 'page', edge: 'top-left' } } } as never] },
        variants: { recto: { header: { elements: [] } } },
      }],
    };
    expect(configDesignSlots(config).map((s) => [s.path, s.kind, s.owner, s.ownerId])).toEqual([
      ['pageTemplates[0].decoration', 'decoration', 'pageTemplates[0]', 't'],
      ['pageTemplates[0].variants.recto.header', 'header', 'pageTemplates[0]', 't'],
    ]);
    expect(collectConfigWarnings(config).filter((w) => w.kind === 'contentInConfig').map((w) => w.path)).toEqual(['pageTemplates[0]']);
  });
});
