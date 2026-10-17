// The fixes of a frame that does not fit, for an agent (#868):
// sandbox_get_warnings lists them, numbered; sandbox_apply_proposal makes
// one (the one-click fix of the Checks and Reflow panels), lays the book
// out again and says whether the frame fits; sandbox_undo takes it back.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  it('refuses a frame that fits, a fix it does not have, and says which frames do not fit', async () => {
    const { call } = harness(book());
    expect((await call('sandbox_apply_proposal', { frame: 'gasto', proposal: 1 })).error).toMatch(/"gasto" fits .* The frames that do not fit: dinero \(page 1\)/);
    expect((await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 'lowerMin' })).error).toMatch(/No such fix for "dinero"\. Its fixes: 1\. /);
    expect((await call('sandbox_apply_proposal', { frame: 'dinero', proposal: 99 })).error).toMatch(/No such fix/);
  });
});
