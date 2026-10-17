import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { leafEntries } from '../configPaths';
import { chapter, harness } from './testHarness';

// The label styles are configuration (#969): the Design panel's section
// writes `labelStyles`, and the sandbox_* config tools read and write the
// same list, an item named by its id.

const CONFIG: PostextConfig = {
  paragraphStyles: [{ id: 'names', name: 'Names' }],
  labelStyles: [
    {
      id: 'town', name: 'Towns', paragraphStyle: 'names', fontFamily: 'Lora', fontSize: { value: 8, unit: 'pt' }, fontWeight: 600,
      fontStyle: 'italic', color: { hex: '#1f3a5f', model: 'hex' }, textTransform: 'uppercase', letterSpacing: 0.05,
      halo: { color: { hex: '#ffffff', model: 'hex' }, width: { value: 2, unit: 'px' } }, background: { hex: '#f4f0e6', model: 'hex' },
      padding: { value: 3, unit: 'px' }, minScale: 0.7, writingMode: 'vertical-rl', overlap: 'allow',
    },
    { id: 'sea' },
  ],
};

const book = (config: PostextConfig = CONFIG) => {
  const chapters = [chapter('a', 'Map', '# Map\n\nWords here.\n')];
  return { chapters, markdown: chapters[0]!.markdown, config };
};

const text = (v: unknown) => JSON.stringify(v);

describe('label styles through the config tools', () => {
  it('reads every field of a style as a setting, the fields it leaves unset out', async () => {
    const read = await harness(book()).call('sandbox_get_config', { effective: true });
    const leaves = leafEntries(read.effective);
    const paths = [...leaves.keys()].filter((p) => p.startsWith('labelStyles'));
    expect(paths.length).toBeGreaterThan(18);
    expect(text(leaves.get('labelStyles[id=town].overlap'))).toBe('"allow"');
    expect(text(leaves.get('labelStyles[id=town].halo.width.value'))).toBe('2');
    // `minScale` always resolves; a slant or capitals left unwritten do not (the borrowed style's hold).
    expect(text(leaves.get('labelStyles[id=sea].minScale'))).toBe('0.85');
    expect(leaves.get('labelStyles[id=sea].fontStyle')).toBeUndefined();
  });

  it('writes every field with the value it has, and nothing moves', async () => {
    const before = leafEntries((await harness(book()).call('sandbox_get_config', { effective: true })).effective);
    const failures: string[] = [];
    for (const [path, value] of before) {
      if (!path.startsWith('labelStyles') || value === null || value === undefined) continue;
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

  it('adds a style to a book that stores none, then changes one field of it', async () => {
    const { call } = harness(book({}));
    const added = await call('sandbox_set_config', { changes: [{ path: 'labelStyles', value: [{ id: 'river', fontSize: { value: 7, unit: 'pt' }, textTransform: 'uppercase' }] }], wait: false });
    expect(added.ok).toBe(true);
    const done = await call('sandbox_set_config', { changes: [{ path: 'labelStyles[id=river].overlap', value: 'allow' }, { path: 'labelStyles[id=river].minScale', value: 0.6 }], wait: false });
    expect(done.ok).toBe(true);
    const read = await call('sandbox_get_config', { path: 'labelStyles[id=river]' });
    expect(text(read.set)).toContain('"overlap":"allow"');
    expect(text(read.set)).toContain('"minScale":0.6');
    expect(text(read.set)).toContain('"textTransform":"uppercase"');
  });
});
