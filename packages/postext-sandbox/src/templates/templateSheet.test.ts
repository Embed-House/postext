import { describe, expect, it } from 'vitest';
import { resolvePageTemplate, type PostextConfig } from 'postext';
import { templateSheet } from './templateSheet.js';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const config: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(200), height: mm(280), margins: { top: mm(20), bottom: mm(20), left: mm(25), right: mm(15), mirror: true } } as never,
  pageTemplates: [
    { id: 'one', frames: [{ name: 'a', width: mm(60), height: mm(40), next: 'b' }, { name: 'b', placement: { anchor: { to: '#a', edge: 'right-of' }, offset: { x: mm(5) } }, width: mm(50), height: mm(40) }] },
    { id: 'two', spread: true, gutter: mm(10), frames: [{ name: 'wide', height: mm(50) }] },
  ],
};

describe('templateSheet', () => {
  it('draws a page with its margins, the frames and their chain', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'one')!);
    expect(s.width).toBe(200);
    expect(s.content[0]).toEqual({ x: 25, y: 20, width: 160, height: 240 });
    expect(s.frames.find((f) => f.name === 'b')!.rect.x).toBeCloseTo(25 + 60 + 5);
    expect(s.chains).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('mirrors the margins on a verso', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'one', { parity: 'verso' })!, 'verso');
    expect(s.content[0]!.x).toBe(15);
  });

  it('draws a spread as one sheet with the gutter marked', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'two')!);
    expect(s.width).toBe(400);
    expect(s.pages).toHaveLength(2);
    expect(s.gutter).toEqual({ x: 195, y: 0, width: 10, height: 280 });
    const wide = s.frames[0]!.rect;
    expect(wide.x).toBe(15);
    expect(wide.width).toBe(400 - 15 - 15);
  });

  // #1082: a module with a root and a grid repeating a branch under it.
  const tree: PostextConfig = {
    ...config,
    pageTemplates: [{
      id: 'tree',
      role: 'module',
      frames: [
        { name: 'root', width: mm(60), height: mm(20), placement: { anchor: { to: 'container', edge: 'top' } } },
        { name: 'branch', minHeight: mm(20), height: mm(20) },
        { name: 'tag', width: mm(12), height: mm(5), placement: { anchor: { to: '#branch', edge: 'above' } } },
      ],
      groups: [{ name: 'branches', kind: 'grid', columns: 3, columnGap: mm(6), rowGap: mm(6), repeat: { frames: ['branch', 'tag'] }, placement: { anchor: { to: '#root', edge: 'below' }, offset: { y: mm(12) } } }],
    } as never],
  };

  it('draws a repeating grid in its cells, under what it hangs from', () => {
    const s = templateSheet(tree, resolvePageTemplate(tree, 'tree')!);
    const root = s.frames.find((f) => f.name === 'root')!.rect;
    const branches = s.frames.filter((f) => f.name === 'branch');
    expect(branches.map((b) => b.instance)).toEqual([1, 2, 3]);
    // The grid's box hangs below the root, from its left edge (75 mm) to
    // the area's right edge (185 mm): three columns of (110 − 2 × 6) / 3.
    const colW = (110 - 12) / 3;
    branches.forEach((b, i) => {
      expect(b.rect.x).toBeCloseTo(75 + i * (colW + 6));
      expect(b.rect.width).toBeCloseTo(colW);
      expect(b.rect.height).toBeCloseTo(20);
      // Below the root and its 12 mm, with the tag's 5 mm above it.
      expect(b.rect.y).toBeCloseTo(root.y + root.height + 12 + 5);
    });
    // The member hangs from its own item's main frame.
    const tags = s.frames.filter((f) => f.name === 'tag');
    expect(tags).toHaveLength(3);
    tags.forEach((t, i) => {
      expect(t.rect.x).toBeCloseTo(branches[i]!.rect.x);
      expect(t.rect.y + t.rect.height).toBeCloseTo(branches[i]!.rect.y);
    });
    // Nothing lies over the root.
    for (const f of [...branches, ...tags]) expect(f.rect.y).toBeGreaterThanOrEqual(root.y + root.height);
  });

  it('hangs the grid from an \'auto\' root at the root\'s height', () => {
    const auto = structuredClone(tree);
    (auto.pageTemplates![0] as { frames: { height?: unknown }[] }).frames[0]!.height = 'auto';
    const s = templateSheet(auto, resolvePageTemplate(auto, 'tree')!, 'recto', new Map([['root', 30]]));
    expect(s.frames.find((f) => f.name === 'root')!.rect.height).toBeCloseTo(30);
    for (const b of s.frames.filter((f) => f.name === 'branch')) expect(b.rect.y).toBeCloseTo(20 + 30 + 12 + 5);
  });

  it('draws two items at least, and no more than the grid holds', () => {
    const one = structuredClone(tree);
    (one.pageTemplates![0] as { groups: { columns: number; repeat: { max?: number } }[] }).groups[0]!.columns = 1;
    const s = templateSheet(one, resolvePageTemplate(one, 'tree')!);
    const branches = s.frames.filter((f) => f.name === 'branch');
    expect(branches).toHaveLength(2);
    expect(branches[1]!.rect.y).toBeGreaterThan(branches[0]!.rect.y + 20);
    const held = structuredClone(one);
    (held.pageTemplates![0] as { groups: { repeat: { max?: number } }[] }).groups[0]!.repeat.max = 1;
    expect(templateSheet(held, resolvePageTemplate(held, 'tree')!).frames.filter((f) => f.name === 'branch')).toHaveLength(1);
  });
});
