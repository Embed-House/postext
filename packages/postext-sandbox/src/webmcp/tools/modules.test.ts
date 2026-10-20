import { describe, expect, it } from 'vitest';
import { ONE_OFF_TEMPLATE, RESHAPE_CONFIG, RESHAPE_RESOURCES, oneOffPage } from '../../templates/reshape.fixture';
import { chapter, harness } from './testHarness';

// The module library and the template reshapes (#1065) through the agent
// tools: a page of one-off frames turned into a grid and a module, a
// module written into a page and renamed, each undoable.

const CARDS = ['foto1', 'pie1', 'foto2', 'pie2', 'foto3', 'pie3', 'foto4', 'pie4', 'foto5', 'pie5'];

const book = () => {
  const chapters = [chapter('a', 'River', oneOffPage()), chapter('b', 'Notes', '# Notes\n\nSome words.\n')];
  return { chapters, markdown: chapters[0]!.markdown, config: RESHAPE_CONFIG, resources: RESHAPE_RESOURCES, activeChapterId: 'a' };
};

describe('the module tools', () => {
  it('turn the cards into a grid and the box into a module, as steps sandbox_undo takes back', async () => {
    const { call, get } = harness(book());
    const grid = await call('sandbox_frames_to_grid', { template: 'rio', frames: CARDS, wait: false });
    expect(grid).toMatchObject({ group: 'grid', main: 'foto', members: ['pie'], columns: 3, rows: 2, pagesRewritten: 1, undoSteps: 2 });
    expect(grid.instances.foto2).toBe('foto[2]');
    expect(get().config.pageTemplates![0]!.groups![0]).toMatchObject({ kind: 'grid', repeat: { frames: ['foto', 'pie'] } });
    expect(get().markdown).toContain(':::frame{slot="foto"}');

    const mod = await call('sandbox_extract_module', { template: 'rio', frames: ['nota', 'imagen'], name: 'Caja', wait: false });
    expect(mod).toMatchObject({ module: 'caja', group: 'modules', decoration: ['raya'], names: { nota: 'caja[1].nota' }, undoSteps: 2 });
    expect(get().markdown).toContain(':::module{template="caja"}');

    const read = await call('sandbox_modules');
    expect(read.modules).toEqual([expect.objectContaining({ id: 'caja', name: 'Caja', frames: ['nota', 'imagen'], blocks: 1, pages: 1, byChapter: [{ chapter: 1, blocks: 1 }], inPageTemplates: ['rio'] })]);
    expect(read.pageTemplates).toEqual([{ id: 'rio', modulesGroup: 'modules' }]);

    for (let i = 0; i < 4; i++) expect((await call('sandbox_undo', {})).ok).toBe(true);
    expect(get().config.pageTemplates).toEqual([ONE_OFF_TEMPLATE]);
    expect(get().markdown).toBe(oneOffPage());
  });

  it('say why frames off a lattice are not turned into a grid', async () => {
    const done = await harness(book()).call('sandbox_frames_to_grid', { template: 'rio', frames: ['foto1', 'nota'], wait: false });
    expect(done.error).toMatch(/not all as wide|lattice/);
  });

  it('write a module into a page with empty slots, adding the modules group, and rename it with its uses', async () => {
    const { call, get } = harness(book());
    await call('sandbox_create_module', { name: 'Nota' });
    expect(get().config.pageTemplates!.map((t) => t.id)).toEqual(['rio', 'nota']);
    const ins = await call('sandbox_insert_module', { module: 'nota', chapter: 1, page: 1, wait: false });
    expect(ins).toMatchObject({ pageTemplate: 'rio', group: 'modules', groupAdded: true, undoSteps: 2 });
    expect(get().markdown).toContain(':::module{template="nota"}\n:::frame{slot="text"}\n\n:::\n:::\n::::');
    const ren = await call('sandbox_rename_module', { module: 'nota', to: 'aviso', wait: false });
    expect(ren).toMatchObject({ renamed: 'nota', to: 'aviso', blocksRewritten: 1 });
    expect(get().markdown).toContain(':::module{template="aviso"}');
    expect((await call('sandbox_insert_module', { module: 'nope' })).error).toMatch(/No module template "nope"/);
  });
});
