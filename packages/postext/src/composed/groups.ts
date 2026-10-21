/**
 * Groups of frames on a composed page (#856, DESIGN §2.3, §5.3): a `stack`
 * lays its frames top to bottom, a `row` start to end, with `gap` between
 * them; `grow`, `shrink` and `priority` decide who takes spare space and
 * who gives space back; `pin` frames stay where the template puts them and
 * the others flow round them. Pure: what a frame's content needs comes from
 * a callback, so the rules are tested without laying text out.
 *
 * Also the order frames are placed and filled in once groups count
 * ({@link composedOrder}): a group is placed as a whole, after everything
 * its frames anchor to and before every frame that anchors to it or to one
 * of its frames.
 */
import type { Rect } from './geometry.js';
import { anchorTarget } from './templates.js';
import { nextFrameOf } from './geometry.js';
import type { ResolvedFrame, ResolvedFrameGroup, ResolvedPageTemplate } from './types.js';

/** A frame of a group as the solver reads it. Lengths in page px. */
export interface GroupItem {
  name: string;
  /** The frame's box from its own placement: a stack keeps its `x` and
   *  `width`, a row its `height` when the frame's height is fixed; a pinned
   *  frame keeps all of it. */
  own: Rect;
  /** The height the frame asks for: its fixed height, or its content's at
   *  its width (`'auto'`), before min/max. */
  want: number;
  min: number;
  max: number;
  minWidth: number;
  maxWidth: number;
  grow: number;
  shrink: number;
  priority: number;
  pin: boolean;
  /** A height written as a length: a row does not stretch it. */
  fixedHeight: boolean;
  /** The content's height at a width (rows negotiate widths with it). */
  need?: (width: number) => number;
  /** The least height a stack cuts the frame to when nothing more yields
   *  (#911): its `minHeight`. Default `min`. */
  floor?: number;
}

export interface GroupLayoutInput {
  kind: 'stack' | 'row';
  /** The group's box: its own (`placement` / `grid`), or, for a group with
   *  none (`elastic`), where its first frame stands. */
  box: Rect;
  /** No box of its own: a stack runs down as far as its frames need, to
   *  the foot of `limit`; a row takes its frames' widths and grows as tall
   *  as the tallest needs. Spare space, `grow` and `align` only apply to a
   *  group with a box. */
  elastic: boolean;
  /** How far an elastic group may run (the template's area). */
  limit: Rect;
  gap: number;
  align: 'start' | 'center' | 'end' | 'space-between';
  /** In group order. */
  items: readonly GroupItem[];
  /** Pinned frames outside the group: the group's frames flow round them. */
  obstacles?: readonly Rect[];
  /** Page px in a millimetre: a row negotiates widths in whole millimetres. */
  mmPx: number;
  /** Rows: take width from siblings for a frame whose content runs past
   *  the row's height. Off for the template's own (declared) layout. */
  negotiate: boolean;
}

const EPS = 0.5;

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max));

/** Share `amount` among `items` in proportion to `weight`, none past its
 *  `room`; what an item cannot take goes to the others. Returns each one's
 *  share, in `items` order. */
export function shareOut(amount: number, items: readonly { weight: number; room: number }[]): number[] {
  const out = items.map(() => 0);
  let left = amount;
  let open = items.map((it, i) => (it.weight > 0 && it.room > EPS ? i : -1)).filter((i) => i >= 0);
  while (left > EPS && open.length > 0) {
    const total = open.reduce((s, i) => s + items[i]!.weight, 0);
    let used = 0;
    const still: number[] = [];
    for (const i of open) {
      const want = (left * items[i]!.weight) / total;
      const room = items[i]!.room - out[i]!;
      const take = Math.min(want, room);
      out[i]! += take;
      used += take;
      if (room - take > EPS) still.push(i);
    }
    left -= used;
    if (still.length === open.length) break;
    open = still;
  }
  return out;
}

/** Tiers of the frames that yield, lowest priority first. */
function yieldTiers<T extends { priority: number; shrink: number }>(items: readonly T[]): T[][] {
  const by = new Map<number, T[]>();
  for (const it of items) if (it.shrink > 0) (by.get(it.priority) ?? by.set(it.priority, []).get(it.priority)!).push(it);
  return [...by.keys()].sort((a, b) => a - b).map((k) => by.get(k)!);
}

const overlapsX = (a: { x: number; width: number }, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width;
const overlapsY = (a: { y: number; height: number }, b: Rect): boolean => a.y < b.y + b.height && b.y < a.y + a.height;

/** The boxes of a group's frames, by name. */
export function layoutGroup(input: GroupLayoutInput): Map<string, Rect> {
  return input.kind === 'row' ? layoutRow(input) : layoutStack(input);
}

function layoutStack(input: GroupLayoutInput): Map<string, Rect> {
  const { box, gap } = input;
  const flow = input.items.filter((i) => !i.pin);
  const pins = input.items.filter((i) => i.pin).map((i) => i.own);
  const obstacles = [...(input.obstacles ?? []), ...pins];
  const heights = flow.map((i) => clamp(i.want, i.min, i.max));
  const place = (hs: readonly number[], lead = 0, extraGap = 0): Rect[] => {
    const out: Rect[] = [];
    let cursor = box.y + lead;
    flow.forEach((it, k) => {
      let y = cursor;
      const h = hs[k]!;
      // Skip the band of every pinned frame the box would meet.
      for (let moved = true, guard = 0; moved && guard < obstacles.length + 1; guard++) {
        moved = false;
        for (const o of obstacles) {
          if (overlapsX(it.own, o) && overlapsY({ y: y - gap, height: h + 2 * gap }, o) && o.y + o.height + gap > y) {
            y = o.y + o.height + gap;
            moved = true;
          }
        }
      }
      out.push({ x: it.own.x, y, width: it.own.width, height: h });
      cursor = y + h + gap + extraGap;
    });
    return out;
  };
  const bottomOf = (rs: readonly Rect[]): number => (rs.length > 0 ? Math.max(...rs.map((r) => r.y + r.height)) : box.y);
  const foot = input.elastic ? Math.max(input.limit.y + input.limit.height, box.y) : box.y + box.height;
  let rects = place(heights);
  // Too tall: the frames that yield give space back, lowest priority
  // first, in proportion to `shrink` within a priority, down to their
  // minimum (their content may then run past their foot).
  for (const tier of yieldTiers(flow.map((it, k) => ({ ...it, k })))) {
    const excess = bottomOf(rects) - foot;
    if (excess <= EPS) break;
    const shares = shareOut(excess, tier.map((t) => ({ weight: t.shrink, room: heights[t.k]! - t.min })));
    tier.forEach((t, j) => (heights[t.k] = heights[t.k]! - shares[j]!));
    rects = place(heights);
  }
  if (bottomOf(rects) - foot > EPS) {
    // Nothing more yields: the frames nearest the foot give way first, each
    // down to the least it may have (its `minHeight`; a fixed height its
    // own: an answer space, a picture slot), their content running past
    // their foot; so a box that grew does not push an empty frame under it
    // off the page (#911).
    for (let k = flow.length - 1; k >= 0; k--) {
      const excess = bottomOf(rects) - foot;
      if (excess <= EPS) break;
      const it = flow[k]!;
      const floor = it.floor ?? it.min;
      const least = it.fixedHeight && floor <= EPS ? heights[k]! : Math.min(heights[k]!, floor);
      const give = Math.min(excess, heights[k]! - least);
      if (give <= EPS) continue;
      heights[k] = heights[k]! - give;
      rects = place(heights);
    }
  }
  if (bottomOf(rects) - foot > EPS) {
    // Still too tall with every frame at its least: no frame runs past the
    // group's foot (what is cut shows as the frame's overflow).
    rects = rects.map((r) => {
      const y = Math.min(r.y, foot);
      return { ...r, y, height: Math.max(0, Math.min(r.height, foot - y)) };
    });
    return named(flow, rects, input.items);
  }
  if (input.elastic) return named(flow, rects, input.items);
  // Spare space: to the frames that grow, in proportion to `grow`, up to
  // their maximum; what is left follows `align`.
  const spare = foot - bottomOf(rects);
  if (spare > EPS) {
    const shares = shareOut(spare, flow.map((it, k) => ({ weight: it.grow, room: it.max - heights[k]! })));
    if (shares.some((s) => s > 0)) {
      shares.forEach((s, k) => (heights[k] = heights[k]! + s));
      rects = place(heights);
    }
    const rest = foot - bottomOf(rects);
    // Pinned frames hold their place: spare space then stays at the foot.
    if (rest > EPS && obstacles.length === 0 && flow.length > 0) {
      if (input.align === 'end') rects = place(heights, rest);
      else if (input.align === 'center') rects = place(heights, rest / 2);
      else if (input.align === 'space-between' && flow.length > 1) rects = place(heights, 0, rest / (flow.length - 1));
    }
  }
  return named(flow, rects, input.items);
}

function layoutRow(input: GroupLayoutInput): Map<string, Rect> {
  const { box, gap, mmPx } = input;
  const flow = input.items.filter((i) => !i.pin);
  const pins = input.items.filter((i) => i.pin).map((i) => i.own);
  const obstacles = [...(input.obstacles ?? []), ...pins];
  const widths = flow.map((i) => clamp(i.own.width, i.minWidth, i.maxWidth));
  const declaredH = flow.map((i) => clamp(i.fixedHeight ? i.own.height : i.want, i.min, i.max));
  /** The heights the template writes: a fixed height, else `minHeight`
   *  (an `'auto'` frame declares no more). */
  const writtenH = flow.map((i) => (i.fixedHeight ? declaredH[flow.indexOf(i)]! : Math.min(i.min, i.max)));
  /** The row's height: its box's; with none, the tallest height its frames
   *  write (#927: `'auto'` cards with a `minHeight` negotiate widths at it
   *  before the row grows), or, when they write none, the tallest
   *  content's. */
  const rowH = !input.elastic ? box.height : Math.max(0, ...writtenH) > EPS ? Math.max(0, ...writtenH) : Math.max(0, ...declaredH);
  /** The height a frame has in the row: a fixed one its own, the others
   *  the row's. */
  const heightIn = (k: number, h: number): number => (flow[k]!.fixedHeight ? Math.min(declaredH[k]!, h) : clamp(h, flow[k]!.min, flow[k]!.max));
  const fits = (k: number, w: number): boolean => !flow[k]!.need || flow[k]!.need!(w) <= heightIn(k, rowH) + EPS;
  const used = (): number => widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, flow.length - 1);
  let spare = input.elastic ? 0 : box.width - used();
  if (input.negotiate) {
    /** The narrowest width, in whole mm below `w`, at which frame `k`'s
     *  content still fits the row (`w` itself when no narrower one does). */
    const narrowest = (k: number, w: number): number => {
      const floor = Math.max(flow[k]!.minWidth, mmPx);
      let hi = Math.floor((w - floor) / mmPx); // millimetres it may give
      if (hi <= 0 || !fits(k, w)) return w;
      let lo = 0;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(k, w - mid * mmPx)) lo = mid;
        else hi = mid - 1;
      }
      return w - lo * mmPx;
    };
    flow.forEach((it, k) => {
      if (fits(k, widths[k]!)) return;
      const rooms = flow.map((s, j) => (j === k || s.shrink <= 0 ? 0 : widths[j]! - narrowest(j, widths[j]!)));
      const free = Math.max(0, spare) + rooms.reduce((s, r) => s + r, 0);
      const cap = Math.min(it.maxWidth, widths[k]! + free);
      const most = Math.floor((cap - widths[k]! + EPS) / mmPx);
      // The fewest whole millimetres that make the content fit, by
      // bisection; none when even all the room does not.
      if (most <= 0 || !fits(k, widths[k]! + most * mmPx)) return;
      let lo = 1;
      let hi = most;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(k, widths[k]! + mid * mmPx)) hi = mid;
        else lo = mid + 1;
      }
      let need = lo * mmPx;
      widths[k]! += need;
      const fromSpare = Math.min(Math.max(0, spare), need);
      spare -= fromSpare;
      need -= fromSpare;
      // The rest from the siblings that yield, lowest priority first, in
      // whole millimetres, in proportion to `shrink` within a priority.
      for (const tier of yieldTiers(flow.map((s, j) => ({ ...s, j })).filter((s) => s.j !== k && rooms[s.j]! > EPS))) {
        if (need <= EPS) break;
        const shares = shareOut(need, tier.map((t) => ({ weight: t.shrink, room: rooms[t.j]! })));
        let mmLeft = Math.ceil(need / mmPx - 1e-6);
        const whole = shares.map((s) => Math.min(Math.floor((s + EPS) / mmPx), mmLeft));
        mmLeft -= whole.reduce((s, v) => s + v, 0);
        // Rounding: the remaining millimetres from the last frames first.
        for (let j = tier.length - 1; j >= 0 && mmLeft > 0; j--) {
          const roomMm = Math.floor((rooms[tier[j]!.j]! + EPS) / mmPx) - whole[j]!;
          const add = Math.min(roomMm, mmLeft);
          whole[j]! += add;
          mmLeft -= add;
        }
        tier.forEach((t, j) => {
          widths[t.j]! -= whole[j]! * mmPx;
          need -= whole[j]! * mmPx;
        });
      }
      // Whole millimetres may give a little more than the frame took.
      if (need < 0) spare -= need;
    });
  }
  // Spare width: to the frames that grow, then `align`.
  if (!input.elastic && spare > EPS) {
    const shares = shareOut(spare, flow.map((it, k) => ({ weight: it.grow, room: it.maxWidth - widths[k]! })));
    shares.forEach((s, k) => (widths[k]! += s));
    spare -= shares.reduce((s, v) => s + v, 0);
  }
  // An elastic row grows as tall as its tallest frame now needs.
  let height = rowH;
  if (input.elastic && input.negotiate) {
    const tallest = Math.max(rowH, ...flow.map((it, k) => (it.fixedHeight || !it.need ? 0 : clamp(it.need(widths[k]!), it.min, it.max))));
    height = Math.min(tallest, Math.max(rowH, input.limit.y + input.limit.height - box.y));
  }
  let lead = 0;
  let extraGap = 0;
  if (spare > EPS && obstacles.length === 0 && flow.length > 0) {
    if (input.align === 'end') lead = spare;
    else if (input.align === 'center') lead = spare / 2;
    else if (input.align === 'space-between' && flow.length > 1) extraGap = spare / (flow.length - 1);
  }
  const rects: Rect[] = [];
  let cursor = box.x + lead;
  flow.forEach((_it, k) => {
    const w = widths[k]!;
    const h = heightIn(k, height);
    let x = cursor;
    for (let moved = true, guard = 0; moved && guard < obstacles.length + 1; guard++) {
      moved = false;
      for (const o of obstacles) {
        if (overlapsY({ y: box.y, height: h }, o) && overlapsX({ x: x - gap, width: w + 2 * gap }, o) && o.x + o.width + gap > x) {
          x = o.x + o.width + gap;
          moved = true;
        }
      }
    }
    rects.push({ x, y: box.y, width: w, height: h });
    cursor = x + w + gap + extraGap;
  });
  return named(flow, rects, input.items);
}

function named(flow: readonly GroupItem[], rects: readonly Rect[], all: readonly GroupItem[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const it of all) {
    const k = flow.indexOf(it);
    out.set(it.name, k >= 0 ? rects[k]! : { ...it.own });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Order of work
// ---------------------------------------------------------------------------

/** A step of a composed page's layout: one frame, or a whole group. */
export type ComposedStep =
  | { kind: 'frame'; frame: ResolvedFrame }
  | { kind: 'group'; group: ResolvedFrameGroup; frames: ResolvedFrame[] };

/** The group each frame belongs to (its first, when validation found it
 *  in two). Groups with no frame are left out. */
export function groupOfFrames(template: Pick<ResolvedPageTemplate, 'frames' | 'groups'>): Map<string, ResolvedFrameGroup> {
  const names = new Set(template.frames.map((f) => f.name));
  const out = new Map<string, ResolvedFrameGroup>();
  for (const g of template.groups) for (const m of g.frames) if (names.has(m) && !out.has(m)) out.set(m, g);
  return out;
}

/**
 * The order a composed page is placed and filled in: P4's
 * {@link frameOrder} rules (a frame after what it anchors to and after the
 * frame its chain comes from, frames that push text first, else template
 * order), with each group a single step. A group comes after everything
 * its frames and its own box anchor to; anything anchored to the group or
 * to one of its frames comes after it. Its frames are filled in group
 * order. Loops (a group's frame anchored to a frame anchored back into the
 * group) are broken where they close, as P4 breaks anchor loops.
 */
export function composedOrder(template: Pick<ResolvedPageTemplate, 'frames' | 'groups'>): ComposedStep[] {
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const groupOf = groupOfFrames(template);
  const groups = new Map(template.groups.map((g) => [g.name, g]));
  const prev = new Map<string, string>();
  for (const f of template.frames) {
    const n = nextFrameOf(f);
    if (n && byName.has(n) && !prev.has(n)) prev.set(n, f.name);
  }
  /** The step a frame or group name is placed in. */
  const stepKey = (name: string): string | undefined => {
    if (byName.has(name)) {
      const g = groupOf.get(name);
      return g ? `g:${g.name}` : `f:${name}`;
    }
    let g = groups.get(name);
    if (!g) return undefined;
    // A modules group inside another (#1088) is laid with the one inside
    // no other, which holds its modules' frames (#1095).
    for (let hops = 0; g.modules && g.within !== undefined && hops < groups.size; hops++) {
      const parent = groups.get(g.within);
      if (!parent || !parent.modules) break;
      g = parent;
    }
    if (g.frames.some((m) => groupOf.get(m) === g)) return `g:${g.name}`;
    return undefined;
  };
  /** Steps a group with no frame stands for: its own anchor. */
  const targetKeys = (target: string | undefined, seen: Set<string>): string[] => {
    if (!target) return [];
    const k = stepKey(target);
    if (k) return [k];
    const g = groups.get(target);
    if (!g || seen.has(g.name)) return [];
    seen.add(g.name);
    if (g.grid) return [];
    if (g.placement) return targetKeys(anchorTarget(g.placement), seen);
    return g.frames.flatMap((m) => targetKeys(m, seen));
  };
  const frameDeps = (f: ResolvedFrame): string[] => {
    const out = f.grid ? [] : targetKeys(anchorTarget(f.placement), new Set());
    const p = prev.get(f.name);
    if (p) out.push(...targetKeys(p, new Set()));
    return out;
  };
  const steps = new Map<string, ComposedStep>();
  const deps = new Map<string, string[]>();
  for (const f of template.frames) {
    const g = groupOf.get(f.name);
    const key = g ? `g:${g.name}` : `f:${f.name}`;
    if (!steps.has(key)) {
      steps.set(key, g
        ? { kind: 'group', group: g, frames: g.frames.filter((m) => groupOf.get(m) === g).map((m) => byName.get(m)!) }
        : { kind: 'frame', frame: f });
      deps.set(key, []);
    }
    deps.get(key)!.push(...frameDeps(f).filter((d) => d !== key));
  }
  for (const [key, step] of steps) {
    if (step.kind !== 'group' || step.group.grid) continue;
    deps.get(key)!.push(...targetKeys(anchorTarget(step.group.placement), new Set([step.group.name])).filter((d) => d !== key));
  }
  const out: ComposedStep[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string): void => {
    if (state.has(key)) return;
    state.set(key, 'visiting');
    for (const d of deps.get(key) ?? []) if (steps.has(d)) visit(d);
    state.set(key, 'done');
    out.push(steps.get(key)!);
  };
  const keyOf = (f: ResolvedFrame): string => {
    const g = groupOf.get(f.name);
    return g ? `g:${g.name}` : `f:${f.name}`;
  };
  for (const f of template.frames) if (f.exclude === 'push') visit(keyOf(f));
  for (const f of template.frames) visit(keyOf(f));
  return out;
}
