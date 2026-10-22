import { describe, expect, it } from 'vitest';
import type { PostextConfig, Resource } from 'postext';
import { chapter, harness } from './testHarness.js';

// The Settings panel's actions beyond one setting (#1181): an agent renames
// and removes an item with its uses as the panel does.

const mm = (value: number) => ({ value, unit: 'mm' as const });

const CONFIG: PostextConfig = {
  calloutStyles: [{ id: 'note', name: 'Note' }, { id: 'caja', name: 'Caja', background: { hex: '#eeeeee', model: 'hex' } }, { id: 'hija', extends: 'caja' }],
  tableStyles: [{ id: 'plain' }],
  pageTemplates: [
    {
      id: 'tema',
      frames: [
        { name: 'texto', flow: true, placement: { anchor: { to: 'container', edge: 'top-left' } } },
        { name: 'caja', style: 'caja', placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(6) } } },
      ],
      groups: [{ name: 'pila', kind: 'stack', frames: ['texto', 'caja'], gap: mm(4) }],
    },
  ],
};

const book = (config: PostextConfig = CONFIG, resources: Resource[] = []) => {
  const chapters = [
    chapter('a', 'Topic', '::::page{template="tema"}\n# Money\n\nWords here.\n\n:::frame{slot="caja"}\nBoxed.\n:::\n::::\n'),
    chapter('b', 'Boxes', '# Boxes\n\n:::callout{type="caja"}\nInside.\n:::\n'),
  ];
  return { chapters, markdown: chapters[0]!.markdown, config, resources };
};

describe('sandbox_rename_design_item', () => {
  it('renames a callout style in the fences, template frames and children', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_rename_design_item', { list: 'calloutStyles', id: 'caja', to: 'Box', wait: false });
    expect(done).toMatchObject({ renamed: 'caja', to: 'box', fencesRewritten: 1 });
    const config = get().config;
    expect(config.calloutStyles!.map((s) => s.id)).toEqual(['note', 'box', 'hija']);
    expect(config.calloutStyles![2]!.extends).toBe('box');
    expect(config.pageTemplates![0]!.frames![1]!.style).toBe('box');
    expect(get().chapters[1]!.markdown).toContain(':::callout{type="box"}');
  });

  it('carries a table style to the tables that use it', async () => {
    const table = { id: 't1', kind: 'table', table: { rows: [], styleId: 'plain' }, createdAt: 1, updatedAt: 1 } as unknown as Resource;
    const { call, get } = harness(book(CONFIG, [table]));
    const done = await call('sandbox_rename_design_item', { list: 'tableStyles', id: 'plain', to: 'ruled', wait: false });
    expect(done).toMatchObject({ resourcesRewritten: 1, undoSteps: 2 });
    expect(get().config.tableStyles![0]!.id).toBe('ruled');
    expect((get().resources[0] as Resource & { table: { styleId: string } }).table.styleId).toBe('ruled');
  });

  it('renames a page template in its page fences, and a frame in its slots', async () => {
    const { call, get } = harness(book());
    await call('sandbox_rename_design_item', { list: 'pageTemplates', id: 'tema', to: 'topic', wait: false });
    expect(get().config.pageTemplates![0]!.id).toBe('topic');
    expect(get().chapters[0]!.markdown).toContain('::::page{template="topic"}');
    const frame = await call('sandbox_rename_design_item', { list: 'templateFrames', template: 'topic', id: 'caja', to: 'aside', wait: false });
    expect(frame).toMatchObject({ kind: 'frame', slotsRewritten: 1 });
    expect(get().config.pageTemplates![0]!.frames!.map((f) => f.name)).toEqual(['texto', 'aside']);
    expect(get().markdown).toContain(':::frame{slot="aside"}');
    const group = await call('sandbox_rename_design_item', { list: 'templateFrames', template: 'topic', id: 'pila', to: 'stack', wait: false });
    expect(group).toMatchObject({ kind: 'group' });
    expect(get().config.pageTemplates![0]!.groups![0]!.name).toBe('stack');
  });

  it('refuses a taken id and an unknown item, changing nothing', async () => {
    const { call, get } = harness(book());
    expect((await call('sandbox_rename_design_item', { list: 'calloutStyles', id: 'caja', to: 'note' })).error).toMatch(/taken/);
    expect((await call('sandbox_rename_design_item', { list: 'tableStyles', id: 'nope', to: 'x' })).error).toMatch(/Its ids: plain/);
    expect(get().config).toBe(CONFIG);
  });

  it('moves the cast with a balloon style', async () => {
    const comics: PostextConfig['comics'] = { balloonStyles: [{ id: 'grito', name: 'Grito', dash: true }], cast: [{ id: 'ben', balloonStyle: 'grito' }] };
    const { call, get } = harness(book({ ...CONFIG, comics }));
    expect(await call('sandbox_rename_design_item', { list: 'comics.balloonStyles', id: 'grito', to: 'yell', wait: false })).toMatchObject({ to: 'yell' });
    expect(get().config.comics!.balloonStyles![0]!.id).toBe('yell');
    expect(get().config.comics!.cast![0]!.balloonStyle).toBe('yell');
    await call('sandbox_remove_design_item', { list: 'comics.balloonStyles', id: 'yell', wait: false });
    expect(get().config.comics?.cast?.[0]?.balloonStyle).toBeUndefined();
  });
});

describe('sandbox_remove_design_item', () => {
  it('hands a removed callout style\'s look to its children', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_remove_design_item', { list: 'calloutStyles', id: 'caja', wait: false });
    expect(done.childrenTookItsLook).toEqual(['hija']);
    const hija = get().config.calloutStyles!.find((s) => s.id === 'hija')!;
    expect(hija.extends).toBeUndefined();
    expect(hija.background).toMatchObject({ hex: '#eeeeee' });
  });

  it('leaves the colours a palette entry gave, unlinked', async () => {
    const config: PostextConfig = {
      colorPalette: [{ id: 'ink', name: 'Ink', value: { hex: '#123456', model: 'hex' } }],
      bodyText: { color: { hex: '#000000', model: 'hex', paletteId: 'ink' } },
    };
    const { call, get } = harness(book(config));
    await call('sandbox_remove_design_item', { list: 'colorPalette', id: 'ink', wait: false });
    expect(get().config.colorPalette).toBeUndefined();
    expect(get().config.bodyText!.color).toEqual({ hex: '#123456', model: 'hex' });
  });
});

describe('sandbox_language_defaults', () => {
  it('lists the Chinese rows, then applies them as one step', async () => {
    const { call, get } = harness(book({}));
    const listed = await call('sandbox_language_defaults', { language: 'chinese', locale: 'zh-Hans', vertical: false });
    expect(listed.rows.length).toBeGreaterThan(3);
    expect(listed.rows.find((r: { id: string }) => r.id === 'locale')).toMatchObject({ required: true, applies: true });
    expect(get().config).toEqual({});
    const applied = await call('sandbox_language_defaults', { language: 'chinese', locale: 'zh-Hans', vertical: false, apply: true, wait: false });
    expect(applied.undoSteps).toBe(1);
    expect(get().config.locale).toBe('zh-Hans');
    await call('sandbox_undo');
    expect(get().config.locale).toBeUndefined();
  });

  it('refuses the Arabic list for a book in another language', async () => {
    const { call } = harness(book({ locale: 'en' }));
    expect((await call('sandbox_language_defaults', { language: 'arabic' })).error).toMatch(/Arabic-script language/);
  });
});

describe('sandbox_save_layout_as_template', () => {
  it('makes a template from a laid composed page', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_save_layout_as_template', { chapter: 1 });
    expect(done).toMatchObject({ template: 'tema-layout', from: 'tema', page: 1, undoSteps: 1 });
    const made = get().config.pageTemplates!.find((t) => t.id === 'tema-layout')!;
    expect(made.frames!.map((f) => f.name)).toContain('texto');
    expect((await call('sandbox_save_layout_as_template', { chapter: 2 })).error).toMatch(/no composed page/);
  });
});

describe('sandbox_print_profile', () => {
  it('refuses a file that is no ICC profile', async () => {
    const { call, get } = harness(book({}));
    const refused = await call('sandbox_print_profile', { file: { base64: btoa('not a profile at all, just some words'), fileName: 'x.icc' } });
    expect(refused.error).toMatch(/not an ICC profile|not a CMYK/);
    expect(get().config.print).toBeUndefined();
  });

  it('takes the custom profile away', async () => {
    const { call, get } = harness(book({ print: { outputProfile: 'custom', customProfile: { name: 'Press', fileId: 'f1' } } }));
    await call('sandbox_print_profile', { remove: true, wait: false });
    expect(get().config.print).toBeUndefined();
  });
});
