// Faces that reach a layout worker after it has measured (#760).
//
// A worker's canvas resolves a font the first time a font shorthand is set
// on a context, and keeps that answer for the life of the worker (Chrome
// 131 and 154): a face added to `self.fonts` afterwards for the same
// family, weight, slant and size is not looked for. It holds for another
// weight, an italic, another `unicode-range` slice of a cut, a family that
// was missing, and a file replaced under the same name; a new
// `OffscreenCanvas`, `ctx.reset()` and quoting the family change nothing.
// The page's canvas does look again, so the worker went on measuring with
// what it resolved first (a fallback font, a neighbour of the family made
// bolder, the old file) while the page painted with the new face.
//
// What makes the worker resolve again is another shorthand: another size,
// or another family list. Naming the family twice (`Geist, Geist`) is
// another list and the same font: every character is drawn from the face
// the family alone would give, and one the family lacks falls through to
// the same fallback (measured: the widths of a mixed line are the ones of
// a fresh worker, to the hundredth of a pixel, with the family there and
// with the family missing). So each family has a generation, which goes
// up when faces of it arrive or leave after a shorthand that names it was
// set, and a shorthand is set with the family named once more per
// generation. A worker that got its faces before it measured keeps every
// shorthand as the engine wrote it.

const FAMILIES_RE = /(?:^|\s)\d*\.?\d+px(?:\/\S+)?\s+(.+)$/;

/** The entries of a CSS family list, split at the commas outside quotes. */
function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter((entry) => entry.length > 0);
}

/** A family as the generations key it: unquoted, in lower case. */
function familyKey(family: string): string {
  const f = family.trim();
  return (/^(["']).*\1$/.test(f) ? f.slice(1, -1).replace(/\\(["'])/g, '$1') : f).toLowerCase();
}

/** Shorthands kept with what they are set as, before the map is emptied:
 *  a book has a few hundred, one per family, weight, slant and size. */
const MAX_SHORTHANDS = 4096;

export interface FontGenerations {
  /** The shorthand to set on a canvas for `font`: `font` itself until a
   *  face of one of its families arrived late, then the same with that
   *  family named once more per generation. Notes that the families of
   *  `font` have been measured with. */
  resolve(font: string): string;
  /** Faces of `families` arrived or left. The ones a shorthand was already
   *  set for move to their next generation, so the next `resolve` of a
   *  shorthand that names them gives one the canvas has not seen. Returns
   *  those families (in lower case). */
  changed(families: Iterable<string>): string[];
}

export function createFontGenerations(): FontGenerations {
  const resolved = new Map<string, string>();
  const measured = new Set<string>();
  const generation = new Map<string, number>();
  return {
    resolve(font) {
      const hit = resolved.get(font);
      if (hit !== undefined) return hit;
      let out = font;
      const list = FAMILIES_RE.exec(font)?.[1];
      if (list !== undefined) {
        const written: string[] = [];
        let again = false;
        for (const family of splitFamilies(list)) {
          const key = familyKey(family);
          measured.add(key);
          const times = generation.get(key) ?? 0;
          if (times > 0) again = true;
          for (let i = 0; i <= times; i++) written.push(family);
        }
        if (again) out = `${font.slice(0, font.length - list.length)}${written.join(', ')}`;
      }
      if (resolved.size >= MAX_SHORTHANDS) resolved.clear();
      resolved.set(font, out);
      return out;
    },
    changed(families) {
      const moved: string[] = [];
      for (const family of families) {
        const key = familyKey(family);
        if (!measured.has(key) || moved.includes(key)) continue;
        generation.set(key, (generation.get(key) ?? 0) + 1);
        moved.push(key);
      }
      if (moved.length > 0) resolved.clear();
      return moved;
    },
  };
}

/** A 2D context class whose `font` the generations stand in front of. */
interface ContextClass {
  prototype: object;
}

/**
 * Put `generations` in front of every `font` set on a canvas of this
 * worker: the engine's measuring context, the ones the marks are measured
 * on, and the text library's own, which the engine cannot hand a context
 * to. `contexts` are the classes to cover (by default the worker's
 * `OffscreenCanvasRenderingContext2D`). Returns how many were covered: 0
 * where there is no such class or its `font` cannot be redefined, and the
 * worker then measures as before.
 */
export function installFontGenerations(
  generations: FontGenerations,
  contexts: readonly (ContextClass | undefined)[] = [(globalThis as { OffscreenCanvasRenderingContext2D?: ContextClass }).OffscreenCanvasRenderingContext2D],
): number {
  let covered = 0;
  for (const context of contexts) {
    const prototype = context?.prototype;
    if (!prototype) continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'font');
    const { get, set } = descriptor ?? {};
    if (!descriptor || !set || descriptor.configurable === false) continue;
    Object.defineProperty(prototype, 'font', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get,
      set(this: unknown, value: unknown) {
        set.call(this, typeof value === 'string' ? generations.resolve(value) : value);
      },
    });
    covered++;
  }
  return covered;
}
