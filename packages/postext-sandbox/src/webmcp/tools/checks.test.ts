import { describe, expect, it } from 'vitest';
import { chapter, harness } from './testHarness';

const PARAGRAPH = 'Print typography spent five centuries learning how to set a page, and a browser learned how to lay out an interface in a few decades. ';

/** A book whose faults are in the chapters that are not on screen: the
 *  second skips a heading level, the third places a figure the book does
 *  not have. */
function book() {
  const chapters = [
    chapter('a', 'Opening', `# Opening\n\n${PARAGRAPH.repeat(6)}\n`),
    chapter('b', 'Second', `# Second\n\n${PARAGRAPH}\n\n### Too deep\n\n${PARAGRAPH}\n`),
    chapter('c', 'Third', `# Third\n\n${PARAGRAPH}\n\n::resource{id="nowhere"}\n\n${PARAGRAPH}\n`),
  ];
  return { chapters, markdown: chapters[0]!.markdown };
}

type Found = { kind: string; category: string; chapter?: number; line?: number; offset?: number; toOffset?: number; title: string; id: string };

describe('sandbox_get_warnings', () => {
  it('checks the chapter asked for, whatever chapter and viewer are on screen', async () => {
    const { call, get } = harness({ ...book(), activeViewport: 'pdf' });
    const second = await call('sandbox_get_warnings', { chapter: 2 });
    expect(second).toMatchObject({ ok: true, scope: 'chapter', chapter: 2, title: 'Second' });
    const skipped = (second.warnings as Found[]).find((w) => w.kind === 'headingHierarchy')!;
    expect(skipped).toMatchObject({ category: 'markup', chapter: 2, line: 5 });
    // Where it points in the chapter's own text.
    expect(get().chapters[1]!.markdown.slice(skipped.offset, skipped.toOffset)).toContain('Too deep');
    expect(skipped.title.length).toBeGreaterThan(0);

    const third = await call('sandbox_get_warnings', { chapter: 'Third', category: 'figures' });
    expect((third.warnings as Found[]).map((w) => w.kind)).toEqual(['unknownResourceId']);
    expect(third.byCategory.figures).toBe(1);

    // The chapter on screen has neither.
    const open = await call('sandbox_get_warnings');
    expect(open.chapter).toBe(1);
    expect((open.warnings as Found[]).some((w) => w.kind === 'headingHierarchy' || w.kind === 'unknownResourceId')).toBe(false);
    // Nothing was shown or switched to for it.
    expect(get().activeChapterId).toBe('a');
    expect(get().activeViewport).toBe('pdf');
  });

  it('checks the whole book, a warning of the book itself listed once', async () => {
    const { call } = harness(book());
    const whole = await call('sandbox_get_warnings', { scope: 'book' });
    expect(whole.scope).toBe('book');
    expect(whole.chapters.map((c: { chapter: number; title: string }) => [c.chapter, c.title])).toEqual([[1, 'Opening'], [2, 'Second'], [3, 'Third']]);
    const found = whole.warnings as Found[];
    expect(found.find((w) => w.kind === 'headingHierarchy')!.chapter).toBe(2);
    expect(found.find((w) => w.kind === 'unknownResourceId')!.chapter).toBe(3);
    expect(whole.chapters[1].warnings).toBeGreaterThan(0);
    expect(whole.chapters[0].warnings).toBe(0);
    // No store for pictures here: said once, not once per chapter, and of no chapter.
    const system = found.filter((w) => w.kind === 'storageUnavailable');
    expect(system).toHaveLength(1);
    expect(system[0]!.chapter).toBeUndefined();
    expect(new Set(found.map((w) => `${w.chapter}:${w.id}`)).size).toBe(found.length);
    expect(whole.total).toBe(found.length);
  });

  it('follows a change at once, and lists up to the limit', async () => {
    const { call } = harness(book());
    await call('sandbox_edit_text', { chapter: 2, edits: [{ find: '### Too deep', replace: '## Deep enough' }], wait: false });
    const mended = await call('sandbox_get_warnings', { chapter: 2 });
    expect((mended.warnings as Found[]).some((w) => w.kind === 'headingHierarchy')).toBe(false);
    const few = await call('sandbox_get_warnings', { scope: 'book', limit: 1 });
    expect(few.warnings).toHaveLength(1);
    expect(few.more).toBe(few.total - 1);
    expect((await call('sandbox_get_warnings', { chapter: 9 })).error).toMatch(/No chapter 9/);
  });
});
