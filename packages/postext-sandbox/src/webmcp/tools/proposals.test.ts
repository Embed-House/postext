// The fixes of a frame that does not fit, for an agent (#868):
// sandbox_get_warnings lists them, numbered; sandbox_apply_proposal makes
// one (the one-click fix of the Checks and Reflow panels), lays the book
// out again and says whether the frame fits; sandbox_undo takes it back.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { setActiveHistory } from '../../history/sandboxHistory';
import { resetViewerEdits } from '../../editor/viewerEdits';
import { chapter, harness } from './testHarness';

type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const FIXTURES = '../../../../postext/src/__tests__/composed/fixtures/';
let page8Fixture: Fixture;
beforeAll(async () => {
  page8Fixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}page8.ts`, import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
});
afterEach(() => {
  setActiveHistory(null);
  resetViewerEdits();
});

const mm = (value: number) => ({ value, unit: 'mm' as const });

/** The stand-in with its first box held to 36 mm and four more paragraphs. */
function book() {
  const fixture = page8Fixture('en');
  const tpl = fixture.config.pageTemplates![0]!;
  const config: PostextConfig = {
    ...fixture.config,
    pageTemplates: [{ ...tpl, frames: tpl.frames!.map((f) => (f.name === 'dinero' ? { ...f, height: mm(36), minHeight: undefined } : f)) }],
  };
  const extra = Array.from({ length: 4 }, (_, i) => `More money ${i} `.repeat(30).trim()).join('\n\n');
  const markdown = fixture.markdown.replace(/(:::frame\{slot="dinero"[^\n]*\n)/, `$1${extra}\n\n`);
  const chapters = [chapter('p8', 'Page 8', markdown)];
  return { chapters, activeChapterId: 'p8', markdown, config, resources: fixture.resources };
}

type Listed = { kind: string; frame?: string; page?: number; proposals?: { number: number; kind: string; words: string }[] };

describe('sandbox_inspect_pages on a composed page', () => {
  it('says what the layout moved, in the reflow log’s words', async () => {
    const { call } = harness(book());
    const done = await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 'raiseMax' });
    expect(done.fits).toBe(true);
    const pages = await call('sandbox_inspect_pages', { position: 1 });
    const page = pages.pages[0];
    expect(page.composed.template).toBe('tema-cajas');
    expect(page.composed.reflow[0]).toMatch(/^dinero grew [\d.]+ mm$/);
    expect(page.composed.reflow.some((l: string) => /^gasto moved down [\d.]+ mm$/.test(l))).toBe(true);
  });
});

describe('sandbox_apply_proposal', () => {
  it('lists the fixes with the warning, makes one, and says the frame fits; sandbox_undo takes it back', async () => {
    const { call, get } = harness(book());
    const found = await call('sandbox_get_warnings');
    const overflow = (found.warnings as Listed[]).find((w) => w.kind === 'frameOverflow')!;
    expect(overflow.frame).toBe('dinero');
    expect(overflow.proposals!.map((p) => p.number)).toEqual(overflow.proposals!.map((_, i) => i + 1));
    const shrink = overflow.proposals!.find((p) => p.kind === 'allowShrink')!;
    expect(shrink.words).toMatch(/^let its text shrink to /);

    const before = get().config;
    const done = await call('sandbox_apply_proposal', { frame: 'dinero', proposal: shrink.number });
    expect(done).toMatchObject({ ok: true, changed: true, fits: true, fix: { kind: 'allowShrink' }, chapter: 1 });
    expect(done.settings[0]).toMatchObject({ pointer: '/pageTemplates/0/frames/2/fit/minScale', setting: 'tema-cajas › dinero › fit.minScale' });
    expect(get().config).not.toEqual(before);
    const again = await call('sandbox_get_warnings');
    expect((again.warnings as Listed[]).some((w) => w.kind === 'frameOverflow')).toBe(false);

    const undone = await call('sandbox_undo');
    expect(undone).toMatchObject({ ok: true, undone: { kind: 'design' } });
    expect(get().config).toEqual(before);
  });

  it('by kind; shortenText only selects the text and says how much to cut', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 'shortenText' });
    expect(done).toMatchObject({ ok: true, changed: false, fix: { kind: 'shortenText' } });
    expect(done.cutCharacters).toBeGreaterThan(0);
    const text = get().chapters[0]!.markdown;
    expect(text.slice(done.selected.offset, done.selected.toOffset)).toContain('More money 0');
    expect(get().pendingEditorFocus).toMatchObject({ chapterId: 'p8', anchor: done.selected.offset, head: done.selected.toOffset });
    expect(get().chapters[0]!.markdown).toBe(text);

    const next = await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 'continueNextPage' });
    expect(next).toMatchObject({ ok: true, changed: true, fits: true });
    expect(next.settings[0].value).toBe('"next-page"');
  });

  it('refuses a frame with nothing to fix, a fix it does not have, and says which frames have fixes', async () => {
    const { call } = harness(book());
    expect((await call('sandbox_apply_proposal', { frame: 'gasto', proposal: 1 })).error).toMatch(/"gasto" has no such check in chapter 1\. The frames with fixes: dinero \(frameOverflow, page 1\)/);
    expect((await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 'lowerMin' })).error).toMatch(/No such fix for "dinero"\. Its fixes: 1\. /);
    expect((await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 99 })).error).toMatch(/No such fix/);
  });
});

describe('sandbox_apply_proposal on a held pill (#1090)', () => {
  const pt = (value: number) => ({ value, unit: 'pt' as const });
  const WORD = 'Administrationalism';
  const MARKDOWN = `::::page{template="t"}\n\n:::frame{slot="pill"}\n${WORD}\n:::\n\n::::`;
  /** A pill held to 10.5 mm whose one word is wider than its measure, its
   *  text not allowed to shrink (`minScale: 1`): the word is divided. */
  function pillBook() {
    const config = {
      page: { width: mm(200), height: mm(260), dpi: 300, margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } },
      headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: false } }] },
      bodyText: { fontSize: pt(11), lineHeight: pt(16), firstLineIndent: pt(0) },
      calloutStyles: [{ id: 'pill', backgroundEnabled: true, background: { hex: '#cfe3f5', model: 'hex' }, padding: { top: mm(0), right: mm(1), bottom: mm(0), left: mm(1) } }],
      pageTemplates: [{ id: 't', frames: [{ name: 'pill', style: 'pill', placement: { anchor: { to: 'container', edge: 'top-left' } }, width: mm(10), minHeight: mm(10.5), maxHeight: mm(10.5), verticalAlign: 'middle', fit: { minScale: 1 } }] }],
    } as unknown as PostextConfig;
    return { chapters: [chapter('c', 'Pill', MARKDOWN)], activeChapterId: 'c', markdown: MARKDOWN, config, resources: [] };
  }
  /** The pill's lines as the book lays them out with `config`. */
  const pillLines = (config: PostextConfig): string[] => {
    const doc = buildDocument({ markdown: MARKDOWN }, config, createMeasurementCache());
    const page = doc.pages.find((p) => p.composed)!;
    const ids = page.composed!.frames.find((f) => f.name === 'pill')!.blockIds;
    return (page.floats ?? []).filter((b) => ids.includes(b.id)).flatMap((b) => (b.lines ?? []).map((l) => l.text));
  };

  it('the shrink proposal names the scale that keeps the word whole; applied, the check is gone and the word whole', async () => {
    const { call, get } = harness(pillBook());
    expect(pillLines(get().config).length).toBe(2);
    const found = await call('sandbox_get_warnings');
    const overflow = (found.warnings as Listed[]).find((w) => w.kind === 'frameOverflow')!;
    const shrink = overflow.proposals!.find((p) => p.kind === 'allowShrink')!;
    expect(shrink.words).toBe('let its text shrink to 75 %, where its long word is whole (fit.minScale: 0.75)');
    const done = await call('sandbox_apply_proposal', { frame: 'pill', proposal: 'allowShrink' });
    expect(done).toMatchObject({ ok: true, changed: true, fits: true, fix: { kind: 'allowShrink' } });
    expect(get().config.pageTemplates![0]!.frames![0]!.fit?.minScale).toBe(0.75);
    const again = await call('sandbox_get_warnings');
    expect((again.warnings as Listed[]).some((w) => w.kind === 'frameOverflow')).toBe(false);
    expect(pillLines(get().config)).toEqual([WORD]);
  });
});
