/**
 * Edits of `config.pageTemplates` (#863), pure: every function takes the
 * list as stored and gives a new one, so the Design panel and the frame
 * editor on the page write through the same rules.
 *
 * A template is edited at a scope: its own fields (`'base'`) or one of its
 * variants (`'recto'`, `'verso'`, the patch applied on that side). A frame
 * or group the scope does not define (it comes from the template it
 * `extends`, or from the base when a variant is edited) gets a patch entry
 * of its own on the first change: `{ name, ...the fields changed }`, as the
 * engine merges frames by name. A patch entry left with nothing but its
 * name is dropped.
 */

import type {
  DecorationRemoval,
  DesignElement,
  DesignSlot,
  FrameConfig,
  FrameGroupConfig,
  PageTemplate,
  PageTemplatePatch,
  ResolvedPageTemplate,
} from 'postext';
import { mmDim, pxToMm, type Rect } from './frameGeometry';

export type TemplateScope = 'base' | 'recto' | 'verso';

type Templates = readonly PageTemplate[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A deep copy (the config holds plain JSON). */
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Free text turned into an id or a slot name: lowercase, dashes. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `base`, else `base-2`, `base-3`… whichever is not taken. */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const set = new Set(taken);
  const root = base || 'item';
  if (!set.has(root)) return root;
  let n = 2;
  while (set.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

export function templateAt(templates: Templates, id: string): { template: PageTemplate; index: number } | undefined {
  const index = templates.findIndex((t) => isRecord(t) && t.id === id);
  return index < 0 ? undefined : { template: templates[index]!, index };
}

/** The ids of `id`'s ancestors (`extends`), nearest first; stops at a loop. */
export function ancestorsOf(templates: Templates, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let at = templateAt(templates, id)?.template.extends;
  while (at && !seen.has(at)) {
    seen.add(at);
    out.push(at);
    at = templateAt(templates, at)?.template.extends;
  }
  return out;
}

/** The templates that extend `id`, at any depth. */
export function descendantsOf(templates: Templates, id: string): string[] {
  return templates.filter((t) => t.id !== id && ancestorsOf(templates, t.id).includes(id)).map((t) => t.id);
}

/** The patch a scope writes to. */
export function scopeEntry(template: PageTemplate, scope: TemplateScope): PageTemplatePatch | undefined {
  return scope === 'base' ? template : template.variants?.[scope];
}

function withScope(template: PageTemplate, scope: TemplateScope, edit: (patch: PageTemplatePatch) => PageTemplatePatch): PageTemplate {
  if (scope === 'base') return edit({ ...template }) as PageTemplate;
  const variants = { ...(template.variants ?? {}) };
  const next = edit({ ...(variants[scope] ?? {}) });
  if (Object.keys(next).length === 0) delete variants[scope];
  else variants[scope] = next;
  const out: PageTemplate = { ...template };
  if (Object.keys(variants).length === 0) delete out.variants;
  else out.variants = variants;
  return out;
}

function replaceTemplate(templates: Templates, id: string, edit: (t: PageTemplate) => PageTemplate): PageTemplate[] {
  return templates.map((t) => (t.id === id ? edit(t) : t));
}

/** `obj` with `patch` applied: an undefined value takes the key off. */
function applyFields<T extends object>(obj: T, patch: Record<string, unknown>): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** A template made from scratch: one flow frame over the whole area, so
 *  the page shows its text before any frame is drawn. */
export function createTemplate(templates: Templates, name: string): { templates: PageTemplate[]; id: string } {
  const id = uniqueName(templates.map((t) => t.id), slugify(name) || 'template');
  return { templates: [...templates, { id, name, frames: [{ name: 'text', flow: true }] }], id };
}

/** A copy of template `id` (its variants and `extends` too), after it. */
export function duplicateTemplate(templates: Templates, id: string, name: string): { templates: PageTemplate[]; id: string } {
  const at = templateAt(templates, id);
  if (!at) return { templates: [...templates], id };
  const nextId = uniqueName(templates.map((t) => t.id), `${id}-copy`);
  const copy: PageTemplate = { ...clone(at.template), id: nextId, name };
  const out = [...templates];
  out.splice(at.index + 1, 0, copy);
  return { templates: out, id: nextId };
}

/** Template `id` taken out; the templates that extend it keep what they
 *  inherited (its fields merged into theirs), so their pages do not move. */
export function removeTemplate(templates: Templates, id: string): PageTemplate[] {
  const at = templateAt(templates, id);
  if (!at) return [...templates];
  const parent = at.template;
  return templates
    .filter((t) => t.id !== id)
    .map((t) => {
      if (t.extends !== id) return t;
      const merged = mergeTemplatePatch(parent, t);
      if (parent.extends) merged.extends = parent.extends;
      else delete merged.extends;
      return merged;
    });
}

/** `child` laid over `parent` the way the engine merges an `extends`. */
function mergeTemplatePatch(parent: PageTemplate, child: PageTemplate): PageTemplate {
  const out: PageTemplate = { ...clone(parent), ...clone(child) };
  const byName = <T extends { name: string; remove?: boolean }>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => {
    if (!a && !b) return undefined;
    const list: T[] = clone(a ?? []);
    for (const e of b ?? []) {
      const i = list.findIndex((x) => x.name === e.name);
      if (e.remove) {
        if (i >= 0) list.splice(i, 1);
        continue;
      }
      if (i >= 0) list[i] = { ...list[i]!, ...clone(e) };
      else list.push(clone(e));
    }
    return list;
  };
  const frames = byName(parent.frames, child.frames);
  const groups = byName(parent.groups, child.groups);
  if (frames) out.frames = frames;
  if (groups) out.groups = groups;
  if (parent.grid || child.grid) out.grid = { ...(parent.grid ?? {}), ...(child.grid ?? {}) } as PageTemplate['grid'];
  if (parent.decoration || child.decoration) {
    const elements = clone(parent.decoration?.elements ?? []);
    for (const el of child.decoration?.elements ?? []) {
      const i = isElementId(el) ? elements.findIndex((x) => x.id === el.id) : -1;
      // A removal (#975) takes the inherited element out.
      if (isRemoval(el)) {
        if (i >= 0) elements.splice(i, 1);
        continue;
      }
      if (i >= 0) elements[i] = { ...elements[i]!, ...clone(el) } as typeof el;
      else elements.push(clone(el));
    }
    out.decoration = { elements };
  }
  return out;
}

/** Template `id` renamed `next`, with every reference to it: `extends`,
 *  `overflowTemplate` and `continueIn: 'template:…'`. */
export function renameTemplate(templates: Templates, id: string, next: string): PageTemplate[] {
  if (id === next || templates.some((t) => t.id === next)) return [...templates];
  const fixPatch = <P extends PageTemplatePatch>(p: P): P => {
    const out = { ...p };
    if (out.overflowTemplate === id) out.overflowTemplate = next;
    if (out.frames) {
      out.frames = out.frames.map((f) => (f.overflow?.continueIn === `template:${id}` ? { ...f, overflow: { ...f.overflow, continueIn: `template:${next}` } } : f));
    }
    return out;
  };
  return templates.map((t) => {
    let out = fixPatch(t);
    if (out.id === id) out = { ...out, id: next };
    if (out.extends === id) out = { ...out, extends: next };
    if (out.variants) {
      out = {
        ...out,
        variants: {
          ...(out.variants.recto ? { recto: fixPatch(out.variants.recto) } : {}),
          ...(out.variants.verso ? { verso: fixPatch(out.variants.verso) } : {}),
        },
      };
    }
    return out;
  });
}

/** Template-level fields set (undefined: taken off) at a scope. `id`,
 *  `name`, `extends`, `spread`, `gutter` and `role` are the template's
 *  own and always go to the base. */
export function updateTemplate(templates: Templates, id: string, scope: TemplateScope, patch: Partial<PageTemplate>): PageTemplate[] {
  const own: Record<string, unknown> = {};
  const scoped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'name' || k === 'extends' || k === 'spread' || k === 'gutter' || k === 'role' || k === 'variants') own[k] = v;
    else scoped[k] = v;
  }
  return replaceTemplate(templates, id, (t) => {
    let out = applyFields(t, own);
    if (Object.keys(scoped).length > 0) out = withScope(out, scope, (p) => applyFields(p, scoped));
    return out;
  });
}

// ---------------------------------------------------------------------------
// Decoration inherited from another template (#975)
// ---------------------------------------------------------------------------

/** Whether a decoration entry takes the inherited element of its `id` out
 *  (`{ id, remove: true }`) instead of drawing one. */
export function isRemoval(el: DesignElement | DecorationRemoval): el is DecorationRemoval {
  return (el as { remove?: unknown }).remove === true;
}

const isElementId = (el: DesignElement | DecorationRemoval): boolean => typeof el.id === 'string' && el.id !== '';

/** A scope's decoration split in the elements it draws and the ids it
 *  hides, so the slot editor shows only the first and writes them back
 *  with the second kept ({@link joinDecoration}). */
export function splitDecoration(decoration: { elements: (DesignElement | DecorationRemoval)[] } | undefined): { slot: DesignSlot; hidden: string[] } {
  const slot: DesignSlot = { elements: [] };
  const hidden: string[] = [];
  for (const el of decoration?.elements ?? []) {
    if (isRemoval(el)) hidden.push(el.id);
    else slot.elements.push(el);
  }
  return { slot, hidden };
}

/** The inverse of {@link splitDecoration}: the elements drawn, then the
 *  removals; undefined when both are empty. */
export function joinDecoration(slot: DesignSlot | undefined, hidden: readonly string[]): { elements: (DesignElement | DecorationRemoval)[] } | undefined {
  const elements: (DesignElement | DecorationRemoval)[] = [...(slot?.elements ?? []), ...hidden.map((id): DecorationRemoval => ({ id, remove: true }))];
  return elements.length > 0 ? { elements } : undefined;
}

/** The decoration elements a scope inherits: those of the templates it
 *  `extends` (root first) and, for a variant, of its own base, less what
 *  later patches took out; not the ones the scope redefines by `id` (they
 *  are its own). With the ids the scope hides. */
export function inheritedDecoration(templates: Templates, id: string, scope: TemplateScope): { elements: DesignElement[]; hidden: string[] } {
  const own = templateAt(templates, id)?.template;
  if (!own) return { elements: [], hidden: [] };
  const elements: DesignElement[] = [];
  const apply = (patch: PageTemplatePatch | undefined): void => {
    for (const el of patch?.decoration?.elements ?? []) {
      const i = isElementId(el) ? elements.findIndex((x) => x.id === el.id) : -1;
      if (isRemoval(el)) {
        if (i >= 0) elements.splice(i, 1);
      } else if (i >= 0) elements[i] = { ...elements[i]!, ...el } as DesignElement;
      else elements.push(el);
    }
  };
  for (const ancestor of ancestorsOf(templates, id).reverse()) apply(templateAt(templates, ancestor)?.template);
  if (scope !== 'base') apply(own);
  const scoped = scopeEntry(own, scope);
  const ownIds = new Set((scoped?.decoration?.elements ?? []).filter((e) => !isRemoval(e)).map((e) => e.id));
  const hidden = (scoped?.decoration?.elements ?? []).filter(isRemoval).map((e) => e.id);
  // What the scope hides stays in the list (to show it again): the
  // elements as they stood before this scope's own removals.
  return { elements: elements.filter((el) => !ownIds.has(el.id)), hidden };
}

/** Hide (`hidden: true`) or show again the inherited decoration element
 *  `elementId` on one template or variant: a `{ id, remove: true }` entry
 *  in its decoration, taken off to show it. */
export function setInheritedElementHidden(templates: Templates, id: string, scope: TemplateScope, elementId: string, hidden: boolean): PageTemplate[] {
  return replaceTemplate(templates, id, (t) =>
    withScope(t, scope, (p) => {
      const { slot, hidden: ids } = splitDecoration(p.decoration);
      const next = hidden ? (ids.includes(elementId) ? ids : [...ids, elementId]) : ids.filter((x) => x !== elementId);
      const decoration = joinDecoration(slot, next);
      const out = { ...p };
      if (decoration) out.decoration = decoration;
      else delete out.decoration;
      return out;
    }));
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** The frame entry `name` of a scope, as stored. */
export function frameEntry(templates: Templates, id: string, scope: TemplateScope, name: string): FrameConfig | undefined {
  const t = templateAt(templates, id)?.template;
  const p = t ? scopeEntry(t, scope) : undefined;
  return p?.frames?.find((f) => f.name === name);
}

/** Whether frame `name` reaches the scope from elsewhere: an ancestor
 *  template, or the base when a variant is edited. */
export function frameInherited(templates: Templates, id: string, scope: TemplateScope, name: string): boolean {
  const defines = (tid: string, s: TemplateScope): boolean => !!frameEntry(templates, tid, s, name) && !frameEntry(templates, tid, s, name)!.remove;
  if (scope !== 'base' && defines(id, 'base')) return true;
  return ancestorsOf(templates, id).some((a) => defines(a, 'base'));
}

function withFrames(p: PageTemplatePatch, edit: (frames: FrameConfig[]) => FrameConfig[]): PageTemplatePatch {
  const frames = edit([...(p.frames ?? [])]);
  const out = { ...p };
  if (frames.length === 0) delete out.frames;
  else out.frames = frames;
  return out;
}

/**
 * Fields of frame `name` set at a scope (an undefined value takes the
 * field off): the scope's entry, created as a patch when the frame comes
 * from elsewhere, dropped when only its name is left of a patch.
 */
export function updateFrame(templates: Templates, id: string, scope: TemplateScope, name: string, patch: Partial<Record<keyof FrameConfig, unknown>>): PageTemplate[] {
  const inherited = frameInherited(templates, id, scope, name);
  return replaceTemplate(templates, id, (t) =>
    withScope(t, scope, (p) =>
      withFrames(p, (frames) => {
        const i = frames.findIndex((f) => f.name === name);
        const base: FrameConfig = i >= 0 ? frames[i]! : { name };
        const next = applyFields(base, patch as Record<string, unknown>);
        const onlyName = Object.keys(next).every((k) => k === 'name');
        if (i >= 0) {
          if (onlyName && inherited) frames.splice(i, 1);
          else frames[i] = next;
        } else if (!onlyName) {
          frames.push(next);
        }
        return frames;
      }),
    ),
  );
}

/** The frame «Add frame» makes (#991). In a template whose groups already
 *  have members it is sized like the last member of the last such group
 *  (its width and height, as the template resolves them), so a frame added
 *  to a stack comes out as wide and as tall as the ones it joins instead
 *  of a 60 × 40 mm box that has to be changed field by field. A template
 *  with a stack but no member yet gives it the stack's sizes: up to the
 *  edge, as tall as its content. Without a group it is a box of 60 × 40 mm
 *  at the top left of the area. */
export function newFrameFor(name: string, resolved: Pick<ResolvedPageTemplate, 'frames' | 'groups'>): FrameConfig {
  const byName = new Map(resolved.frames.map((f) => [f.name, f]));
  for (const group of [...resolved.groups].reverse()) {
    const members = group.frames.flatMap((m) => byName.get(m) ?? []);
    const like = members[members.length - 1];
    if (like) return { name, width: clone(like.width), height: clone(like.height) };
  }
  if (resolved.groups.some((g) => g.kind === 'stack')) return { name, width: 'fill', height: 'auto' };
  const mm0 = mmDim(0);
  return {
    name,
    width: { value: 60, unit: 'mm' },
    height: { value: 40, unit: 'mm' },
    placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm0, y: mm0 } },
  };
}

/** The list `members` with `name` moved `by` places (negative: earlier),
 *  stopping at the ends; the same list when `name` is not in it. */
export function moveMember(members: readonly string[], name: string, by: number): string[] {
  const from = members.indexOf(name);
  if (from < 0) return [...members];
  const to = Math.max(0, Math.min(members.length - 1, from + by));
  const out = [...members];
  out.splice(from, 1);
  out.splice(to, 0, name);
  return out;
}

/** A new frame at a scope. */
export function addFrame(templates: Templates, id: string, scope: TemplateScope, frame: FrameConfig): PageTemplate[] {
  return replaceTemplate(templates, id, (t) => withScope(t, scope, (p) => withFrames(p, (frames) => [...frames.filter((f) => f.name !== frame.name), frame])));
}

/** Frame `name` taken off at a scope: its entry dropped, or a
 *  `{ name, remove: true }` patch when it comes from elsewhere. */
export function removeFrame(templates: Templates, id: string, scope: TemplateScope, name: string): PageTemplate[] {
  const inherited = frameInherited(templates, id, scope, name);
  let out = replaceTemplate(templates, id, (t) =>
    withScope(t, scope, (p) =>
      withFrames(p, (frames) => {
        const rest = frames.filter((f) => f.name !== name);
        return inherited ? [...rest, { name, remove: true }] : rest;
      }),
    ),
  );
  // Groups of the scope lose it as a member.
  out = replaceTemplate(out, id, (t) =>
    withScope(t, scope, (p) => (p.groups ? { ...p, groups: p.groups.map((g) => (g.frames?.includes(name) ? { ...g, frames: g.frames.filter((m) => m !== name) } : g)) } : p)),
  );
  return out;
}

/** Every name a template's frames and groups use, in every scope and in
 *  its ancestors. */
export function namesInUse(templates: Templates, id: string): Set<string> {
  const names = new Set<string>();
  for (const tid of [id, ...ancestorsOf(templates, id), ...descendantsOf(templates, id)]) {
    const t = templateAt(templates, tid)?.template;
    if (!t) continue;
    for (const p of [t, t.variants?.recto, t.variants?.verso]) {
      for (const f of p?.frames ?? []) names.add(f.name);
      for (const g of p?.groups ?? []) names.add(g.name);
    }
  }
  return names;
}

/** The templates that share frame `name` as seen from template `id`: the
 *  nearest-to-the-root template of its `extends` chain that defines the
 *  frame (in its base or a variant), and everything that extends that one,
 *  siblings of `id` included. A rename applied to this set (and to the page
 *  fences that name those templates) leaves no template reading the old
 *  name. */
export function frameFamily(templates: Templates, id: string, name: string): string[] {
  const defines = (tid: string): boolean => {
    const t = templateAt(templates, tid)?.template;
    return !!t && [t, t.variants?.recto, t.variants?.verso].some((p) => p?.frames?.some((f) => f.name === name));
  };
  const chain = [id, ...ancestorsOf(templates, id)];
  const definer = [...chain].reverse().find(defines) ?? id;
  return [definer, ...descendantsOf(templates, definer)];
}

/** `#from` read as `#to` in an anchor. */
const renameAnchor = <T extends { placement?: FrameConfig['placement'] }>(item: T, from: string, to: string): T =>
  item.placement?.anchor.to === `#${from}` ? { ...item, placement: { ...item.placement, anchor: { ...item.placement.anchor, to: `#${to}` } } } : item;

/**
 * Frame (or group) `from` renamed `to` in template `id`, its variants and
 * the templates that share it (`frameFamily`), with every reference in them: `next`,
 * `overflow.continueIn: '#…'`, anchors, group members and decoration
 * anchors. The Markdown's `slot="…"` names are left alone (the caller
 * says so).
 */
export function renameFrame(templates: Templates, id: string, from: string, to: string): PageTemplate[] {
  if (from === to || namesInUse(templates, id).has(to)) return [...templates];
  const scopeIds = new Set(frameFamily(templates, id, from));
  const fixPatch = (p: PageTemplatePatch): PageTemplatePatch => {
    const out: PageTemplatePatch = { ...p };
    if (p.frames) {
      out.frames = p.frames.map((f) => {
        let g = renameAnchor(f, from, to);
        if (g.name === from) g = { ...g, name: to };
        if (g.next === from) g = { ...g, next: to };
        if (g.overflow?.continueIn === `#${from}`) g = { ...g, overflow: { ...g.overflow, continueIn: `#${to}` } };
        return g;
      });
    }
    if (p.groups) {
      out.groups = p.groups.map((gr) => {
        let g = renameAnchor(gr, from, to);
        if (g.name === from) g = { ...g, name: to };
        if (g.frames?.includes(from)) g = { ...g, frames: g.frames.map((m) => (m === from ? to : m)) };
        return g;
      });
    }
    if (p.decoration?.elements) {
      out.decoration = { elements: p.decoration.elements.map((el) => (!isRemoval(el) && el.placement?.anchor.to === `#${from}` ? { ...el, placement: { ...el.placement, anchor: { ...el.placement.anchor, to: `#${to}` } } } : el)) };
    }
    return out;
  };
  return templates.map((t) => {
    if (!scopeIds.has(t.id)) return t;
    const out = fixPatch(t) as PageTemplate;
    if (t.variants) {
      out.variants = {
        ...(t.variants.recto ? { recto: fixPatch(t.variants.recto) } : {}),
        ...(t.variants.verso ? { verso: fixPatch(t.variants.verso) } : {}),
      };
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function withGroups(p: PageTemplatePatch, edit: (groups: FrameGroupConfig[]) => FrameGroupConfig[]): PageTemplatePatch {
  const groups = edit([...(p.groups ?? [])]);
  const out = { ...p };
  if (groups.length === 0) delete out.groups;
  else out.groups = groups;
  return out;
}

export function addGroup(templates: Templates, id: string, scope: TemplateScope, group: FrameGroupConfig): PageTemplate[] {
  return replaceTemplate(templates, id, (t) => withScope(t, scope, (p) => withGroups(p, (groups) => [...groups.filter((g) => g.name !== group.name), group])));
}

export function updateGroup(templates: Templates, id: string, scope: TemplateScope, name: string, patch: Partial<Record<keyof FrameGroupConfig, unknown>>): PageTemplate[] {
  return replaceTemplate(templates, id, (t) =>
    withScope(t, scope, (p) =>
      withGroups(p, (groups) => {
        const i = groups.findIndex((g) => g.name === name);
        const next = applyFields(i >= 0 ? groups[i]! : { name }, patch as Record<string, unknown>);
        if (i >= 0) groups[i] = next;
        else groups.push(next);
        return groups;
      }),
    ),
  );
}

export function removeGroup(templates: Templates, id: string, scope: TemplateScope, name: string): PageTemplate[] {
  return replaceTemplate(templates, id, (t) => withScope(t, scope, (p) => withGroups(p, (groups) => groups.filter((g) => g.name !== name))));
}

// ---------------------------------------------------------------------------
// From a page
// ---------------------------------------------------------------------------

/**
 * A variant of template `baseId` for one page: a new template that
 * extends it and patches one frame. The caller points the page's fence at
 * it (`fenceTemplateChange`).
 */
export function variantForPage(templates: Templates, baseId: string, name: string, frame: FrameConfig): { templates: PageTemplate[]; id: string } {
  const at = templateAt(templates, baseId);
  const id = uniqueName(templates.map((t) => t.id), `${baseId}-page`);
  const child: PageTemplate = { id, name, extends: baseId, frames: [frame] };
  const out = [...templates];
  out.splice(at ? at.index + 1 : out.length, 0, child);
  return { templates: out, id };
}

/** The frame fields «Save layout as template» keeps from the page's
 *  template: everything but where the frame stands and how big it is. */
const KEPT_FRAME_FIELDS = [
  'style', 'layer', 'rotate', 'verticalAlign', 'columns', 'columnGap', 'padding', 'exclude', 'flow', 'next', 'takes',
  'pin', 'grow', 'shrink', 'priority', 'fit', 'overflow', 'optional', 'crossGutter', 'writingMode', 'direction',
] as const;

/**
 * «Save layout as template»: a new template whose frames stand where the
 * page `rects` shows them (page px, measured from the template's area) at
 * fixed sizes in millimetres, with the rest of each frame, the decoration,
 * the running heads and the area of the page's template (`resolved`).
 */
export function templateFromLayout(
  templates: Templates,
  resolved: ResolvedPageTemplate,
  rects: ReadonlyMap<string, Rect>,
  area: Rect,
  dpi: number,
  name: string,
): { templates: PageTemplate[]; id: string } {
  const id = uniqueName(templates.map((t) => t.id), `${resolved.id}-layout`);
  const frames: FrameConfig[] = resolved.frames.flatMap((f) => {
    const rect = rects.get(f.name);
    if (!rect) return [];
    const out: Record<string, unknown> = {
      name: f.name,
      placement: {
        anchor: { to: 'container', edge: 'top-left' },
        offset: { x: mmDim(pxToMm(rect.x - area.x, dpi)), y: mmDim(pxToMm(rect.y - area.y, dpi)) },
      },
      width: mmDim(pxToMm(rect.width, dpi)),
      height: mmDim(pxToMm(rect.height, dpi)),
    };
    const src = f as unknown as Record<string, unknown>;
    for (const key of KEPT_FRAME_FIELDS) {
      // Only what the template wrote: defaults stay unset.
      if (f.fieldPaths[key] !== undefined && src[key] !== undefined) out[key] = clone(src[key]);
    }
    return [out as unknown as FrameConfig];
  });
  const template: PageTemplate = {
    id,
    name,
    ...(resolved.area !== 'content' ? { area: resolved.area } : {}),
    frames,
    ...(resolved.decoration.elements.length > 0 ? { decoration: clone(resolved.decoration) } : {}),
    ...(resolved.header !== undefined ? { header: clone(resolved.header) } : {}),
    ...(resolved.footer !== undefined ? { footer: clone(resolved.footer) } : {}),
    ...(resolved.bodyStyle ? { bodyStyle: resolved.bodyStyle } : {}),
    ...(resolved.palette ? { palette: resolved.palette } : {}),
    ...(resolved.role !== 'composed' ? { role: resolved.role } : {}),
  };
  return { templates: [...templates, template], id };
}
