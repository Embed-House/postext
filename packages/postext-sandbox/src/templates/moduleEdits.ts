/**
 * The module library (#1065): module templates (`role: 'module'`, #1062,
 * DESIGN §12.7) with where the book uses them, made, renamed with their
 * uses, written into a composed page as a `:::module` block with an empty
 * slot for each of their frames, and «Extract a module»: frames of a page
 * template (and the decoration hanging from them) moved into a new module,
 * the page template given a modules group in their place, and each page's
 * pieces for those frames wrapped in a `:::module` block, so the page looks
 * as it did.
 *
 * Pure: the caller writes the result (Design panel, sandbox_* tools).
 */

import { resolvePageTemplate, type DesignElement, type ElementPlacement, type FrameConfig, type FrameGroupConfig, type PageTemplate, type ResolvedPageTemplate } from 'postext';
import type { TextChange } from '../book/textChanges.js';
import { pageSites, type PageSites, type SlotSite } from '../viewport/composed/slotSource.js';
import { mmDim, pxToMm, type Rect } from './frameGeometry.js';
import { placementLike, type LaidTemplatePage } from './framesToGrid.js';
import { pagesOfTemplates, rewritePage, siteText } from './pagePieces.js';
import { retargetPatch } from './retarget.js';
import { namesInUse, renameTemplate, slugify, templateAt, uniqueName } from './templateEdits.js';
import { templateFences } from './templateUsage.js';

type Templates = readonly PageTemplate[];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A module template (#1062): `role: 'module'`. */
export const isModule = (t: Pick<PageTemplate, 'role'> | undefined): boolean => t?.role === 'module';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/** One `:::module` block of a chapter. */
export interface ModuleBlock {
  /** The module template as written. */
  template: string;
  /** Its instance name on the page. */
  name: string;
  /** The page fence it is in, and the page's template. */
  fenceStart: number;
  pageTemplate: string;
  /** The block, and the `template` value (inside the quotes). */
  start: number;
  end: number;
  templateRange?: { start: number; end: number };
}

/** Every `:::module` block of the composed pages of `markdown`. */
export function moduleBlocks(markdown: string): ModuleBlock[] {
  const out: ModuleBlock[] = [];
  for (const f of templateFences(markdown)) {
    const sites = pageSites(markdown, f.fenceStart, markdown.length);
    if (!sites) continue;
    for (const m of sites.modules) {
      out.push({ template: m.template, name: m.name, fenceStart: f.fenceStart, pageTemplate: f.template, start: m.start, end: m.end, ...(m.templateRange ? { templateRange: m.templateRange } : {}) });
    }
  }
  return out;
}

export interface ModuleUsage {
  /** `:::module` blocks naming it. */
  blocks: number;
  /** Composed pages holding at least one. */
  pages: number;
  /** By chapter (0-based), the blocks. */
  chapters: { chapterIndex: number; blocks: number; offsets: number[] }[];
  /** The page templates of the pages that hold it. */
  pageTemplates: string[];
}

/** The module templates of the book, in the order stored. */
export function moduleTemplates(templates: Templates): PageTemplate[] {
  return templates.filter((t) => isModule(t));
}

/** The modules groups of a template the modules group `name` may lie in
 *  (`within`, #1088): any other (#1095: a row or a grid too, to any
 *  depth), but none that lies inside `name` itself, which would make a
 *  loop. In the template's order. */
export function modulesGroupParents(groups: readonly Pick<FrameGroupConfig, 'name' | 'modules' | 'within'>[], name: string): string[] {
  const byName = new Map(groups.map((g) => [g.name, g]));
  const liesIn = (g: Pick<FrameGroupConfig, 'name' | 'within'>): boolean => {
    const seen = new Set<string>();
    let at: Pick<FrameGroupConfig, 'name' | 'within'> | undefined = g;
    while (at && !seen.has(at.name)) {
      if (at.name === name) return true;
      seen.add(at.name);
      at = at.within !== undefined ? byName.get(at.within) : undefined;
    }
    return false;
  };
  return groups.filter((g) => g.modules === true && g.name !== name && !liesIn(g)).map((g) => g.name);
}

/** How the book uses each module template: blocks, pages, by chapter. */
export function moduleUsage(templates: Templates, chapters: readonly { markdown: string }[]): Map<string, ModuleUsage> {
  const out = new Map<string, ModuleUsage>();
  for (const t of moduleTemplates(templates)) out.set(t.id, { blocks: 0, pages: 0, chapters: [], pageTemplates: [] });
  chapters.forEach((ch, chapterIndex) => {
    const pagesSeen = new Map<string, Set<number>>();
    for (const b of moduleBlocks(ch.markdown)) {
      const u = out.get(b.template);
      if (!u) continue;
      u.blocks++;
      const pages = pagesSeen.get(b.template) ?? pagesSeen.set(b.template, new Set()).get(b.template)!;
      if (!pages.has(b.fenceStart)) {
        pages.add(b.fenceStart);
        u.pages++;
      }
      if (b.pageTemplate && !u.pageTemplates.includes(b.pageTemplate)) u.pageTemplates.push(b.pageTemplate);
      let row = u.chapters.find((c) => c.chapterIndex === chapterIndex);
      if (!row) {
        row = { chapterIndex, blocks: 0, offsets: [] };
        u.chapters.push(row);
      }
      row.blocks++;
      row.offsets.push(b.start);
    }
  });
  return out;
}

/** A new module: one frame of text, as wide as the modules group. */
export function createModule(templates: Templates, name: string): { templates: PageTemplate[]; id: string } {
  const id = uniqueName(templates.map((t) => t.id), slugify(name) || 'module');
  return { templates: [...templates, { id, name, role: 'module', frames: [{ name: 'text' }] }], id };
}

/** The changes that rename module `from` to `to` in every `:::module`
 *  block of `markdown` that names it. */
export function renameModuleChanges(markdown: string, from: string, to: string): TextChange[] {
  return moduleBlocks(markdown)
    .filter((b) => b.template === from && b.templateRange)
    .map((b) => ({ from: b.templateRange!.start, to: b.templateRange!.end, insert: to, expect: from }));
}

/** Module `from` renamed `to` in the templates (`extends` and the rest,
 *  as any template) and in the chapters' `:::module` blocks. */
export function planRenameModule(templates: Templates, chapters: readonly { id: string; markdown: string }[], from: string, to: string): { templates: PageTemplate[]; chapters: { chapterId: string; changes: TextChange[]; baseLength: number }[] } | null {
  const next = slugify(to);
  if (!next || next === from || templates.some((t) => t.id === next) || !templateAt(templates, from)) return null;
  return {
    templates: renameTemplate(templates, from, next),
    chapters: chapters.flatMap((c) => {
      const changes = renameModuleChanges(c.markdown, from, next);
      return changes.length > 0 ? [{ chapterId: c.id, changes, baseLength: c.markdown.length }] : [];
    }),
  };
}

// ---------------------------------------------------------------------------
// A module written into a page
// ---------------------------------------------------------------------------

/** The `:::module` block for module `resolved`: an empty `:::frame{slot}`
 *  for each frame that takes a piece (not the one that takes its
 *  headings); a grid's frame set as one empty item. */
export function moduleBlockText(resolved: Pick<ResolvedPageTemplate, 'id' | 'frames' | 'groups'>): string {
  const sets = new Map<string, readonly string[]>();
  for (const g of resolved.groups) for (const f of g.repeat?.frames ?? []) if (!sets.has(f)) sets.set(f, g.repeat!.frames);
  const parts: string[] = [];
  for (const f of resolved.frames) {
    if (f.takes) continue;
    const set = sets.get(f.name);
    if (set && set[0] !== f.name) continue;
    if (set) {
      const inner = set.slice(1).map((m) => `:::frame{slot="${m}"}\n\n:::\n`).join('\n');
      parts.push(`:::frame{slot="${f.name}"}\n${inner}:::\n`);
      continue;
    }
    parts.push(`:::frame{slot="${f.name}"}\n\n:::\n`);
  }
  return `:::module{template="${resolved.id}"}\n${parts.join('\n')}:::\n`;
}

/** Where a module block goes in a page: before its closing fence, a blank
 *  line before it; and where the caret goes (the first empty slot). */
export function moduleInsertion(markdown: string, page: PageSites, block: string): { at: number; insert: string; caret: number } {
  const at = page.closerStart;
  const before = markdown.slice(0, at);
  const lead = before.endsWith('\n\n') || at === page.openerEnd + 1 ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const insert = `${lead}${block}`;
  const firstSlot = block.indexOf('\n:::frame{');
  const caretIn = firstSlot >= 0 ? block.indexOf('\n', firstSlot + 1) + 1 : block.indexOf('\n') + 1;
  return { at, insert, caret: at + lead.length + caretIn };
}

/** The page template's modules group, or a new one (`added`): under the
 *  template's last frame, as wide as the area, to its foot. */
export function ensureModulesGroup(templates: Templates, pageTemplateId: string): { templates: PageTemplate[]; group: string; added: boolean } | null {
  const resolved = resolvePageTemplate({ pageTemplates: [...templates] }, pageTemplateId);
  if (!resolved || isModule(templateAt(templates, pageTemplateId)?.template)) return null;
  const own = resolved.groups.find((g) => g.modules);
  if (own) return { templates: [...templates], group: own.name, added: false };
  const name = uniqueName(namesInUse(templates, pageTemplateId), 'modules');
  const last = resolved.frames[resolved.frames.length - 1];
  const group: FrameGroupConfig = {
    name,
    modules: true,
    gap: mmDim(6),
    ...(last ? { placement: { anchor: { to: `#${last.name}`, edge: 'below' }, offset: { x: mmDim(0), y: mmDim(6) }, size: { width: 'fill', height: 'fill' } } } : {}),
  };
  return {
    templates: templates.map((t) => (t.id === pageTemplateId ? { ...t, groups: [...(t.groups ?? []), group] } : t)),
    group: name,
    added: true,
  };
}

/** The composed pages of a chapter: each fence's ordinal, template and
 *  range (fence to closing fence). */
export function chapterPages(markdown: string): { fence: number; template: string; start: number; end: number }[] {
  return templateFences(markdown).flatMap((f, fence) => {
    const sites = pageSites(markdown, f.fenceStart, markdown.length);
    return sites ? [{ fence, template: f.template, start: sites.start, end: sites.end }] : [];
  });
}

/** The ordinal of the page fence holding `offset`, or null. */
export function pageAtOffset(markdown: string, offset: number): number | null {
  return chapterPages(markdown).find((p) => offset >= p.start && offset <= p.end)?.fence ?? null;
}

export type InsertModulePlan =
  | {
    ok: true;
    templates?: PageTemplate[];
    chapters: { chapterId: string; changes: TextChange[]; baseLength: number }[];
    /** The page template and its modules group (`added`: made now). */
    pageTemplate: string;
    group: string;
    added: boolean;
    /** Where the caret goes in the chapter after the change. */
    caret: number;
  }
  | { ok: false; reason: 'noPage' | 'unknownModule' | 'pageTemplate' };

/** Module `moduleId` written into page fence `fence` (its ordinal in the
 *  chapter): a `:::module` block with an empty slot per frame before the
 *  page's closing fence; the page's template gets a modules group when it
 *  has none. */
export function planInsertModule(templates: Templates, chapter: { id: string; markdown: string }, fence: number, moduleId: string): InsertModulePlan {
  const mod = resolvePageTemplate({ pageTemplates: [...templates] }, moduleId);
  if (!mod || !isModule(templateAt(templates, moduleId)?.template)) return { ok: false, reason: 'unknownModule' };
  const f = templateFences(chapter.markdown)[fence];
  const sites = f ? pageSites(chapter.markdown, f.fenceStart, chapter.markdown.length) : null;
  if (!f || !sites) return { ok: false, reason: 'noPage' };
  const group = ensureModulesGroup(templates, f.template);
  if (!group) return { ok: false, reason: 'pageTemplate' };
  const ins = moduleInsertion(chapter.markdown, sites, moduleBlockText(mod));
  return {
    ok: true,
    ...(group.added ? { templates: group.templates } : {}),
    chapters: [{ chapterId: chapter.id, changes: [{ from: ins.at, to: ins.at, insert: ins.insert, expect: '' }], baseLength: chapter.markdown.length }],
    pageTemplate: f.template,
    group: group.group,
    added: group.added,
    caret: ins.caret,
  };
}

// ---------------------------------------------------------------------------
// «Extract a module»
// ---------------------------------------------------------------------------

export type ExtractRefusal = 'unknown' | 'inherited' | 'notLaid' | 'flow' | 'splitsGrid' | 'hasModules' | 'isModule' | 'empty';

export type ExtractNote =
  | { kind: 'leftGroup'; group: string }
  | { kind: 'refsToGroup'; frames: string[] }
  | { kind: 'variants' }
  | { kind: 'extended'; templates: string[] };

export type ExtractPlan =
  | {
    ok: true;
    templates: PageTemplate[];
    chapters: { chapterId: string; changes: TextChange[]; baseLength: number }[];
    module: string;
    group: string;
    frames: string[];
    /** Decoration elements moved into the module (ids). */
    decoration: string[];
    /** Groups moved into the module. */
    groups: string[];
    /** Frame name on the page before → after (`nota` → `caja[1].nota`). */
    names: Record<string, string>;
    pages: number;
    notes: ExtractNote[];
  }
  | { ok: false; reason: ExtractRefusal; frames?: string[] };

const unionOf = (rs: readonly Rect[]): Rect | null => {
  if (rs.length === 0) return null;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
};

const targetOf = (p: ElementPlacement | undefined): string | undefined => {
  const to = p?.anchor?.to;
  return typeof to === 'string' && to.startsWith('#') && to.length > 1 ? to.slice(1) : undefined;
};

/** `name[n]` → `name`; plain names as they are. */
const baseOf = (name: string): string => {
  const open = name.lastIndexOf('[');
  return open > 0 && name.endsWith(']') ? name.slice(0, open) : name;
};

const ABSOLUTE_UNITS = new Set(['mm', 'cm', 'in', 'pt', 'px']);
const absoluteMm = (d: { value: number; unit: string } | undefined): number | null => {
  if (!d) return 0;
  if (!ABSOLUTE_UNITS.has(d.unit)) return null;
  return d.unit === 'mm' ? d.value : d.unit === 'cm' ? d.value * 10 : d.unit === 'in' ? d.value * 25.4 : d.unit === 'pt' ? (d.value * 25.4) / 72 : (d.value * 25.4) / 96;
};

/** How far (page px) an element anchored by `edge` to box `from` must be
 *  shifted to stand where it stood once anchored to box `to` instead; null
 *  for the nine-point edges (inside the box), left as they are. */
export function edgeShift(edge: string, from: Rect, to: Rect): { x: number; y: number } | null {
  const left = from.x - to.x;
  const right = from.x + from.width - (to.x + to.width);
  const top = from.y - to.y;
  const bottom = from.y + from.height - (to.y + to.height);
  switch (edge) {
    case 'below': return { x: left, y: bottom };
    case 'above': return { x: left, y: top };
    case 'right-of': return { x: right, y: top };
    case 'left-of': return { x: left, y: top };
    case 'align-top': return { x: 0, y: top };
    case 'align-bottom': return { x: 0, y: bottom };
    case 'align-left': return { x: left, y: 0 };
    case 'align-right': return { x: right, y: 0 };
    default: return null;
  }
}

/** Move `frames` of template `templateId` into a new module `name`. */
export function planExtractModule(input: {
  templates: Templates;
  templateId: string;
  frames: readonly string[];
  name: string;
  laid: LaidTemplatePage;
  chapters: readonly { id: string; markdown: string }[];
}): ExtractPlan {
  const { templates, templateId, laid } = input;
  const at = templateAt(templates, templateId);
  if (!at) return { ok: false, reason: 'unknown' };
  const template = at.template;
  if (isModule(template)) return { ok: false, reason: 'isModule' };
  if ((template.groups ?? []).some((g) => g.modules)) return { ok: false, reason: 'hasModules' };
  const own = template.frames ?? [];
  if (input.frames.length === 0) return { ok: false, reason: 'empty' };
  const selected = new Set(input.frames);
  const missing = input.frames.filter((n) => !own.some((f) => f.name === n && !f.remove));
  if (missing.length > 0) {
    const known = namesInUse(templates, templateId);
    return { ok: false, reason: missing.some((n) => known.has(n)) ? 'inherited' : 'unknown', frames: missing };
  }
  const flow = own.filter((f) => selected.has(f.name) && (f.flow || f.takes));
  if (flow.length > 0) return { ok: false, reason: 'flow', frames: flow.map((f) => f.name) };

  // Each frame's laid boxes: its own, or its instances' (a grid's).
  const rectsOf = (name: string): Rect[] => {
    const r = laid.rects.get(name);
    if (r) return [r];
    return [...laid.rects].filter(([n]) => baseOf(n) === name && n !== name).map(([, v]) => v);
  };
  const unlaid = input.frames.filter((n) => rectsOf(n).length === 0);
  if (unlaid.length > 0) return { ok: false, reason: 'notLaid', frames: unlaid };

  // Groups: a grid moves whole or not at all; a stack or row all of whose
  // frames move goes along; one that keeps some loses the rest.
  const notes: ExtractNote[] = [];
  const movedGroups: FrameGroupConfig[] = [];
  const keptGroups: FrameGroupConfig[] = [];
  for (const g of template.groups ?? []) {
    const members = g.kind === 'grid' && g.repeat ? g.repeat.frames : g.frames ?? [];
    const inSel = members.filter((m) => selected.has(m));
    if (inSel.length === 0) {
      keptGroups.push(g);
      continue;
    }
    if (inSel.length === members.length) {
      movedGroups.push(g);
      continue;
    }
    if (g.kind === 'grid' && g.repeat) return { ok: false, reason: 'splitsGrid', frames: members.filter((m) => !selected.has(m)) };
    keptGroups.push({ ...g, frames: (g.frames ?? []).filter((m) => !selected.has(m)) });
    notes.push({ kind: 'leftGroup', group: g.name });
  }
  const inside = new Set([...input.frames, ...movedGroups.map((g) => g.name)]);

  const allRects = input.frames.flatMap(rectsOf);
  const box = unionOf(allRects)!;
  const mm = (v: number): number => pxToMm(v, laid.dpi);
  const corner = (r: Rect) => ({ x: mmDim(mm(r.x - box.x)), y: mmDim(mm(r.y - box.y)) });

  // The module's frames: anchored inside it as they were, else at their
  // place in the module's box.
  const frames: FrameConfig[] = own.filter((f) => selected.has(f.name)).map((f0) => {
    const f = clone(f0);
    const r = rectsOf(f.name)[0]!;
    const t = f.grid ? undefined : targetOf(f.placement);
    if (t === undefined || !inside.has(t)) {
      const size = f.placement?.size;
      f.placement = { anchor: { to: 'container', edge: 'top-left' }, offset: corner(r), ...(size ? { size } : {}) };
    }
    delete f.grid;
    const w = f.width;
    if (isRecord(w) && 'percent' in w) f.width = mmDim(mm(r.width));
    const h = f.height;
    if (h === 'fill' || (isRecord(h) && 'percent' in h)) f.height = mmDim(mm(r.height));
    return f;
  });
  const groups: FrameGroupConfig[] = movedGroups.map((g0) => {
    const g = clone(g0);
    const t = g.grid ? undefined : targetOf(g.placement);
    if (g.placement && (t === undefined || !inside.has(t))) {
      const members = g.kind === 'grid' && g.repeat ? g.repeat.frames : g.frames ?? [];
      const r = unionOf(members.flatMap(rectsOf));
      if (r) g.placement = { ...g.placement, anchor: { to: 'container', edge: 'top-left' }, offset: corner(r) };
    }
    delete g.grid;
    return g;
  });

  // Decoration hanging from what moves goes along (a connector when both
  // its ends do).
  const decoMoved: DesignElement[] = [];
  const decoKept: unknown[] = [];
  const hangsInside = (to: string | undefined): boolean => to !== undefined && inside.has(baseOf(to));
  for (const el of template.decoration?.elements ?? []) {
    const e = el as unknown as Record<string, unknown>;
    if (e.remove === true) {
      decoKept.push(el);
      continue;
    }
    let goes = false;
    if (e.kind === 'connector') {
      const ends = [e.from, ...(Array.isArray(e.to) ? e.to : [e.to])].map((c) => (isRecord(c) && typeof c.to === 'string' ? c.to.slice(1) : undefined));
      goes = ends.length > 0 && ends.every((n) => hangsInside(n));
    } else {
      goes = hangsInside(targetOf(e.placement as ElementPlacement | undefined));
    }
    if (goes) decoMoved.push(clone(el as DesignElement));
    else decoKept.push(el);
  }

  const id = uniqueName(templates.map((t) => t.id), slugify(input.name) || 'module');
  const moduleTemplate: PageTemplate = {
    id,
    ...(input.name && input.name !== id ? { name: input.name } : {}),
    role: 'module',
    frames,
    ...(groups.length > 0 ? { groups } : {}),
    ...(decoMoved.length > 0 ? { decoration: { elements: decoMoved } } : {}),
  };

  // The page template: the modules group where the frames stood.
  const groupName = uniqueName([...namesInUse(templates, templateId), ...inside], 'modules');
  const rest = own.filter((f) => !selected.has(f.name));
  const refsOut = rest.filter((f) => hangsInside(targetOf(f.placement)) || (f.next !== undefined && inside.has(f.next))).map((f) => f.name)
    .concat(keptGroups.filter((g) => hangsInside(targetOf(g.placement))).map((g) => g.name))
    .concat(decoKept.filter((e) => isRecord(e) && hangsInside(targetOf(e.placement as ElementPlacement | undefined))).map((e) => String((e as { id?: unknown }).id ?? '')));
  const topFrame = own.filter((f) => selected.has(f.name)).reduce<{ f: FrameConfig; r: Rect } | null>((best, f) => {
    const r = rectsOf(f.name)[0]!;
    return !best || r.y < best.r.y - 0.01 || (Math.abs(r.y - best.r.y) <= 0.01 && r.x < best.r.x) ? { f, r } : best;
  }, null)!;
  const placement = placementLike(topFrame.f, mm(box.x - topFrame.r.x), mm(box.y - topFrame.r.y), { x: mm(box.x - laid.area.x), y: mm(box.y - laid.area.y) }, inside);
  const modulesGroup: FrameGroupConfig = {
    name: groupName,
    modules: true,
    placement: { ...placement, size: { width: mmDim(mm(box.width)), height: refsOut.length > 0 ? mmDim(mm(box.height)) : 'fill' } },
  };
  if (refsOut.length > 0) notes.push({ kind: 'refsToGroup', frames: refsOut });
  const toGroup = (n: string): string | undefined => (inside.has(baseOf(n)) ? groupName : undefined);
  // What hung from a frame that moved hangs from the group's box, shifted
  // by as much as that frame's edge stood from the box's.
  const shifted = <T extends { placement?: ElementPlacement }>(item: T): T => {
    const t = targetOf(item.placement);
    if (t === undefined || !inside.has(baseOf(t)) || !item.placement) return item;
    const from = unionOf(rectsOf(baseOf(t))) ?? box;
    const d = edgeShift(item.placement.anchor.edge, from, box);
    if (!d) return item;
    const ox = absoluteMm(item.placement.offset?.x);
    const oy = absoluteMm(item.placement.offset?.y);
    if (ox === null || oy === null) return item;
    return { ...item, placement: { ...item.placement, offset: { x: mmDim(ox + mm(d.x)), y: mmDim(oy + mm(d.y)) } } };
  };
  const pagePatch = retargetPatch({
    frames: rest.map(shifted),
    groups: [...keptGroups.map(shifted), modulesGroup],
    ...(decoKept.length > 0 ? { decoration: { elements: (decoKept as { placement?: ElementPlacement }[]).map((e) => (isRecord(e) && e.placement ? shifted(e) : e)) as DesignElement[] } } : {}),
  }, toGroup);
  // A modules group's own anchor is not read through the rename.
  pagePatch.groups![pagePatch.groups!.length - 1] = modulesGroup;
  const nextPage: PageTemplate = { ...template, frames: pagePatch.frames!, groups: pagePatch.groups! };
  if (pagePatch.decoration) nextPage.decoration = pagePatch.decoration;
  else delete nextPage.decoration;
  if (template.variants) notes.push({ kind: 'variants' });
  const extended = templates.filter((t) => t.extends === templateId).map((t) => t.id);
  if (extended.length > 0) notes.push({ kind: 'extended', templates: extended });
  const out = [...templates.map((t) => (t.id === templateId ? nextPage : t))];
  out.splice(at.index + 1, 0, moduleTemplate);

  // The pages: the pieces of the frames that moved, in a `:::module` block
  // where the first of them stood (an empty block when the page wrote none,
  // so the module's frames are still laid).
  const instance = `${id}[1]`;
  const names: Record<string, string> = {};
  for (const [n] of laid.rects) if (inside.has(baseOf(n)) && selected.has(baseOf(n))) names[n] = `${instance}.${n}`;
  const chapters: { chapterId: string; changes: TextChange[]; baseLength: number }[] = [];
  let pages = 0;
  for (const ch of input.chapters) {
    const changes: TextChange[] = [];
    for (const page of pagesOfTemplates(ch.markdown, new Set([templateId]))) {
      const used: SlotSite[] = page.sites.sites.filter((s) => s.within === undefined && selected.has(s.slot));
      const body = used.map((s) => `${siteText(ch.markdown, s)}\n`).join('\n');
      changes.push(rewritePage(ch.markdown, page.sites, used, `:::module{template="${id}"}\n${body}:::\n`));
      pages++;
    }
    if (changes.length > 0) chapters.push({ chapterId: ch.id, changes, baseLength: ch.markdown.length });
  }

  return {
    ok: true,
    templates: out,
    chapters,
    module: id,
    group: groupName,
    frames: [...input.frames],
    decoration: decoMoved.map((e) => String((e as { id?: unknown }).id ?? '')),
    groups: movedGroups.map((g) => g.name),
    names,
    pages,
    notes,
  };
}
