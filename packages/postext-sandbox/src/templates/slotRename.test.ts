import { describe, expect, it } from 'vitest';
import type { PageTemplate } from 'postext';
import { frameFamily, renameFrame } from './templateEdits';
import { renameFrameInEdition } from './slotRename';

const mm = (value: number) => ({ value, unit: 'mm' as const });

const TEMPLATES: PageTemplate[] = [
  { id: 'tema', frames: [{ name: 'titulo', width: mm(170) }, { name: 'caja-4', width: mm(80) }, { name: 'texto', flow: true }] },
  { id: 'hijo', extends: 'tema', frames: [{ name: 'caja-4', width: mm(60) }] },
  { id: 'hermano', extends: 'tema', frames: [{ name: 'caja-4', width: mm(50) }, { name: 'foto', width: mm(20) }] },
  { id: 'aparte', frames: [{ name: 'caja-4', width: mm(80) }] },
];

const PAGES = [
  '::::page{template="tema"}', ':::frame{slot="caja-4"}', 'a', ':::', '::::',
  '::::page{template="hijo"}', ':::frame{slot="caja-4"}', 'b', ':::', '::::',
  '::::page{template="hermano"}', ':::frame{slot="caja-4"}', 'c', ':::', '::::',
  '::::page{template="aparte"}', ':::frame{slot="caja-4"}', 'd', ':::', '::::',
].join('\n');

describe('frame renames reach the whole family (#979)', () => {
  it('shares a frame with the templates that extend its definer, siblings included', () => {
    expect(frameFamily(TEMPLATES, 'hijo', 'caja-4')).toEqual(['tema', 'hijo', 'hermano']);
    expect(frameFamily(TEMPLATES, 'tema', 'caja-4')).toEqual(['tema', 'hijo', 'hermano']);
    expect(frameFamily(TEMPLATES, 'hermano', 'foto')).toEqual(['hermano']);
    expect(frameFamily(TEMPLATES, 'aparte', 'caja-4')).toEqual(['aparte']);
  });

  it('renames the frame in a sibling that patches it, not in an unrelated template', () => {
    const out = renameFrame(TEMPLATES, 'hijo', 'caja-4', 'caja-azul');
    expect(out.find((t) => t.id === 'tema')!.frames!.map((f) => f.name)).toEqual(['titulo', 'caja-azul', 'texto']);
    expect(out.find((t) => t.id === 'hermano')!.frames!.map((f) => f.name)).toEqual(['caja-azul', 'foto']);
    expect(out.find((t) => t.id === 'aparte')!.frames!.map((f) => f.name)).toEqual(['caja-4']);
  });

  it('rewrites the fences of the pages that share the frame, in an edition', () => {
    const edition = { config: { pageTemplates: TEMPLATES }, chapters: [{ markdown: PAGES }, { markdown: '# nothing' }] };
    const out = renameFrameInEdition(edition, 'tema', 'caja-4', 'caja-azul')!;
    const md = out.chapters[0]!.markdown;
    expect(md.match(/slot="caja-azul"/g)).toHaveLength(3);
    expect(md).toContain('::::page{template="aparte"}\n:::frame{slot="caja-4"}');
    expect(out.chapters[1]).toBe(edition.chapters[1]);
    expect(out.config.pageTemplates!.find((t) => t.id === 'tema')!.frames![1]!.name).toBe('caja-azul');
    // The input is untouched.
    expect(edition.chapters[0]!.markdown).toBe(PAGES);
  });

  it('leaves an edition alone when it lacks the template or the frame, or already has the name', () => {
    const edition = { config: { pageTemplates: TEMPLATES }, chapters: [{ markdown: PAGES }] };
    expect(renameFrameInEdition(edition, 'nope', 'caja-4', 'x')).toBeNull();
    expect(renameFrameInEdition(edition, 'tema', 'ausente', 'x')).toBeNull();
    expect(renameFrameInEdition(edition, 'tema', 'caja-4', 'titulo')).toBeNull();
    expect(renameFrameInEdition({ config: {}, chapters: [] }, 'tema', 'caja-4', 'x')).toBeNull();
  });
});
