import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { leafEntries } from '../configPaths';
import { chapter, harness } from './testHarness';

// The page templates are configuration (#863): the sandbox_* config tools
// read and write them like any other setting, and a template drawn in the
// Design panel is a value they can spell out and set again.

const mm = (value: number) => ({ value, unit: 'mm' as const });

const CONFIG: PostextConfig = {
  calloutStyles: [{ id: 'note', name: 'Note' }, { id: 'caja', name: 'Caja' }],
  pageTemplates: [
    {
      id: 'tema',
      name: 'Tema',
      header: false,
      decoration: { elements: [{ kind: 'text', id: 'tema', content: '{attr.tema}', placement: { anchor: { to: 'page', edge: 'top-right' }, offset: { x: mm(-10), y: mm(6) } } }] },
      frames: [
        { name: 'titulo', takes: 'h1', width: mm(110), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-4), y: mm(-2) } } },
        { name: 'texto', flow: true, next: 'caja', placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(4), y: mm(2) } } },
        { name: 'caja', style: 'caja', padding: { right: mm(30) }, fit: { minScale: 0.85 }, placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(6) } } },
      ],
      groups: [{ name: 'pila', kind: 'stack', frames: ['texto', 'caja'], gap: mm(4) }],
      variants: { verso: { frames: [{ name: 'titulo', width: mm(100) }] } },
    },
    { id: 'tema-2', extends: 'tema', frames: [{ name: 'caja', minHeight: mm(40) }] },
  ],
};

const book = () => {
  const chapters = [chapter('a', 'Topic', '::::page{template="tema" tema="Money"}\n# Money\n\nWords here.\n::::\n')];
  return { chapters, markdown: chapters[0]!.markdown, config: CONFIG };
};

const text = (v: unknown) => JSON.stringify(v);

describe('page templates through the config tools', () => {
  it('reads every field of a template as a setting', async () => {
    const read = await harness(book()).call('sandbox_get_config', { effective: true });
    const leaves = leafEntries(read.effective);
    const paths = [...leaves.keys()].filter((p) => p.startsWith('pageTemplates'));
    expect(paths.length).toBeGreaterThan(30);
    expect(text(leaves.get('pageTemplates[id=tema].frames[0].takes'))).toBe('"h1"');
  });

  it('writes every field with the value it has, and nothing moves', async () => {
    const before = leafEntries((await harness(book()).call('sandbox_get_config', { effective: true })).effective);
    const failures: string[] = [];
    for (const [path, value] of before) {
      if (!path.startsWith('pageTemplates') || value === null || value === undefined) continue;
      const { call } = harness(book());
      const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
      if (!done.ok) {
        failures.push(`${path}: ${done.error}`);
        continue;
      }
      const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
      const off = [...new Set([...before.keys(), ...after.keys()])].filter((p) => text(before.get(p)) !== text(after.get(p)));
      if (off.length > 0) failures.push(`${path}: moved ${off.slice(0, 4).join(', ')}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('moves a frame and reads it back', async () => {
    const { call } = harness(book());
    const done = await call('sandbox_set_config', { changes: [{ path: 'pageTemplates[id=tema].frames[1].placement.offset.x', value: mm(6) }], wait: false });
    expect(done.ok).toBe(true);
    const read = await call('sandbox_get_config', { path: 'pageTemplates[id=tema].frames[1].placement' });
    expect(read.path).toBe('pageTemplates[id=tema].frames[1].placement');
    expect(text(read.set)).toContain('"x":{"value":6,"unit":"mm"}');
    // The other offset and the anchor stay as they were.
    expect(text(read.set)).toContain('"to":"#titulo"');
  });
});
