import { describe, expect, it } from 'vitest';
import { harness } from './testHarness';

describe('the Sandbox tools', () => {
  it('are named apart, described, and take an object', () => {
    const { tools, list } = harness();
    expect(tools.size).toBe(list.length);
    expect(list[0]!.name).toBe('sandbox_get_state');
    for (const tool of tools.values()) {
      expect(tool.name).toMatch(/^sandbox_[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    // What cannot be taken back says so.
    expect([...tools.values()].filter((t) => t.annotations?.consequentialHint).map((t) => t.name).sort()).toEqual([
      'sandbox_delete_book', 'sandbox_delete_resource', 'sandbox_remove_chapter', 'sandbox_reset_to_original',
    ]);
  });

  it('say what is open', async () => {
    const { call } = harness();
    const s = await call('sandbox_get_state');
    expect(s.ok).toBe(true);
    expect(s.book).toEqual({ kind: 'sample', id: 'guide', name: 'Guide' });
    expect(s.chapters.map((c: { title: string }) => c.title)).toEqual(['Opening', 'Second']);
    expect(s.chapters[0].onScreen).toBe(true);
    expect(s.view).toMatchObject({ viewer: 'canvas', panel: 'none', scope: 'chapter', chapter: 1 });
  });

  it('read a chapter by its position, title or id, in parts', async () => {
    const { call } = harness();
    expect((await call('sandbox_read_text', { chapter: 2 })).text).toMatch(/^1\t# Second\n2\t\n3\tPrint typography/);
    expect((await call('sandbox_read_text', { chapter: 'second', fromLine: 1, toLine: 1, plain: true })).text).toBe('# Second');
    expect((await call('sandbox_read_text', { chapter: 'b' })).title).toBe('Second');
    expect((await call('sandbox_read_text', { chapter: 7 })).error).toMatch(/No chapter 7\. The book has 2: 1\. Opening; 2\. Second\./);
  });

  it('edit the text exactly, or not at all', async () => {
    const { call, get } = harness();
    const done = await call('sandbox_edit_text', { edits: [{ find: 'The last words of the opening.', replace: 'New last words.' }], wait: false });
    expect(done).toMatchObject({ ok: true, chapter: 1, changed: true, laidOut: false });
    expect(get().markdown).toContain('New last words.');
    expect(get().chapters[0]!.markdown).toBe(get().markdown);
    const refused = await call('sandbox_edit_text', { chapter: 2, edits: [{ find: '# Second', replace: '# Two' }, { find: 'typography', replace: 'x' }], wait: false });
    expect(refused.error).toMatch(/Edit 2: the text to find occurs 4 times/);
    expect(get().chapters[1]!.markdown).toContain('# Second');
    await call('sandbox_write_text', { chapter: 2, markdown: '# Rewritten\n', wait: false });
    expect(get().chapters[1]!.markdown).toBe('# Rewritten\n');
  });

  it('arrange the chapters', async () => {
    const { call, get } = harness();
    const added = await call('sandbox_manage_chapters', { action: 'add', title: 'Appendix', markdown: '# Appendix\n', position: 1, wait: false });
    expect(added.added).toBe(1);
    expect(get().chapters.map((c) => c.title)).toEqual(['Appendix', 'Opening', 'Second']);
    await call('sandbox_manage_chapters', { action: 'move', chapter: 'Appendix', position: 3, wait: false });
    await call('sandbox_manage_chapters', { action: 'rename', chapter: 3, title: 'Notes' });
    expect(get().chapters.map((c) => c.title)).toEqual(['Opening', 'Second', 'Notes']);
    await call('sandbox_manage_chapters', { action: 'split', chapter: 1, before: 'The last words', wait: false });
    expect(get().chapters).toHaveLength(4);
    expect(get().chapters[1]!.markdown).toMatch(/^The last words/);
    await call('sandbox_manage_chapters', { action: 'merge_with_previous', chapter: 2, wait: false });
    expect(get().chapters.map((c) => c.title)).toEqual(['Opening', 'Second', 'Notes']);
    expect((await call('sandbox_remove_chapter', { chapter: 'Notes', wait: false })).removed).toBe(3);
    expect((await call('sandbox_manage_chapters', { action: 'rename', chapter: 1 })).error).toBe('rename needs a title.');
  });

  it('read and change the design by path, and say what a change did', async () => {
    const { call, get } = harness();
    const read = await call('sandbox_get_config', { path: 'page.width' });
    expect(read).toMatchObject({ set: { value: 120, unit: 'mm' }, effective: { value: 120, unit: 'mm' } });
    // A setting the book does not store still has a value.
    const size = await call('sandbox_get_config', { path: 'bodyText.fontSize' });
    expect(size.set).toBeNull();
    expect(size.effective).toMatchObject({ unit: 'pt' });

    const set = await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: { value: 14, unit: 'pt' } }], wait: false });
    expect(set.changed).toEqual([{ path: 'bodyText.fontSize', from: null, to: { value: 14, unit: 'pt' } }]);
    expect(get().config.bodyText?.fontSize).toEqual({ value: 14, unit: 'pt' });
    expect((await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: { value: 14, unit: 'pt' } }] })).changed).toEqual([]);

    // Taken back with the value it had: null removes the setting.
    await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: null }], wait: false });
    expect(get().config.bodyText).toBeUndefined();

    const patched = await call('sandbox_set_config', { patch: { page: { width: { value: 130 } }, layout: { columns: 2 } }, wait: false });
    expect(patched.changed.map((c: { path: string }) => c.path)).toEqual(['page.width.value', 'layout.columns']);
    expect(get().config.page?.width).toEqual({ value: 130, unit: 'mm' });

    expect((await call('sandbox_set_config', { changes: [{ path: 'bodyTxt.fontSize', value: 1 }] })).error).toMatch(/"bodyTxt" is not a section/);
    const misspelt = await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSise', value: 1 }], wait: false });
    expect(misspelt.notes[0]).toMatch(/"fontSise" is not among the settings the engine resolves under bodyText/);
  });

  it('find a setting from a word', async () => {
    const { call } = harness();
    const found = await call('sandbox_find_setting', { query: 'orphans' });
    expect(found.paths.map((p: { path: string }) => p.path)).toContain('bodyText.avoidOrphans');
    expect(found.sections.some((s: { configKeys: string[] }) => s.configKeys.includes('bodyText'))).toBe(true);
  });

  it('put the pages into words, and find the page a passage is on', async () => {
    const { call } = harness();
    const outline = await call('sandbox_inspect_pages', { chapter: 1 });
    expect(outline.chapterPages).toBeGreaterThan(1);
    expect(outline.pages[0]).toMatchObject({ position: 1, label: '1', blank: false });
    const detail = await call('sandbox_inspect_pages', { chapter: 1, position: 1 });
    const page = detail.pages[0];
    expect(page.blocks[0]).toMatchObject({ type: 'heading', level: 1, text: 'Opening' });
    expect(page.sizeMm).toEqual([120, 180]);
    expect(page.columns[0].fill).toBeGreaterThan(0.5);
    expect((await call('sandbox_inspect_pages', { chapter: 1, position: 99 })).error).toMatch(/position 99 is not one of them/);

    const where = await call('sandbox_search_text', { query: 'last words', pages: true });
    expect(where.matches).toHaveLength(1);
    expect(where.matches[0].pagePositions).toEqual([outline.chapterPages]);
  });

  it('keep a table as a resource, and take it away', async () => {
    const { call, get } = harness();
    const saved = await call('sandbox_save_resource', { caption: 'Sizes', table: { rows: [['Size', 'Use'], ['A5', 'Novels']] }, wait: false });
    expect(saved).toMatchObject({ ok: true, id: 'sizes', created: true, use: '::resource{id="sizes"}' });
    expect(get().resources[0]!.table!.model.rows[0]![0]).toEqual({ content: 'Size', isHeader: true });
    await call('sandbox_save_resource', { id: 'sizes', caption: '', note: 'ISO 216', wait: false });
    expect(get().resources[0]).toMatchObject({ note: 'ISO 216', kind: 'table' });
    expect(get().resources[0]!.caption).toBeUndefined();
    expect((await call('sandbox_list_resources', { id: 'sizes' })).rows).toEqual([['Size', 'Use'], ['A5', 'Novels']]);
    expect((await call('sandbox_save_resource', { caption: 'Nothing' })).error).toMatch(/needs an image, an svg source or a table/);
    expect((await call('sandbox_delete_resource', { id: 'sizes', wait: false })).deleted).toBe('sizes');
    expect(get().resources).toEqual([]);
  });

  it('change how the book is shown', async () => {
    const { call, get } = harness();
    const view = await call('sandbox_set_view', { viewer: 'html', panel: 'config', scope: 'book', epubLayout: 'fixed', guides: { baselineGrid: true, looseLines: true, looseLineThreshold: 2 } });
    expect(view.view).toMatchObject({ viewer: 'html', panel: 'config', scope: 'book', epubLayout: 'fixed', guides: { baselineGrid: true, looseLines: true, looseLineThreshold: 2 } });
    expect(get().config.debug?.looseLineHighlight).toEqual({ enabled: true, threshold: 2 });
    expect((await call('sandbox_set_view', { zoom: 2 })).error).toMatch(/zoom is a setting of the canvas viewer, and the viewer is html/);
    expect((await call('sandbox_set_view', { resource: 'nope' })).error).toMatch(/No resource with id "nope"/);
  });
});
