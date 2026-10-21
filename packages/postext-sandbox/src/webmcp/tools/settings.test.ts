import { describe, expect, it } from 'vitest';
import { leafEntries } from '../configPaths';
import { chapter, harness } from './testHarness';

// "Change any of the settings": every setting the engine resolves for a
// book that stores no design of its own is written through
// sandbox_set_config and read back. Such a book is the hard case — each
// write has to find what must be stored along with the setting (the rest
// of a length, the name of a list item, the design's list) for the rest
// of the design to stay where it was.

const book = () => {
  const chapters = [chapter('a', 'Opening', '# Opening\n\nSome words here.\n')];
  return { chapters, markdown: chapters[0]!.markdown, config: {} };
};

const text = (v: unknown) => JSON.stringify(v);

/** The settings that differ between two resolved configurations. Which
 *  palette entry a colour follows is not one: the engine drops the link
 *  from a resolved colour once the book stores a palette. */
function moved(before: Map<string, unknown>, after: Map<string, unknown>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((p) => !p.endsWith('.paletteId') && text(before.get(p)) !== text(after.get(p)));
}

/** Settings the engine reads differently once they are spelled out, even
 *  with the value they had: the page number of a contents entry takes the
 *  entry's weight, a callout's list markers their own colour. */
const FOLLOWS_WHEN_SET: Record<string, string> = {
  'toc.levels[level=1].fontWeight': 'toc.levels[level=1].numberFontWeight',
  'calloutStyles[id=note].lists.color.hex': 'calloutStyles[id=note].lists.colorSet',
  'calloutStyles[id=note].lists.color.model': 'calloutStyles[id=note].lists.colorSet',
  'calloutStyles[id=note].lists.color.paletteId': 'calloutStyles[id=note].lists.colorSet',
};

describe('every setting the engine resolves', () => {
  it('can be written with the value it has, and nothing moves', async () => {
    const before = leafEntries((await harness(book()).call('sandbox_get_config', { effective: true })).effective);
    expect(before.size).toBeGreaterThan(1500);
    const failures: string[] = [];
    for (const [path, value] of before) {
      // Fonts are files of the book, not values.
      if (path.startsWith('customFonts') || value === null || value === undefined) continue;
      const { call } = harness(book());
      const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
      if (!done.ok) {
        failures.push(`${path}: ${done.error}`);
        continue;
      }
      const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
      const seeded = ((done.notes ?? []) as string[]).map((note) => /^(\S+) was not among/.exec(note)?.[1]).filter(Boolean) as string[];
      // A default the engine spells out in a list the book now stores
      // (`pages: "all"` on a running-head element) is not a change.
      const off = moved(before, after).filter((p) => p !== FOLLOWS_WHEN_SET[path] && !(before.get(p) === undefined && seeded.some((at) => p.startsWith(at))));
      if (off.length > 0) failures.push(`${path}: moved ${off.slice(0, 4).join(', ')}`);
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it('takes another value when it is a number or a switch, and the answer accounts for everything that moved', async () => {
    const before = leafEntries((await harness(book()).call('sandbox_get_config', { effective: true })).effective);
    const failures: string[] = [];
    let changed = 0;
    let limited = 0;
    for (const [path, value] of before) {
      if (path.startsWith('customFonts')) continue;
      // What names an item of a list is not a setting of the item.
      if (/\[(id|level)=[^\]]+\]\.(id|level)$/.test(path)) continue;
      let next: unknown;
      if (typeof value === 'boolean') next = !value;
      else if (typeof value === 'number') next = Number.isInteger(value) ? value + 1 : Math.round(value * 1.25 * 1000) / 1000;
      else continue;
      const { call } = harness(book());
      const done = await call('sandbox_set_config', { changes: [{ path, value: next }], wait: false });
      if (!done.ok) {
        failures.push(`${path}: ${done.error}`);
        continue;
      }
      const read = await call('sandbox_get_config', { effective: true });
      if (!read.ok) {
        failures.push(`${path}: ${read.error}`);
        continue;
      }
      const after = leafEntries(read.effective);
      const notes = (done.notes ?? []) as string[];
      if (text(after.get(path)) !== text(next)) {
        // A value past a limit, or a setting that only counts with
        // another one on: the answer has to say so.
        if (notes.some((note) => note.startsWith(`${path}: stored as`))) limited++;
        else failures.push(`${path}: asked ${text(next)}, resolves ${text(after.get(path))}, and no note says so`);
        continue;
      }
      changed++;
      const seeded = notes.map((note) => /^(\S+) was not among/.exec(note)?.[1]).filter(Boolean) as string[];
      const told = new Set<string>(((done.followed ?? []) as { path: string }[]).map((f) => f.path));
      const untold = done.followedMore ? [] : moved(before, after).filter((p) => p !== path && !told.has(p) && !(before.get(p) === undefined && seeded.some((at) => p.startsWith(at))));
      if (untold.length > 0) failures.push(`${path}: moved without a word ${untold.slice(0, 4).join(', ')}`);
    }
    expect(failures).toEqual([]);
    expect(changed).toBeGreaterThan(650);
    expect(limited).toBeLessThan(20);
  }, 300_000);
});

// #1081: a frame's overlap (C2), which the frame editor's «May overlap on
// purpose» switch writes, is a setting like any other: written with each
// value, read back, nothing else moving.
describe('a composed frame\'s overlap', () => {
  const composed = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="card"}\n:::frame{slot="main"}\nWords.\n:::\n::::\n')];
    const config = { pageTemplates: [{ id: 'card', frames: [{ name: 'main', height: { value: 40, unit: 'mm' } }, { name: 'badge', width: { value: 10, unit: 'mm' }, height: { value: 10, unit: 'mm' } }] }] };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it.each(['allow', 'check'])('takes %s and nothing else moves', async (value) => {
    const { call } = harness(composed() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const path = 'pageTemplates[id=card].frames[name=badge].overlap';
    const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    // Read back by the frame's place in the list.
    const read = 'pageTemplates[id=card].frames[1].overlap';
    expect(after.get(read)).toBe(value);
    expect(moved(before, after).filter((p) => p !== read)).toEqual([]);
  });
});

// #1088: a modules group's kind (row, grid), the modules a group inside the
// stack takes, and a module's width, which the group editor and the
// template editor write, are settings like any other.
describe('modules side by side', () => {
  const composed = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="shell"}\n:::module{template="box"}\n:::frame{slot="text"}\nWords.\n:::\n:::\n::::\n')];
    const config = {
      pageTemplates: [
        { id: 'shell', frames: [], groups: [{ name: 'body', modules: true }, { name: 'pair', modules: true, within: 'body' }] },
        { id: 'box', role: 'module', frames: [{ name: 'text' }] },
      ],
    };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it.each([
    ['pageTemplates[id=shell].groups[name=pair].kind', 'row', 'pageTemplates[id=shell].groups[1].kind', 'row'],
    ['pageTemplates[id=shell].groups[name=pair].templates', ['box'], 'pageTemplates[id=shell].groups[1].templates[0]', 'box'],
    ['pageTemplates[id=box].width', { percent: 40 }, 'pageTemplates[id=box].width.percent', 40],
  ] as const)('writes %s and nothing else moves', async (path, value, read, want) => {
    const { call } = harness(composed() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    expect(after.get(read)).toBe(want);
    expect(moved(before, after).filter((p) => p !== read)).toEqual([]);
  });
});

// #1087: a design element's page-fence condition, which the element card's
// «Drawn when / Not drawn when the page says» fields write, is a setting
// like any other: written, read back, nothing else moving.
describe('a design element\'s page-fence condition', () => {
  const composed = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="shell" frontmatter}\nWords.\n::::\n')];
    const folio = { kind: 'text', id: 'folio', content: '{pageNumber}', placement: { anchor: { to: 'page', edge: 'bottom-center' } } };
    const config = {
      pageTemplates: [{ id: 'shell', frames: [{ name: 'main', flow: true }], decoration: { elements: [folio] }, footer: { elements: [{ ...folio, id: 'foot' }] } }],
    };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it.each([
    ['pageTemplates[id=shell].decoration.elements[id=folio].when', 'folio'],
    ['pageTemplates[id=shell].decoration.elements[id=folio].unless', 'frontmatter'],
    ['pageTemplates[id=shell].footer.elements[id=foot].unless', 'frontmatter'],
  ])('%s takes a value and nothing else moves', async (path, value) => {
    const { call } = harness(composed() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const added = moved(before, after);
    expect(added).toHaveLength(1);
    expect(added[0]!.endsWith(path.slice(path.lastIndexOf('.')))).toBe(true);
    expect(after.get(added[0]!)).toBe(value);
  });
});

// #1089: named frame looks are settings like any other: a look's colour is
// written by its id and read back, nothing else moving, and a book with
// none takes a first one.
describe('named frame looks', () => {
  const hex = (h: string) => ({ hex: h, model: 'hex' });
  const looked = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="card"}\n:::frame{slot="main" look="pill"}\nWords.\n:::\n::::\n')];
    const config = {
      pageTemplates: [{ id: 'card', frames: [{ name: 'main', height: { value: 40, unit: 'mm' } }] }],
      frameLooks: [{ id: 'pill', background: hex('#e63946') }],
    };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it('writes a look\'s colour by its id', async () => {
    const { call } = harness(looked() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    expect(before.get('frameLooks[id=pill].background.hex')).toBe('#e63946');
    const done = await call('sandbox_set_config', { changes: [{ path: 'frameLooks[id=pill].background', value: hex('#2a9d8f') }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    expect(after.get('frameLooks[id=pill].background.hex')).toBe('#2a9d8f');
    expect(moved(before, after).filter((p) => !p.startsWith('frameLooks[id=pill].background'))).toEqual([]);
  });
  it('adds a first look to a book with none', async () => {
    const { call } = harness(book());
    const done = await call('sandbox_set_config', { changes: [{ path: 'frameLooks', value: [{ id: 'teal', border: { color: hex('#008080') } }] }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const read = await call('sandbox_get_config', { path: 'frameLooks' });
    expect(read.set).toEqual([{ id: 'teal', border: { color: hex('#008080') } }]);
  });
});

// #1095: a modules group inside a row of modules (two levels), and a
// module's grow and shrink, which the group editor and the template editor
// write, are settings like any other.
describe('modules nested and sharing a row', () => {
  const composed = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="shell"}\n:::module{template="box"}\n:::frame{slot="text"}\nWords.\n:::\n:::\n::::\n')];
    const config = {
      pageTemplates: [
        { id: 'shell', frames: [], groups: [{ name: 'body', modules: true }, { name: 'band', modules: true, kind: 'row', within: 'body' }, { name: 'column', modules: true }] },
        { id: 'box', role: 'module', width: { value: 40, unit: 'mm' }, frames: [{ name: 'text' }] },
      ],
    };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it.each([
    ['pageTemplates[id=shell].groups[name=column].within', 'band', 'pageTemplates[id=shell].groups[2].within', 'band'],
    ['pageTemplates[id=box].grow', 2, 'pageTemplates[id=box].grow', 2],
    ['pageTemplates[id=box].shrink', 1, 'pageTemplates[id=box].shrink', 1],
  ] as const)('writes %s and nothing else moves', async (path, value, read, want) => {
    const { call } = harness(composed() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    expect(after.get(read)).toBe(want);
    expect(moved(before, after).filter((p) => p !== read)).toEqual([]);
  });
});

// #1117: what a box grows with, which the frame editor's «Grows with the
// frames inside» writes, is a setting like any other: `'children'` or a
// list of names.
describe('a box that grows with the frames inside it', () => {
  const composed = () => {
    const chapters = [chapter('a', 'Page', '::::page{template="card"}\n:::frame{slot="box" label="Tab"}\n:::\n\n:::frame{slot="note"}\nWords.\n:::\n::::\n')];
    const config = { pageTemplates: [{ id: 'card', frames: [
      { name: 'box', style: 'note' },
      { name: 'note', placement: { anchor: { to: '#box', edge: 'top-left' } } },
    ] }] };
    return { chapters, markdown: chapters[0]!.markdown, config };
  };
  it.each([
    ['pageTemplates[id=card].frames[name=box].growWith', 'children', 'pageTemplates[id=card].frames[0].growWith', 'children'],
    ['pageTemplates[id=card].frames[name=box].growWith', ['note'], 'pageTemplates[id=card].frames[0].growWith[0]', 'note'],
  ] as const)('writes %s = %j and nothing else moves', async (path, value, read, want) => {
    const { call } = harness(composed() as never);
    const before = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    const done = await call('sandbox_set_config', { changes: [{ path, value }], wait: false });
    expect(done.ok, text(done)).toBe(true);
    const after = leafEntries((await call('sandbox_get_config', { effective: true })).effective);
    expect(after.get(read)).toBe(want);
    expect(moved(before, after).filter((p) => p !== read)).toEqual([]);
  });
});
