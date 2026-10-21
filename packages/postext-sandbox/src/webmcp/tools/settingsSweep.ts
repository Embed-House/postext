import { describe, expect, it } from 'vitest';
import { leafEntries } from '../configPaths';
import { chapter, harness } from './testHarness';
import { partOf } from './testParts';

// "Change any of the settings": every setting the engine resolves for a
// book that stores no design of its own is written through
// sandbox_set_config and read back. Such a book is the hard case — each
// write has to find what must be stored along with the setting (the rest
// of a length, the name of a list item, the design's list) for the rest
// of the design to stay where it was.

export const book = () => {
  const chapters = [chapter('a', 'Opening', '# Opening\n\nSome words here.\n')];
  return { chapters, markdown: chapters[0]!.markdown, config: {} };
};

export const text = (v: unknown) => JSON.stringify(v);

/** The settings that differ between two resolved configurations. Which
 *  palette entry a colour follows is not one: the engine drops the link
 *  from a resolved colour once the book stores a palette. */
export function moved(before: Map<string, unknown>, after: Map<string, unknown>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((p) => !p.endsWith('.paletteId') && text(before.get(p)) !== text(after.get(p)));
}

/** Settings the engine reads differently once they are spelled out, even
 *  with the value they had: the page number of a contents entry takes the
 *  entry's weight, a callout's list markers their own colour. */
export const FOLLOWS_WHEN_SET: Record<string, string> = {
  'toc.levels[level=1].fontWeight': 'toc.levels[level=1].numberFontWeight',
  'calloutStyles[id=note].lists.color.hex': 'calloutStyles[id=note].lists.colorSet',
  'calloutStyles[id=note].lists.color.model': 'calloutStyles[id=note].lists.colorSet',
  'calloutStyles[id=note].lists.color.paletteId': 'calloutStyles[id=note].lists.colorSet',
};

/** Registers part `part` (from 1) of `of` of the round trip below: every
 *  setting written with the value it has, which took most of a minute in
 *  one test; the settingsRoundTrip.part*.test.ts files share it (#1118). */
export function registerRoundTrip(part: number, of: number): void {
  describe(`every setting the engine resolves, part ${part} of ${of}`, () => {
    it('can be written with the value it has, and nothing moves', async () => {
      const before = leafEntries((await harness(book()).call('sandbox_get_config', { effective: true })).effective);
      expect(before.size).toBeGreaterThan(1500);
      const mine = partOf([...before], part, of);
      const failures: string[] = [];
      for (const [path, value] of mine) {
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
  });
}
