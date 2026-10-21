/**
 * Modules (#1062, DESIGN §12.7): a template with `role: 'module'` is a box
 * of frames, groups and decoration that a page stacks in its modules group
 * (`groups: [{ name, modules: true }]`), one per `:::module{template="…"}`
 * block of the page fence, in Markdown order.
 *
 * {@link expandModules} turns a page template and the modules its page
 * lays into one template with every module's frames, groups and decoration
 * as the page's own, scoped by the instance name: `<name>.<frame>` (the
 * fence's `name`, else `<template>[n]`). Anchors, `next` and `continueIn:
 * '#x'` inside a module are rewritten to the instance; a module frame
 * anchored to `'container'` (or to nothing) reads its module's box, which
 * the layout gives it (as wide as the group, as tall as its frames); a
 * decoration element anchored to `'container'` is anchored to `#<name>`,
 * the module's box. The modules group lists every module frame, in module
 * order, and its `items` say which belong to which module (and, #1088,
 * which modules group inside it lays the module); the module's own groups
 * follow the page's. Everything after (the stories, the
 * ladder, continuation, ids, the source map) sees plain frames.
 *
 * Pure. Run by `resolvePageTemplate` when it is given the page's modules.
 */
import type { ConnectorEnd, DesignConnectorElement, ElementPlacement } from '../types.js';
import type { ComposedModuleUse, ResolvedFrame, ResolvedFrameGroup, ResolvedModule, ResolvedPageTemplate } from './types.js';

/** The `role` of a module template. */
const MODULE = 'module';

/** The name of a module's frame, group or element `local` in instance
 *  `instance`. */
export function moduleScoped(instance: string, local: string): string {
  return `${instance}.${local}`;
}

/** `placement` with its references (`anchor.to`, a size's `to`) to `'#x'`
 *  read through `rename`, and its `'container'` anchor read as `container`
 *  when given. */
function rewritePlacement(placement: ElementPlacement | undefined, rename: (name: string) => string | undefined, container?: string): ElementPlacement | undefined {
  if (!placement) return placement;
  const ref = (to: unknown): unknown => {
    if (typeof to !== 'string') return to;
    if (to === 'container' && container !== undefined) return `#${container}`;
    if (!to.startsWith('#')) return to;
    const renamed = rename(to.slice(1));
    return renamed !== undefined ? `#${renamed}` : to;
  };
  const anchor = placement.anchor ? { ...placement.anchor, to: ref(placement.anchor.to ?? 'container') as ElementPlacement['anchor']['to'] } : placement.anchor;
  let size = placement.size;
  if (size) {
    const out: Record<string, unknown> = { ...size };
    for (const key of ['width', 'height', 'maxWidth'] as const) {
      const v = (size as Record<string, unknown>)[key];
      if (v !== null && typeof v === 'object' && 'to' in (v as object)) out[key] = { ...(v as object), to: ref((v as { to: unknown }).to) };
    }
    size = out as ElementPlacement['size'];
  }
  return { ...placement, anchor, ...(size ? { size } : {}) };
}

/** A connector's ends (#1056) read through `rename`: `'#x'`, an instance
 *  `'#x[2]'` and every instance `'#x[*]'` of a frame of the module name its
 *  scoped frame; ends on frames outside the module are kept as written. */
function rewriteConnectorEnds(
  connector: DesignConnectorElement,
  rename: (name: string) => string | undefined,
): Pick<DesignConnectorElement, 'from' | 'to'> {
  const end = (e: ConnectorEnd): ConnectorEnd => {
    if (typeof e?.to !== 'string' || !e.to.startsWith('#')) return e;
    const ref = e.to.slice(1);
    const bracket = ref.indexOf('[');
    const base = bracket >= 0 ? ref.slice(0, bracket) : ref;
    const renamed = rename(base);
    return renamed === undefined ? e : { ...e, to: `#${renamed}${bracket >= 0 ? ref.slice(bracket) : ''}` };
  };
  return { from: end(connector.from), to: Array.isArray(connector.to) ? connector.to.map(end) : end(connector.to) };
}

/**
 * `page` with the modules `uses` laid in its modules group (see the
 * module comment). `moduleOf` resolves a module template by id. A use
 * whose template is unknown or no module, or whose name an earlier use
 * took, is left out (the slot checks report it); a page with no modules
 * group, or no use left, comes back as it is.
 */
export function expandModules(
  page: ResolvedPageTemplate,
  uses: readonly ComposedModuleUse[],
  moduleOf: (id: string) => ResolvedPageTemplate | undefined,
): ResolvedPageTemplate {
  const group = page.groups.find((g) => g.modules && !g.within);
  if (!group || uses.length === 0) return page;
  // The modules groups laid inside it (#1088), at any depth (#1095): a
  // module goes to the first that takes its template, else to the group
  // itself. A group with groups inside it takes only the templates it
  // names; one without, every template unless it names some.
  const inner = page.groups.filter((g) => g.modules && g.within !== undefined && modulesGroupRoot(page.groups, g) === group.name);
  const holds = new Set(inner.map((g) => g.within!));
  const nestedOf = (template: string): string | undefined => inner.find((g) => (g.templates ? g.templates.includes(template) : !holds.has(g.name)))?.name;
  const taken = new Set<string>();
  const frames: ResolvedFrame[] = [];
  const groups: ResolvedFrameGroup[] = [];
  const elements: ResolvedPageTemplate['decoration']['elements'] = [];
  const paths: string[] = [];
  const modules: ResolvedModule[] = [];
  for (const use of uses) {
    const m = moduleOf(use.template);
    if (!m || m.role !== MODULE || taken.has(use.name)) continue;
    taken.add(use.name);
    const local = new Set<string>([...m.frames.map((f) => f.name), ...m.groups.map((g) => g.name)]);
    for (const e of m.decoration.elements) if (typeof e.id === 'string') local.add(e.id);
    const scope = (n: string): string => moduleScoped(use.name, n);
    const rename = (n: string): string | undefined => (local.has(n) ? scope(n) : undefined);
    const own: ResolvedFrame[] = m.frames.map((f) => {
      const out: ResolvedFrame = { ...f, name: scope(f.name), placement: rewritePlacement(f.placement, rename), flow: false };
      if (out.placement === undefined) delete out.placement;
      // A module has no grid of its own: a cell reads as no placement.
      delete out.grid;
      // A module's `takes` frame takes from its own `:::module` (wrap).
      delete out.takes;
      if (f.next !== undefined) {
        if (local.has(f.next)) out.next = scope(f.next);
        else delete out.next;
      }
      // The frames a box grows with (#1117) are the module's own.
      if (Array.isArray(f.growWith)) {
        const names = f.growWith.filter((n) => local.has(n)).map(scope);
        if (names.length > 0) out.growWith = names;
        else delete out.growWith;
      }
      const to = f.overflow.continueIn;
      if (typeof to === 'string' && to.startsWith('#')) {
        out.overflow = { ...f.overflow };
        if (local.has(to.slice(1))) out.overflow.continueIn = `#${scope(to.slice(1))}`;
        else delete out.overflow.continueIn;
      }
      return out;
    });
    const ownGroups: ResolvedFrameGroup[] = m.groups.map((g) => {
      const out: ResolvedFrameGroup = { ...g, name: scope(g.name), frames: g.frames.map(scope) };
      if (g.repeat) out.repeat = { ...g.repeat, frames: g.repeat.frames.map(scope) };
      const placement = rewritePlacement(g.placement, rename);
      if (placement) out.placement = placement;
      delete out.grid;
      return out;
    });
    const ownElements = m.decoration.elements.map((e) => {
      const id = typeof e.id === 'string' ? { id: scope(e.id) } : {};
      if (e.kind === 'connector') return { ...e, ...id, ...rewriteConnectorEnds(e, rename) };
      return { ...e, ...id, placement: rewritePlacement(e.placement, rename, use.name)! };
    });
    const flow = m.frames.find((f) => f.flow);
    const nested = nestedOf(use.template);
    const takes: ResolvedModule['takes'] = {};
    for (const f of m.frames) if (f.takes && takes[f.takes] === undefined) takes[f.takes] = scope(f.name);
    frames.push(...own);
    groups.push(...ownGroups);
    elements.push(...ownElements);
    paths.push(...m.decorationPaths);
    modules.push({
      name: use.name,
      template: use.template,
      group: group.name,
      configPath: m.configPath,
      frames: own.map((f) => f.name),
      groups: ownGroups.map((g) => g.name),
      elements: ownElements.flatMap((e) => (typeof e.id === 'string' ? [e.id] : [])),
      ...(flow ? { flow: scope(flow.name) } : {}),
      ...(Object.keys(takes).length > 0 ? { takes } : {}),
      ...(m.width !== undefined ? { width: m.width } : {}),
      ...(m.grow !== undefined ? { grow: m.grow } : {}),
      ...(m.shrink !== undefined ? { shrink: m.shrink } : {}),
      ...(nested !== undefined ? { nested } : {}),
    });
  }
  if (modules.length === 0) return page;
  const modulesGroup: ResolvedFrameGroup = {
    ...group,
    frames: frames.map((f) => f.name),
    items: modules.map((m, k) => ({ item: k + 1, frames: [...m.frames], module: m.name, ...(m.nested !== undefined ? { nested: m.nested } : {}) })),
  };
  return {
    ...page,
    frames: [...page.frames, ...frames],
    // The modules group first among the groups that hold a module frame:
    // the page lays it as one step.
    groups: [...page.groups.map((g) => (g === group ? modulesGroup : g)), ...groups],
    decoration: { ...page.decoration, elements: [...page.decoration.elements, ...elements] },
    decorationPaths: [...page.decorationPaths, ...paths],
    modules,
  };
}

/** The modules group `g` lies in at the end of its `within` chain (#1088,
 *  #1095): the one inside no other, `g` itself when it names none.
 *  Undefined when the chain names a group that is no modules group of
 *  `groups`, or comes back on itself. */
export function modulesGroupRoot(groups: readonly Pick<ResolvedFrameGroup, 'name' | 'modules' | 'within'>[], g: Pick<ResolvedFrameGroup, 'name' | 'modules' | 'within'>): string | undefined {
  const seen = new Set<string>([g.name]);
  let at = g;
  while (at.within !== undefined) {
    const parent = groups.find((x) => x.name === at.within);
    if (!parent || !parent.modules || seen.has(parent.name)) return undefined;
    seen.add(parent.name);
    at = parent;
  }
  return at.name;
}
/** The modules groups `nested` lies in (#1095), innermost first: `nested`
 *  itself, then the group it lies `within`, and so on, the page's modules
 *  group (the one inside no other) left out. */
export function nestedChain(groups: readonly Pick<ResolvedFrameGroup, 'name' | 'within'>[], nested: string | undefined): string[] {
  const out: string[] = [];
  let at = nested !== undefined ? groups.find((g) => g.name === nested) : undefined;
  while (at && at.within !== undefined && !out.includes(at.name)) {
    out.push(at.name);
    const parent = at.within;
    at = groups.find((g) => g.name === parent);
  }
  return out;
}

/** The module a frame of an expanded template belongs to (#1062), with its
 *  modules group and its place among the group's modules (1-based). */
export function moduleOfFrame(template: Pick<ResolvedPageTemplate, 'groups' | 'modules'>, name: string): { module: ResolvedModule; group: ResolvedFrameGroup; item: number; frames: string[] } | undefined {
  if (!template.modules || template.modules.length === 0) return undefined;
  for (const group of template.groups) {
    if (!group.modules || !group.items) continue;
    // (The group's items name a grid's instances once they are laid out.)
    const item = group.items.find((c) => c.frames.includes(name));
    const m = item ? template.modules.find((x) => x.name === item.module) : undefined;
    if (item && m) return { module: m, group, item: item.item, frames: item.frames };
  }
  return undefined;
}

/** The modules a page of `template` lays, as uses (`VDTComposedPage.modules`). */
export function moduleUses(template: Pick<ResolvedPageTemplate, 'modules'>): ComposedModuleUse[] | undefined {
  return template.modules && template.modules.length > 0 ? template.modules.map((m) => ({ name: m.name, template: m.template })) : undefined;
}

/** `list` as the uses `resolvePageTemplate` takes (#1062): each name once,
 *  in order, a nested module left out. Undefined when none is left. */
export function moduleUsesOf(list: readonly { name: string; template: string; nested?: true }[] | undefined): ComposedModuleUse[] | undefined {
  if (!list || list.length === 0) return undefined;
  const seen = new Set<string>();
  const out: ComposedModuleUse[] = [];
  for (const m of list) {
    if (m.nested || m.name === '' || seen.has(m.name)) continue;
    seen.add(m.name);
    out.push({ name: m.name, template: m.template });
  }
  return out.length > 0 ? out : undefined;
}
