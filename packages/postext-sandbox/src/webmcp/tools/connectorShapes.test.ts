import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { leafEntries } from '../configPaths';
import { chapter, harness } from './testHarness';

// #1063: what the template editor's connector, shape and box-shape fields
// write is configuration the sandbox_* config tools read and write like any
// other setting: an agent draws the same tree and the same joined card.

const mm = (value: number) => ({ value, unit: 'mm' as const });

const CONFIG: PostextConfig = {
  calloutStyles: [{ id: 'card', name: 'Card', label: { position: 'top-left' } }],
  pageTemplates: [{
    id: 'arbol',
    header: false,
    frames: [
      { name: 'root', width: mm(40), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(50) } } },
      { name: 'a', width: mm(40), placement: { anchor: { to: '#root', edge: 'below' }, offset: { x: mm(-40), y: mm(15) } } },
      { name: 'b', width: mm(40), placement: { anchor: { to: '#a', edge: 'align-top' }, offset: { x: mm(80) } } },
      { name: 'card', style: 'card', width: mm(100), placement: { anchor: { to: '#a', edge: 'below' }, offset: { y: mm(20) } } },
    ],
  }],
};

const book = () => {
  const chapters = [chapter('a', 'Tree', '::::page{template="arbol"}\n:::frame{slot="root"}\nAll\n:::\n:::frame{slot="a"}\nOne\n:::\n:::frame{slot="b"}\nTwo\n:::\n:::frame{slot="card" label="Note"}\nWords.\n:::\n::::\n')];
  return { chapters, markdown: chapters[0]!.markdown, config: CONFIG };
};

const text = (v: unknown) => JSON.stringify(v);

const CHANGES = [
  {
    path: 'pageTemplates[id=arbol].decoration',
    value: {
      elements: [
        { kind: 'connector', id: 'branches', routing: 'tree', from: { to: '#root' }, to: [{ to: '#a' }, { to: '#b' }], endCap: 'arrow', dash: [{ value: 3, unit: 'pt' }, { value: 2, unit: 'pt' }] },
        { kind: 'path', id: 'ribbon', d: 'M0 0H0.88L1 0.5L0.88 1H0L0.08 0.5Z', fill: { hex: '#2a6f97', model: 'hex' }, placement: { anchor: { to: '#root', edge: 'above', at: 'start' }, size: { width: mm(30), height: mm(6) } } },
      ],
    },
  },
  { path: 'calloutStyles[id=card].borderRadius', value: { topLeft: mm(3), topRight: mm(3) } },
  { path: 'calloutStyles[id=card].border', value: { enabled: true, sides: { bottom: { enabled: false } } } },
  { path: 'calloutStyles[id=card].label.joined', value: true },
  { path: 'calloutStyles[id=card].label.position', value: 'bottom-left' },
];

describe('connectors, shapes and box shapes through the config tools (#1063)', () => {
  it('draws them and reads every new field back as a setting', async () => {
    const { call } = harness(book());
    const done = await call('sandbox_set_config', { changes: CHANGES, wait: false });
    expect(done.ok, text(done)).toBe(true);
    // An end added the way a click on a frame adds it.
    const picked = await call('sandbox_set_config', { changes: [{ path: 'pageTemplates[id=arbol].decoration.elements[id=branches].to', value: [{ to: '#a' }, { to: '#b' }, { to: '#card', side: 'top', at: 0.25 }] }], wait: false });
    expect(picked.ok, text(picked)).toBe(true);
    const leaves = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const keys = [...leaves.keys()];
    expect(keys.some((k) => k.startsWith('pageTemplates[id=arbol].decoration.elements[id=branches].to[2].at'))).toBe(true);
    expect(text(leaves.get('pageTemplates[id=arbol].decoration.elements[id=ribbon].placement.anchor.at'))).toBe('"start"');
    expect(text(leaves.get('calloutStyles[id=card].label.joined'))).toBe('true');
    expect(keys.some((k) => k.startsWith('calloutStyles[id=card].borderRadius.topLeft'))).toBe(true);
    expect(keys.some((k) => k.startsWith('calloutStyles[id=card].border.sides.bottom.enabled'))).toBe(true);
  });

  it('writes each of those settings with the value it has, and nothing moves', async () => {
    const first = harness(book());
    await first.call('sandbox_set_config', { changes: CHANGES, wait: false });
    const before = leafEntries((await first.call('sandbox_get_config', { effective: true })).effective);
    const ours = [...before.keys()].filter((p) => p.startsWith('pageTemplates[id=arbol].decoration') || p.startsWith('calloutStyles[id=card].borderRadius') || p.startsWith('calloutStyles[id=card].border.sides') || p === 'calloutStyles[id=card].label.joined');
    expect(ours.length).toBeGreaterThan(15);
    const failures: string[] = [];
    for (const path of ours) {
      const value = before.get(path);
      if (value === null || value === undefined) continue;
      const { call } = harness(book());
      await call('sandbox_set_config', { changes: CHANGES, wait: false });
      const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
      if (!done.ok) {
        failures.push(`${path}: ${done.error}`);
        continue;
      }
      const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
      const off = [...new Set([...before.keys(), ...after.keys()])].filter((p) => !p.endsWith('.paletteId') && text(before.get(p)) !== text(after.get(p)));
      if (off.length > 0) failures.push(`${path}: moved ${off.slice(0, 4).join(', ')}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
