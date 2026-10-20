/**
 * References between the parts of a template read anew (#1065): every
 * `'#name'` a frame, a group or a decoration element points at (anchors,
 * sizes `to`, `next`, `continueIn: '#…'`, connector ends) and the members
 * of groups, renamed through a map. «Turn these frames into a grid» points
 * what hung from a frame turned into an instance at that instance
 * (`#card2` → `#card[2]`), «Extract a module» what hung from a frame moved
 * into a module at the modules group.
 *
 * Pure: plain JSON in, plain JSON out.
 */

import type { FrameConfig, FrameGroupConfig, PageTemplatePatch } from 'postext';

type Rename = (name: string) => string | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `'#a'` read through `rename` (unchanged when it says nothing). */
function ref(to: unknown, rename: Rename): unknown {
  if (typeof to !== 'string' || !to.startsWith('#') || to.length < 2) return to;
  const next = rename(to.slice(1));
  return next === undefined ? to : `#${next}`;
}

/** A placement with its anchor and its sizes' `to` read anew. */
function placement<T>(p: T, rename: Rename): T {
  if (!isRecord(p)) return p;
  const out: Record<string, unknown> = { ...p };
  if (isRecord(p.anchor)) out.anchor = { ...p.anchor, to: ref(p.anchor.to, rename) };
  if (isRecord(p.size)) {
    const size: Record<string, unknown> = { ...p.size };
    for (const k of ['width', 'height', 'maxWidth']) {
      const v = size[k];
      if (isRecord(v) && 'to' in v) size[k] = { ...v, to: ref(v.to, rename) };
    }
    out.size = size;
  }
  return out as T;
}

export function retargetFrame(f: FrameConfig, rename: Rename): FrameConfig {
  const out: FrameConfig = { ...f };
  if (f.placement) out.placement = placement(f.placement, rename);
  if (typeof f.next === 'string') {
    const next = rename(f.next);
    if (next !== undefined) out.next = next;
  }
  const ci = f.overflow?.continueIn;
  if (typeof ci === 'string' && ci.startsWith('#')) out.overflow = { ...f.overflow, continueIn: ref(ci, rename) as string };
  return out;
}

export function retargetGroup(g: FrameGroupConfig, rename: Rename): FrameGroupConfig {
  const out: FrameGroupConfig = { ...g };
  if (g.placement) out.placement = placement(g.placement, rename);
  return out;
}

/** A decoration element (or a removal entry) read anew. */
export function retargetElement<T>(el: T, rename: Rename): T {
  if (!isRecord(el) || el.remove === true) return el;
  const out: Record<string, unknown> = { ...el };
  if (el.placement) out.placement = placement(el.placement, rename);
  if (el.kind === 'connector') {
    const end = (c: unknown): unknown => (isRecord(c) ? { ...c, to: ref(c.to, rename) } : c);
    out.from = end(el.from);
    out.to = Array.isArray(el.to) ? el.to.map(end) : end(el.to);
  }
  return out as T;
}

/** Every reference of a template patch read anew; group members too
 *  (`members` decides: a name mapped to undefined stays, `null` leaves). */
export function retargetPatch<P extends PageTemplatePatch>(p: P, rename: Rename, members?: (name: string) => string | null | undefined): P {
  const out: P = { ...p };
  if (p.frames) out.frames = p.frames.map((f) => retargetFrame(f, rename));
  if (p.groups) {
    out.groups = p.groups.map((g) => {
      const next = retargetGroup(g, rename);
      if (members && g.frames) {
        next.frames = g.frames.flatMap((m) => {
          const to = members(m);
          return to === null ? [] : [to ?? m];
        });
      }
      return next;
    });
  }
  if (p.decoration?.elements) out.decoration = { ...p.decoration, elements: p.decoration.elements.map((el) => retargetElement(el, rename)) };
  return out;
}
