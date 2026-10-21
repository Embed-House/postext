/**
 * A frame that grows with the frames laid inside it (#1117, DESIGN §13.9):
 * `growWith: 'children'` or a list of names. Pure: which frames and groups
 * a box grows with, and the height it needs once they are laid.
 */
import { anchorTarget } from './templates.js';
import type { ResolvedFrame, ResolvedPageTemplate } from './types.js';
import type { Rect } from './geometry.js';

/** The points of a box's top side: a frame anchored there stands inside the
 *  box whatever its height. */
const TOP_EDGES: ReadonlySet<string> = new Set(['top-left', 'top', 'top-right', 'top-start', 'top-end', 'align-top', 'align-left', 'align-right', 'align-start', 'align-end']);

export interface GrowMembers {
  frames: string[];
  groups: string[];
}

/**
 * What `box` grows with: with `'children'`, the frames and groups anchored
 * to a point of its top side, then, round after round, every frame and
 * group anchored to one of those (any edge: a caption `below` its picture),
 * and the frames of a group taken (a grid's instances included); with a
 * list, the frames and groups it names. The box itself, and frames that
 * anchor to it by its foot or middle (they move with its height), never.
 */
export function growMembers(template: Pick<ResolvedPageTemplate, 'frames' | 'groups'>, box: ResolvedFrame): GrowMembers {
  const want = box.growWith;
  if (!want) return { frames: [], groups: [] };
  const frameNames = new Set(template.frames.map((f) => f.name));
  const groupByName = new Map(template.groups.map((g) => [g.name, g]));
  const frames = new Set<string>();
  const groups = new Set<string>();
  const addGroup = (name: string): boolean => {
    const g = groupByName.get(name);
    if (!g || groups.has(name)) return false;
    groups.add(name);
    for (const m of [...g.frames, ...(g.items ?? []).flatMap((c) => c.frames)]) if (frameNames.has(m) && m !== box.name) frames.add(m);
    return true;
  };
  if (Array.isArray(want)) {
    for (const n of want) {
      if (n === box.name) continue;
      if (frameNames.has(n)) frames.add(n);
      else addGroup(n);
    }
    return { frames: [...frames], groups: [...groups] };
  }
  const member = (n: string): boolean => frames.has(n) || groups.has(n);
  /** Whether a placement ties its owner to the box or to a member. */
  const tied = (placement: ResolvedFrame['placement'], grid: unknown): boolean => {
    if (grid) return false;
    const to = anchorTarget(placement);
    if (to === undefined) return false;
    if (to === box.name) return TOP_EDGES.has(placement!.anchor.edge);
    return member(to);
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const f of template.frames) {
      if (f.name === box.name || frames.has(f.name) || !tied(f.placement, f.grid)) continue;
      frames.add(f.name);
      grew = true;
    }
    for (const g of template.groups) {
      if (groups.has(g.name) || !tied(g.placement, g.grid)) continue;
      grew = addGroup(g.name) || grew;
    }
  }
  return { frames: [...frames], groups: [...groups] };
}

/**
 * The height `box` needs to hold its members as laid: from its top to the
 * lowest foot among them, and its bottom padding (`padBottom`, px).
 * `undefined` when none of them is laid, or when the box is tall enough
 * already (within half a pixel).
 */
export function grownHeight(box: Rect, members: readonly Rect[], padBottom: number): number | undefined {
  const feet = members.filter((r) => r.height > 0 || r.width > 0).map((r) => r.y + r.height);
  if (feet.length === 0) return undefined;
  const need = Math.max(...feet) + padBottom - box.y;
  return need > box.height + 0.5 ? need : undefined;
}
