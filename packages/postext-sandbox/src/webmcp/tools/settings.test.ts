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
  }, 120_000);

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
  }, 120_000);
});
