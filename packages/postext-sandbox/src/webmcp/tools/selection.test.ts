import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTBlock } from 'postext';
import { resetEditMode, selectedFrameNow, setEditMode } from '../../editing/editMode';
import { resetPageSelection } from '../../selection/selectionStore';
import { chapter, harness } from './testHarness';

const mm = (value: number) => ({ value, unit: 'mm' as const });

const config: PostextConfig = {
  page: { width: mm(160), height: mm(220), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } } as never,
  calloutStyles: [{ id: 'caja', backgroundEnabled: true, background: { hex: '#d8ecf9', model: 'hex' }, border: { enabled: false }, padding: { top: mm(3), right: mm(3), bottom: mm(3), left: mm(3) } } as never],
  pageTemplates: [{
    id: 'tema',
    frames: [
      { name: 'titulo', takes: 'h1', width: mm(120) },
      { name: 'texto', flow: true, width: mm(120), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(2) } } },
      { name: 'caja', style: 'caja', width: mm(120), placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(8) } } },
    ],
  }] as never,
};

const MD = [
  '::::page{template="tema"}',
  '# El dinero',
  '',
  'Cada familia necesita alimentos y ropa.',
  '',
  ':::frame{slot="caja"}',
  'El dinero nos deja cambiar nuestro trabajo por cosas.',
  '',
  'Antes casi todo se pagaba con monedas.',
  ':::',
  '::::',
  '',
].join('\n');

afterEach(() => {
  resetEditMode();
  resetPageSelection();
});

describe('sandbox_inspect_point and the page selection (#865)', () => {
  const doc = buildDocument({ markdown: MD }, config);
  const page = doc.pages.find((p) => p.composed)!;
  const frame = page.composed!.frames.find((f) => f.name === 'caja')!;
  const blocks = frame.blockIds.map((id) => page.floats!.find((b) => b.id === id)!).filter((b): b is VDTBlock => !!b && b.type === 'paragraph');
  const second = blocks[1]!;
  const at = { x: (second.lines[0]!.bbox.x + 4) / page.width, y: (second.lines[0]!.bbox.y + second.lines[0]!.bbox.height / 2) / page.height };
  const open = () => harness({ chapters: [chapter('c', 'Uno', MD)], activeChapterId: 'c', markdown: MD, config });

  it('lists what lies at the point, innermost first, with the path the Sandbox shows', async () => {
    const { call } = open();
    const res = await call('sandbox_inspect_point', { chapter: 1, position: page.index + 1, ...at });
    expect(res.elements.map((e: { level: string }) => e.level)).toEqual(['text', 'block', 'frame', 'template']);
    expect(res.elements[2]).toMatchObject({ id: 'cp0:caja', name: 'caja', source: { kind: 'config', path: '/pageTemplates/0/frames/2' } });
    expect(res.elements[1].source.text).toBe('Antes casi todo se pagaba con monedas.');
    expect(res.path).toBe(`Page ${page.pageLabel} › caja › paragraph 2 › text`);
  });

  it('select with level picks an element: its Markdown in Content mode, its frame in Design mode', async () => {
    const { call, get } = open();
    const res = await call('sandbox_inspect_point', { chapter: 1, position: page.index + 1, ...at, select: true, level: 'frame' });
    expect(res.selected).toMatchObject({ path: `Page ${page.pageLabel} › caja`, opens: 'markdown', panel: 'markdown' });
    const focus = get().pendingEditorFocus!;
    expect(MD.slice(focus.anchor, focus.head)).toMatch(/^El dinero nos deja[\s\S]*monedas\.$/);
    const state = await call('sandbox_get_state', {});
    expect(JSON.stringify(state)).toContain('"pageSelection"');

    setEditMode('design');
    const design = await call('sandbox_inspect_point', { chapter: 1, position: page.index + 1, ...at, select: true, level: 'frame' });
    expect(design.selected).toMatchObject({ opens: 'frame', panel: 'config' });
    expect(selectedFrameNow()).toMatchObject({ name: 'caja', template: 'tema', configPath: '/pageTemplates/0/frames/2' });

    expect((await call('sandbox_inspect_point', { chapter: 1, position: page.index + 1, ...at, select: true, level: 'group' })).error).toMatch(/Nothing of level group/);
    expect((await call('sandbox_inspect_point', { chapter: 1, position: page.index + 1, ...at, level: 'frame' })).error).toMatch(/set select to true/);
  });
});
