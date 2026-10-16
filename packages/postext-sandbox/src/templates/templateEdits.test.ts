import { describe, expect, it } from 'vitest';
import { resolvePageTemplate, type PageTemplate } from 'postext';
import {
  addFrame,
  addGroup,
  createTemplate,
  duplicateTemplate,
  frameInherited,
  removeFrame,
  removeTemplate,
  renameFrame,
  renameTemplate,
  slugify,
  templateFromLayout,
  uniqueName,
  updateFrame,
  updateGroup,
  updateTemplate,
  variantForPage,
} from './templateEdits';

const mm = (value: number) => ({ value, unit: 'mm' as const });

const BASE: PageTemplate[] = [
  {
    id: 'tema',
    name: 'Tema',
    frames: [
      { name: 'titulo', takes: 'h1', width: mm(170) },
      { name: 'texto', flow: true, placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(2) } } },
    ],
    groups: [{ name: 'cajas', frames: ['titulo', 'texto'] }],
  },
  { id: 'hijo', extends: 'tema', frames: [{ name: 'texto', width: mm(90) }] },
];

describe('names', () => {
  it('slugifies and keeps names unique', () => {
    expect(slugify(' Página de tema ')).toBe('pagina-de-tema');
    expect(uniqueName(['a', 'a-2'], 'a')).toBe('a-3');
  });
});

describe('templates', () => {
  it('creates one from scratch with a flow frame', () => {
    const { templates, id } = createTemplate(BASE, 'Doble página');
    expect(id).toBe('doble-pagina');
    expect(templates.at(-1)).toEqual({ id, name: 'Doble página', frames: [{ name: 'text', flow: true }] });
  });

  it('duplicates one after itself, as a deep copy', () => {
    const { templates, id } = duplicateTemplate(BASE, 'tema', 'Tema (copia)');
    expect(id).toBe('tema-copy');
    expect(templates[1]!.id).toBe('tema-copy');
    expect(templates[1]!.frames).toEqual(BASE[0]!.frames);
    expect(templates[1]!.frames).not.toBe(BASE[0]!.frames);
  });

  it('renames one with every reference to it', () => {
    const out = renameTemplate([...BASE, { id: 'x', frames: [{ name: 'a', overflow: { continueIn: 'template:tema' } }], overflowTemplate: 'tema' }], 'tema', 'topic');
    expect(out[0]!.id).toBe('topic');
    expect(out[1]!.extends).toBe('topic');
    expect(out[2]!.overflowTemplate).toBe('topic');
    expect(out[2]!.frames![0]!.overflow!.continueIn).toBe('template:topic');
  });

  it('removes one and hands what it gave to the templates that extend it', () => {
    const out = removeTemplate(BASE, 'tema');
    expect(out).toHaveLength(1);
    expect(out[0]!.extends).toBeUndefined();
    expect(out[0]!.frames!.map((f) => f.name)).toEqual(['titulo', 'texto']);
    const texto = out[0]!.frames!.find((f) => f.name === 'texto')!;
    expect(texto.width).toEqual(mm(90));
    expect(texto.flow).toBe(true);
  });

  it('writes template fields at a scope: own fields to the base, the rest to the variant', () => {
    const out = updateTemplate(BASE, 'tema', 'recto', { header: false, spread: true });
    expect(out[0]!.spread).toBe(true);
    expect(out[0]!.variants).toEqual({ recto: { header: false } });
    const back = updateTemplate(out, 'tema', 'recto', { header: undefined });
    expect(back[0]!.variants).toBeUndefined();
  });
});

describe('frames', () => {
  it('edits a frame the scope defines', () => {
    const out = updateFrame(BASE, 'tema', 'base', 'titulo', { style: 'tab', width: undefined });
    expect(out[0]!.frames![0]).toEqual({ name: 'titulo', takes: 'h1', style: 'tab' });
  });

  it('patches an inherited frame and drops the patch when only its name is left', () => {
    expect(frameInherited(BASE, 'hijo', 'base', 'titulo')).toBe(true);
    const out = updateFrame(BASE, 'hijo', 'base', 'titulo', { layer: 2 });
    expect(out[1]!.frames).toEqual([{ name: 'texto', width: mm(90) }, { name: 'titulo', layer: 2 }]);
    const back = updateFrame(out, 'hijo', 'base', 'titulo', { layer: undefined });
    expect(back[1]!.frames).toEqual([{ name: 'texto', width: mm(90) }]);
    // Resolved, the child takes its patch over the parent's frame.
    const resolved = resolvePageTemplate({ pageTemplates: out }, 'hijo')!;
    expect(resolved.frames.find((f) => f.name === 'titulo')!.layer).toBe(2);
    expect(resolved.frames.find((f) => f.name === 'titulo')!.takes).toBe('h1');
  });

  it('writes a variant patch for a page side', () => {
    const out = updateFrame(BASE, 'tema', 'verso', 'titulo', { width: mm(150) });
    expect(out[0]!.variants).toEqual({ verso: { frames: [{ name: 'titulo', width: mm(150) }] } });
    expect(resolvePageTemplate({ pageTemplates: out }, 'tema', { parity: 'verso' })!.frames[0]!.width).toEqual(mm(150));
    expect(resolvePageTemplate({ pageTemplates: out }, 'tema', { parity: 'recto' })!.frames[0]!.width).toEqual(mm(170));
  });

  it('adds and removes frames; an inherited one is removed by a patch', () => {
    const added = addFrame(BASE, 'tema', 'base', { name: 'foto', layer: 2 });
    expect(added[0]!.frames!.map((f) => f.name)).toEqual(['titulo', 'texto', 'foto']);
    const removed = removeFrame(BASE, 'tema', 'base', 'texto');
    expect(removed[0]!.frames!.map((f) => f.name)).toEqual(['titulo']);
    expect(removed[0]!.groups![0]!.frames).toEqual(['titulo']);
    const inChild = removeFrame(BASE, 'hijo', 'base', 'titulo');
    expect(inChild[1]!.frames).toContainEqual({ name: 'titulo', remove: true });
  });

  it('renames a frame with its anchors, chains and group members, in the templates that extend it', () => {
    const chained = updateFrame(BASE, 'tema', 'base', 'titulo', { next: 'texto' });
    const out = renameFrame(chained, 'tema', 'texto', 'cuerpo');
    expect(out[0]!.frames!.map((f) => f.name)).toEqual(['titulo', 'cuerpo']);
    expect(out[0]!.frames![0]!.next).toBe('cuerpo');
    expect(out[0]!.groups![0]!.frames).toEqual(['titulo', 'cuerpo']);
    expect(out[1]!.frames![0]!.name).toBe('cuerpo');
    const anchored = renameFrame(BASE, 'tema', 'titulo', 'cabeza');
    expect(anchored[0]!.frames![1]!.placement!.anchor.to).toBe('#cabeza');
    // A name in use is refused.
    expect(renameFrame(BASE, 'tema', 'titulo', 'texto')).toEqual(BASE);
  });
});

describe('groups', () => {
  it('adds, edits and removes a group', () => {
    const out = addGroup(BASE, 'tema', 'base', { name: 'fila', kind: 'row', frames: [] });
    const edited = updateGroup(out, 'tema', 'base', 'fila', { gap: mm(4), align: 'center' });
    expect(edited[0]!.groups![1]).toEqual({ name: 'fila', kind: 'row', frames: [], gap: mm(4), align: 'center' });
  });
});

describe('from a page', () => {
  it('makes a variant for one page that extends the template', () => {
    const { templates, id } = variantForPage(BASE, 'tema', 'Tema, p. 8', { name: 'titulo', width: mm(120) });
    expect(id).toBe('tema-page');
    expect(templates[1]).toEqual({ id, name: 'Tema, p. 8', extends: 'tema', frames: [{ name: 'titulo', width: mm(120) }] });
    expect(resolvePageTemplate({ pageTemplates: templates }, id)!.frames[0]!.takes).toBe('h1');
  });

  it('saves a page’s layout as a template with fixed boxes', () => {
    const resolved = resolvePageTemplate({ pageTemplates: BASE }, 'tema')!;
    const dpi = 25.4;
    const area = { x: 20, y: 20, width: 180, height: 240 };
    const rects = new Map([
      ['titulo', { x: 20, y: 20, width: 170, height: 12 }],
      ['texto', { x: 20, y: 34, width: 180, height: 90 }],
    ]);
    const { templates, id } = templateFromLayout(BASE, resolved, rects, area, dpi, 'Tema fijo');
    const t = templates.at(-1)!;
    expect(t.id).toBe(id);
    expect(t.frames![1]).toEqual({
      name: 'texto',
      placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(0), y: mm(14) } },
      width: mm(180),
      height: mm(90),
      flow: true,
    });
    expect(t.frames![0]!.takes).toBe('h1');
  });
});
