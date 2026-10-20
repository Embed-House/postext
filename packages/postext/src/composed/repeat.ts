/**
 * Repeating frames (#1061, DESIGN §12.6): a `grid` group whose `repeat`
 * names a frame set is laid once per content item, so a grid of cards is
 * declared once and the content decides how many there are.
 *
 * - **Items** ({@link pageRepeats}): each piece of the page sent to a frame
 *   of the set (`:::frame{slot="<main>"}`, or a block that names a slot of
 *   the set) is one item, in Markdown order. Inside a piece, a block or
 *   container that names another frame of the set goes to that frame's
 *   instance; the rest stays with the piece's own frame. Items past
 *   `repeat.max` go to the flow frame (`repeatOverflow`).
 * - **Instances** are named `<frame>[n]` (1-based): `card[2]`,
 *   `caption[2]`. `wrap.ts` makes one story per instance, by that name.
 * - **Expansion** ({@link expandRepeats}): the layout turns the template
 *   into one with the instances as ordinary frames, before any geometry,
 *   for the items the page holds. Anchors, `next` and `continueIn: '#x'`
 *   among the set's frames are rewritten to the same instance; anchors to
 *   frames outside the set are kept, and anchors from outside to a frame
 *   of the set read the grid's box. Everything after (groups, the ladder,
 *   continuation, the source map, paint) sees plain frames.
 *
 * Pure.
 */
import type { ElementPlacement } from '../types';
import type { ParsedComposedPage, SlotPiece } from './document';
import type { SourceRange } from './types';
import { anchorTarget, repeatInstance, repeatInstanceName } from './templates';
import type { ResolvedFrame, ResolvedFrameGroup, ResolvedPageTemplate } from './types';

/** One item of a grid on a page. */
export interface RepeatItem {
  /** The grid group. */
  group: string;
  /** 1-based, in Markdown order. */
  item: number;
  /** Block indices each frame of the set receives, in Markdown order. */
  frames: Map<string, number[]>;
  /** The `:::frame` fence each frame's content came in, by frame: its
   *  `label` and `title` dress the instance. */
  fences: Map<string, number>;
  /** The `slot="…"` value of the piece that opened the item. */
  source: SourceRange;
}

/** An item past a grid's `repeat.max`. */
export interface RepeatOverflow {
  group: string;
  /** The grid's main frame. */
  frame: string;
  item: number;
  max: number;
  /** Every block of the item. */
  indices: number[];
  source: SourceRange;
}

export interface PageRepeats {
  items: RepeatItem[];
  overflow: RepeatOverflow[];
  /** Every frame a grid of the template repeats. */
  repeated: ReadonlySet<string>;
}

/** The grids of `template` that repeat a frame set, with the set. */
export function repeatingGrids(template: Pick<ResolvedPageTemplate, 'groups'>): { group: ResolvedFrameGroup; frames: string[]; max?: number }[] {
  return template.groups.flatMap((g) => (g.kind === 'grid' && g.repeat && g.repeat.frames.length > 0 ? [{ group: g, frames: g.repeat.frames, ...(g.repeat.max !== undefined ? { max: g.repeat.max } : {}) }] : []));
}

/**
 * The items of every repeating grid of `template` on `page` (see the
 * module comment). A piece whose slot is no frame of a set is not an item.
 */
export function pageRepeats(page: Pick<ParsedComposedPage, 'pieces'>, template: Pick<ResolvedPageTemplate, 'groups'>): PageRepeats {
  const items: RepeatItem[] = [];
  const overflow: RepeatOverflow[] = [];
  const repeated = new Set<string>();
  for (const { group, frames: set, max } of repeatingGrids(template)) {
    const members = new Set(set);
    for (const f of set) repeated.add(f);
    let n = 0;
    for (const piece of page.pieces) {
      if (!members.has(piece.slot)) continue;
      n++;
      const frames = new Map<string, number[]>();
      const fences = new Map<string, number>();
      const add = (p: SlotPiece, indices: readonly number[]): void => {
        frames.set(p.slot, [...(frames.get(p.slot) ?? []), ...indices]);
        if (p.fence !== undefined && !fences.has(p.slot)) fences.set(p.slot, p.fence);
      };
      // Blocks of the piece that another frame of the set takes.
      const moved = new Set<number>();
      const inner = piece.inner.filter((q) => members.has(q.slot) && q.slot !== piece.slot);
      for (const q of inner) {
        for (const i of q.indices) moved.add(i);
        // A nested `:::frame`'s own markers stay out of both.
        if (q.fence !== undefined) moved.add(q.fence).add(q.fence + q.indices.length + 1);
      }
      add(piece, piece.indices.filter((i) => !moved.has(i)));
      for (const q of inner) add(q, q.indices);
      if (max !== undefined && n > max) {
        overflow.push({ group: group.name, frame: set[0]!, item: n, max, indices: [...piece.indices], source: piece.source });
        continue;
      }
      items.push({ group: group.name, item: n, frames, fences, source: piece.source });
    }
  }
  return { items, overflow, repeated };
}

/** The items of each repeating grid a page lays, read from its stories'
 *  names (`<frame>[n]` for a frame of the set), by grid. */
export function repeatItemsOf(template: Pick<ResolvedPageTemplate, 'groups'>, names: Iterable<string>): Map<string, number[]> {
  const gridOf = new Map<string, string>();
  for (const { group, frames } of repeatingGrids(template)) for (const f of frames) if (!gridOf.has(f)) gridOf.set(f, group.name);
  const out = new Map<string, Set<number>>();
  for (const name of names) {
    const at = repeatInstance(name);
    const g = at ? gridOf.get(at.frame) : undefined;
    if (!at || g === undefined) continue;
    (out.get(g) ?? out.set(g, new Set()).get(g)!).add(at.item);
  }
  return new Map([...out].map(([g, s]) => [g, [...s].sort((a, b) => a - b)]));
}

/** `placement` with its anchor to `#from` read as `#to`. */
function retarget(placement: ElementPlacement | undefined, to: string): ElementPlacement | undefined {
  if (!placement) return placement;
  return { ...placement, anchor: { ...placement.anchor, to: `#${to}` } };
}

/**
 * `template` with each repeating grid's frame set laid out once per item
 * of `items` (by grid; see {@link repeatItemsOf}): the instances replace
 * the set's frames in template order, item after item, each item's main
 * frame first; the grid's `frames` are the instances, `items` says which
 * belong to which cell. A template with no repeating grid comes back as
 * it is.
 */
export function expandRepeats(template: ResolvedPageTemplate, items: ReadonlyMap<string, readonly number[]>): ResolvedPageTemplate {
  const grids = repeatingGrids(template);
  if (grids.length === 0) return template;
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  /** The grid each repeated frame belongs to. */
  const gridOf = new Map<string, ResolvedFrameGroup>();
  for (const { group, frames } of grids) for (const f of frames) if (byName.has(f) && !gridOf.has(f)) gridOf.set(f, group);
  /** Instances of each grid, in cell order. */
  const instancesOf = new Map<string, { item: number; frames: ResolvedFrame[] }[]>();
  for (const { group, frames } of grids) {
    const set = frames.filter((f) => gridOf.get(f) === group);
    const inSet = new Set(set);
    const cells = (items.get(group.name) ?? []).map((item) => ({
      item,
      frames: set.map((name): ResolvedFrame => {
        const f = byName.get(name)!;
        const out: ResolvedFrame = { ...f, name: repeatInstanceName(name, item) };
        // An instance takes no content that names no slot or that a frame
        // `takes`: its content is its item's.
        delete out.takes;
        out.flow = false;
        const target = f.grid ? undefined : anchorTarget(f.placement);
        if (target !== undefined && inSet.has(target)) out.placement = retarget(f.placement, repeatInstanceName(target, item));
        // (The main frame stands in its cell; its own place, kept, says
        // where the template draws the set, which the members that anchor
        // to nothing in it move with.)
        if (f.next !== undefined) {
          if (inSet.has(f.next)) out.next = repeatInstanceName(f.next, item);
          else delete out.next;
        }
        const to = f.overflow.continueIn;
        if (typeof to === 'string' && to.startsWith('#')) {
          const frame = to.slice(1);
          out.overflow = { ...f.overflow };
          if (inSet.has(frame)) out.overflow.continueIn = `#${repeatInstanceName(frame, item)}`;
          else delete out.overflow.continueIn;
        }
        return out;
      }),
    }));
    instancesOf.set(group.name, cells);
  }
  const frames: ResolvedFrame[] = [];
  const placed = new Set<string>();
  for (const f of template.frames) {
    const g = gridOf.get(f.name);
    if (!g) {
      // A frame outside the set anchored to one of the set's frames reads
      // the grid's box.
      const target = f.grid ? undefined : anchorTarget(f.placement);
      const tg = target !== undefined ? gridOf.get(target) : undefined;
      frames.push(tg ? { ...f, placement: retarget(f.placement, tg.name) } : f);
      continue;
    }
    if (placed.has(g.name)) continue;
    placed.add(g.name);
    for (const cell of instancesOf.get(g.name) ?? []) frames.push(...cell.frames);
  }
  const groups = template.groups.map((g): ResolvedFrameGroup => {
    const cells = instancesOf.get(g.name);
    if (!cells) {
      // A frame of a set listed in another group was left out of it by
      // validation; nothing else changes.
      return g;
    }
    return { ...g, frames: cells.flatMap((c) => c.frames.map((f) => f.name)), items: cells.map((c) => ({ item: c.item, frames: c.frames.map((f) => f.name) })) };
  });
  // Decoration anchored to a frame of the set reads the grid's box; to an
  // instance (`#card[2]`), that instance.
  const elements = template.decoration.elements.map((e) => {
    if (e.kind === 'connector') {
      // A connector's end on a frame of the set (`#card`, no instance)
      // reads the grid's box too; `#card[2]` and `#card[*]` are left for
      // the layout, which knows the page's instances (#1056).
      const end = <T extends { to: `#${string}` }>(c: T): T => {
        const tg = c && typeof c.to === 'string' ? gridOf.get(c.to.slice(1)) : undefined;
        return tg ? { ...c, to: `#${tg.name}` } : c;
      };
      return { ...e, from: end(e.from), to: Array.isArray(e.to) ? e.to.map(end) : end(e.to) };
    }
    const target = anchorTarget(e.placement);
    const tg = target !== undefined ? gridOf.get(target) : undefined;
    return tg ? { ...e, placement: retarget(e.placement, tg.name)! } : e;
  });
  return { ...template, frames, groups, decoration: { ...template.decoration, elements } };
}

/** The grid an instance frame belongs to, its item and its set's frame
 *  name, after {@link expandRepeats}. */
export function instanceOf(template: Pick<ResolvedPageTemplate, 'groups'>, name: string): { group: ResolvedFrameGroup; item: number; frame: string; main: boolean } | undefined {
  const at = repeatInstance(name);
  if (!at) return undefined;
  for (const g of template.groups) {
    if (!g.items || !g.repeat) continue;
    const cell = g.items.find((c) => c.item === at.item);
    if (!cell || !cell.frames.includes(name)) continue;
    return { group: g, item: at.item, frame: at.frame, main: cell.frames[0] === name };
  }
  return undefined;
}
