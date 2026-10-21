/**
 * Content warnings of composed pages (#854, DESIGN §3.2, §5.7): a page
 * fence naming no template, a slot the template lacks, a template frame
 * that receives nothing, a fence and a template that disagree about
 * spreads (#861). Pure: read from the parsed pages and the
 * configuration, before any layout.
 */
import type { ContentWarning } from '../vdt';
import type { ContentBlock } from '../parse/types';
import { closestKey } from '../util/closestKey';
import { pageModuleUses, takenBlocks, type FrameTake, type ParsedComposedPage } from './document';
import type { ComposedPagesConfigKeys, FrameConfig, PageTemplate, ResolvedPageTemplate } from './types';
import { continueInPage, isModuleTemplate, resolveContinueIn, resolvePageTemplate } from './templates';
import { pageRepeats } from './repeat';

/** The composed-page warnings, as {@link checkComposedSlots} returns them
 *  (source offsets as in the pages it read). */
export type ComposedSlotWarning = Extract<ContentWarning, { kind: 'templateUnknown' | 'slotUnknown' | 'slotEmpty' | 'spreadMismatch' | 'repeatOverflow' | 'moduleUnknown' | 'moduleAsPage' | 'moduleNested' | 'moduleNameRejected' }>;

/**
 * The frames a template has: its own and, through `extends`, its
 * ancestors' (a child's frame of the same name overrides the parent's,
 * `remove: true` drops it). Cycles stop where they close.
 *
 * TODO(#853): use P2's template resolver once it lands, so `extends` and
 * `variants` merge in one place.
 */
function templateFrames(template: PageTemplate, byId: ReadonlyMap<string, PageTemplate>): FrameConfig[] {
  const chain: PageTemplate[] = [];
  const seen = new Set<string>();
  for (let t: PageTemplate | undefined = template; t && !seen.has(t.id); t = t.extends ? byId.get(t.extends) : undefined) {
    seen.add(t.id);
    chain.unshift(t);
  }
  const frames = new Map<string, FrameConfig>();
  for (const t of chain) {
    for (const f of t.frames ?? []) {
      if (!f || typeof f.name !== 'string') continue;
      if (f.remove) frames.delete(f.name);
      else frames.set(f.name, { ...frames.get(f.name), ...f });
    }
  }
  return [...frames.values()];
}

/** Whether a template is a spread: its own `spread`, else the nearest
 *  ancestor's through `extends` (the key is inherited). */
function templateSpread(template: PageTemplate, byId: ReadonlyMap<string, PageTemplate>): boolean {
  const seen = new Set<string>();
  for (let t: PageTemplate | undefined = template; t && !seen.has(t.id); t = t.extends ? byId.get(t.extends) : undefined) {
    seen.add(t.id);
    if (t.spread !== undefined) return t.spread === true;
  }
  return false;
}

/** Frame names only a variant (`variants.recto` / `verso`) adds: a slot may
 *  name them, and they are not reported empty. */
function variantFrameNames(template: PageTemplate): Set<string> {
  const out = new Set<string>();
  for (const v of [template.variants?.recto, template.variants?.verso]) {
    for (const f of v?.frames ?? []) if (f && typeof f.name === 'string' && !f.remove) out.add(f.name);
  }
  return out;
}

/**
 * `templateUnknown`, `slotUnknown` and `slotEmpty` for each page:
 *
 * - `templateUnknown`: `template="…"` names no `pageTemplates` id (or the
 *   fence names none). The page's slots are not checked.
 * - `slotUnknown`: content names a slot that is no frame of the template;
 *   it goes to the flow frame. Points at the first `slot="…"` value.
 * - `slotEmpty`: a frame receives nothing (no slot names it, it `takes` no
 *   heading of the page, and, for the flow frame, no content is left
 *   without a slot). Not raised for an `optional` frame, nor for a frame
 *   other frames continue into (`next`, `overflow.continueIn: '#x'`),
 *   which fills only when they overflow, nor for the frame of a later page
 *   that a story jumps to (`overflow.continueIn: 'page:<id>'`, #917).
 * - `spreadMismatch`: the fence's `spread` flag and the template's `spread`
 *   (inherited through `extends`) differ. The template decides: a spread
 *   template is laid over two facing pages, any other on one page. Points
 *   at the `spread` attribute, else the `template` value.
 */
export function checkComposedSlots(
  pages: readonly ParsedComposedPage[],
  config: Pick<ComposedPagesConfigKeys, 'pageTemplates'> | undefined,
): ComposedSlotWarning[] {
  const out: ComposedSlotWarning[] = [];
  if (pages.length === 0) return out;
  const byId = new Map<string, PageTemplate>();
  for (const t of Array.isArray(config?.pageTemplates) ? config!.pageTemplates : []) {
    if (t && typeof t.id === 'string' && !byId.has(t.id)) byId.set(t.id, t);
  }
  /** Whether frame `f` of `page` receives content of the page itself. */
  const filledOn = (page: ParsedComposedPage, frames: readonly FrameConfig[], f: FrameConfig): boolean => {
    const known = new Set(frames.map((x) => x.name));
    const taken = new Set<number>();
    for (const x of frames) {
      for (const idx of takenBlocks(page, x.takes)) taken.add(idx);
    }
    const stray = Object.keys(page.slots).some((slot) => !known.has(slot));
    const flowContent = stray || page.unassigned.some((i) => !taken.has(i));
    return page.slots[f.name] !== undefined
      || takenBlocks(page, f.takes).length > 0
      || (f.flow === true && flowContent);
  };
  // The frames later pages take jumping stories in (#917), by page: as
  // the layout picks them, the frame `#<frame>` names, else the frame of
  // the sending chain head's name, else the first frame left empty.
  const jumpedInto = new Map<number, Set<string>>();
  pages.forEach((page, at) => {
    const template = byId.get(page.template);
    if (!template) return;
    const frames = templateFrames(template, byId);
    const prev = new Map<string, string>();
    for (const f of frames) if (f.next && !prev.has(f.next)) prev.set(f.next, f.name);
    for (const f of frames) {
      const rule = f.overflow?.continueIn;
      const target = typeof rule === 'string' ? continueInPage(resolveContinueIn(rule, page.attrs as Record<string, string>)) : undefined;
      if (!target) continue;
      const k = pages.findIndex((p, i) => i > at && p.attrs.id === target.page);
      const to = k >= 0 ? pages[k]! : undefined;
      const toTemplate = to ? byId.get(to.template) : undefined;
      if (!to || !toTemplate) continue;
      const toFrames = templateFrames(toTemplate, byId);
      let head = f.name;
      for (const seen = new Set([head]); prev.has(head) && !seen.has(prev.get(head)!); ) { head = prev.get(head)!; seen.add(head); }
      const empty = toFrames.filter((x) => !filledOn(to, toFrames, x)).map((x) => x.name);
      const taken = jumpedInto.get(to.fenceIndex) ?? new Set<string>();
      const pick = [target.frame, head, f.name, ...empty].find((n) => n !== undefined && empty.includes(n) && !taken.has(n));
      if (pick !== undefined) taken.add(pick);
      jumpedInto.set(to.fenceIndex, taken);
    }
  });
  for (const page of pages) {
    const template = byId.get(page.template);
    if (!template) {
      const at = page.attrSources.template ?? page.fence;
      out.push({ kind: 'templateUnknown', template: page.template, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
      continue;
    }
    // A module (#1062) is laid in a page's modules group, never as a page:
    // the fence's content is set in the flow, as for an unknown template.
    if (isModuleTemplate(resolvePageTemplate(config as Pick<ComposedPagesConfigKeys, 'pageTemplates'>, template.id))) {
      const at = page.attrSources.template ?? page.fence;
      out.push({ kind: 'moduleAsPage', template: template.id, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
      continue;
    }
    // The template decides how the page is laid; the fence says so too.
    const spread = templateSpread(template, byId);
    if (spread !== page.spread) {
      const at = page.attrSources.spread ?? page.attrSources.template ?? page.fence;
      out.push({ kind: 'spreadMismatch', template: template.id, fenceIndex: page.fenceIndex, fence: page.spread, templateSpread: spread, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    const frames = templateFrames(template, byId);
    const known = new Set(frames.map((f) => f.name));
    const variants = variantFrameNames(template);
    // A grid's frames take the page's pieces item by item (#1061): a frame
    // of the set is filled when an item gives it content, and items past
    // the grid's `max` go to the flow frame.
    // With the page's modules laid in it (#1062).
    const resolved = resolvePageTemplate(config as Pick<ComposedPagesConfigKeys, 'pageTemplates'>, template.id, { modules: pageModuleUses(page) });
    const repeats = resolved ? pageRepeats(page, resolved) : undefined;
    const moduleChecks = checkModules(page, template.id, resolved, config as Pick<ComposedPagesConfigKeys, 'pageTemplates'>);
    out.push(...moduleChecks.warnings);
    const itemFilled = new Set<string>();
    for (const item of repeats?.items ?? []) for (const [f, indices] of item.frames) if (indices.length > 0) itemFilled.add(f);
    let strayContent = false;
    // The frame stray content goes to (#858: named in the warning).
    const flowFrame = frames.find((f) => f.flow === true && !repeats?.repeated.has(f.name))?.name;
    for (const o of repeats?.overflow ?? []) {
      strayContent = true;
      out.push({ kind: 'repeatOverflow', template: template.id, group: o.group, frame: o.frame, item: o.item, max: o.max, ...(flowFrame !== undefined ? { flowFrame } : {}), fenceIndex: page.fenceIndex, sourceStart: o.source.sourceStart, sourceEnd: o.source.sourceEnd });
    }
    for (const slot of Object.keys(page.slots)) {
      if (known.has(slot) || variants.has(slot) || moduleChecks.frames.has(slot)) continue;
      strayContent = true;
      // The content of a module not laid goes to the flow frame: its
      // `moduleUnknown` says so.
      if (moduleChecks.unlaid.some((name) => slot.startsWith(`${name}.`))) continue;
      const at = page.slotSources[slot] ?? page.fence;
      out.push({ kind: 'slotUnknown', template: template.id, slot, ...(flowFrame !== undefined ? { frame: flowFrame } : {}), fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    // Headings a `takes` frame receives leave the flow frame's share.
    const taken = new Set<number>();
    for (const f of frames) {
      for (const idx of takenBlocks(page, f.takes)) taken.add(idx);
    }
    const flowContent = strayContent || moduleChecks.toFlow || page.unassigned.some((i) => !taken.has(i));
    const continued = new Set<string>();
    for (const f of frames) {
      if (f.next) continued.add(f.next);
      const to = f.overflow?.continueIn;
      if (typeof to === 'string' && to.startsWith('#')) continued.add(to.slice(1));
    }
    for (const f of frames) {
      if (f.optional || continued.has(f.name) || jumpedInto.get(page.fenceIndex)?.has(f.name)) continue;
      const filled = repeats?.repeated.has(f.name)
        ? itemFilled.has(f.name)
        : page.slots[f.name] !== undefined
          || takenBlocks(page, f.takes).length > 0
          || (f.flow === true && flowContent);
      if (filled) continue;
      out.push({ kind: 'slotEmpty', template: template.id, frame: f.name, fenceIndex: page.fenceIndex, sourceStart: page.fence.sourceStart, sourceEnd: page.fence.sourceEnd });
    }
    // The frames of the modules laid (#1062), by their scoped names, at
    // their `:::module` fence.
    for (const m of resolved?.modules ?? []) {
      const parsed = page.modules.find((x) => x.fence.name === m.name);
      const moduleFrames = resolved!.frames.filter((f) => m.frames.includes(f.name));
      const into = new Set<string>();
      for (const f of moduleFrames) {
        if (f.next) into.add(f.next);
        const to = f.overflow.continueIn;
        if (typeof to === 'string' && to.startsWith('#')) into.add(to.slice(1));
      }
      const takenHere = new Map<number, string>();
      for (const [take, frame] of Object.entries(m.takes ?? {})) {
        for (const idx of takenBlocks({ firstHeadings: parsed?.firstHeadings ?? {}, tocRows: [] }, take as FrameTake)) if (!takenHere.has(idx)) takenHere.set(idx, frame);
      }
      const ownFlow = (parsed?.unassigned ?? []).some((i) => !takenHere.has(i));
      for (const f of moduleFrames) {
        if (f.optional || into.has(f.name)) continue;
        const filled = repeats?.repeated.has(f.name)
          ? itemFilled.has(f.name)
          : page.slots[f.name] !== undefined
            || [...takenHere.values()].includes(f.name)
            || (m.flow === f.name && ownFlow);
        if (filled) continue;
        const at = parsed?.fence ?? page.fence;
        out.push({ kind: 'slotEmpty', template: template.id, frame: f.name, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
      }
    }
  }
  return out;
}

/**
 * `lookUnknown` (#1089): each `:::frame` piece of a composed page whose
 * `look="…"` names no `frameLooks` entry (an empty value names none), at
 * the attribute's value, with the nearest id. `blocks` is the parsed
 * stream (source offsets as there).
 */
export function checkFrameLookNames(
  blocks: readonly ContentBlock[],
  config: Pick<ComposedPagesConfigKeys, 'frameLooks'> | undefined,
): Extract<ContentWarning, { kind: 'lookUnknown' }>[] {
  const out: Extract<ContentWarning, { kind: 'lookUnknown' }>[] = [];
  const ids = (Array.isArray(config?.frameLooks) ? config!.frameLooks : [])
    .map((l) => (l && typeof l.id === 'string' && l.id !== '' ? l.id : undefined))
    .filter((id): id is string => id !== undefined);
  const known = new Set(ids);
  /** The open page fences, innermost last (a page holds no page). */
  const pages: { id: number; template: string; fenceIndex: number }[] = [];
  for (const b of blocks) {
    if (b.type === 'containerStart' && b.containerName === 'composedPage' && b.composedPage) {
      pages.push({ id: b.containerId ?? -1, template: b.composedPage.template, fenceIndex: b.composedPage.fenceIndex });
      continue;
    }
    if (b.type === 'containerEnd' && pages.length > 0 && b.containerId === pages[pages.length - 1]!.id) {
      pages.pop();
      continue;
    }
    if (b.type !== 'containerStart' || b.containerName !== 'frame' || pages.length === 0) continue;
    const look = b.containerAttrs?.look?.trim();
    if (!look || known.has(look)) continue;
    const page = pages[pages.length - 1]!;
    const at = b.containerAttrSources?.look ?? b;
    const suggestion = closestKey(look, ids);
    out.push({
      kind: 'lookUnknown', template: page.template, frame: b.slot?.name ?? '', look, ...(suggestion ? { suggestion } : {}),
      fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd,
    });
  }
  return out;
}

/**
 * The modules of `page` (#1062): `moduleUnknown` for each `:::module` the
 * page does not lay (its template is unknown or no module, or the page's
 * template has no modules group), `moduleNameRejected` for a `name` it could
 * not take, `moduleNested` for a module inside a module. `frames`: the
 * scoped frames of the modules laid; `unlaid`: the names of the others,
 * whose content goes to the flow frame (`toFlow` when they hold any).
 */
function checkModules(
  page: ParsedComposedPage,
  templateId: string,
  resolved: ResolvedPageTemplate | undefined,
  config: Pick<ComposedPagesConfigKeys, 'pageTemplates'> | undefined,
): { warnings: ComposedSlotWarning[]; frames: Set<string>; unlaid: string[]; toFlow: boolean } {
  const warnings: ComposedSlotWarning[] = [];
  const frames = new Set<string>();
  for (const m of resolved?.modules ?? []) for (const f of m.frames) frames.add(f);
  const unlaid: string[] = [];
  let toFlow = false;
  const hasGroup = resolved?.groups.some((g) => g.modules) ?? false;
  for (const m of page.modules) {
    const fence = m.fence;
    if (fence.rejected) {
      const at = fence.attrSources.name ?? fence;
      warnings.push({ kind: 'moduleNameRejected', template: templateId, module: fence.template, name: fence.rejected.name, used: fence.name, reason: fence.rejected.reason, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    if (resolved?.modules?.some((x) => x.name === fence.name)) continue;
    unlaid.push(fence.name);
    if (m.end - m.start > 1) toFlow = true;
    const target = fence.template === '' ? undefined : resolvePageTemplate(config, fence.template);
    const reason = !target ? 'unknown' as const : !isModuleTemplate(target) ? 'notModule' as const : 'noGroup' as const;
    if (reason === 'noGroup' && hasGroup) continue;
    const at = fence.attrSources.template ?? fence;
    warnings.push({ kind: 'moduleUnknown', template: templateId, module: fence.template, name: fence.name, reason, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
  }
  for (const n of page.nestedModules) {
    const at = n.attrSources.template ?? n;
    warnings.push({ kind: 'moduleNested', template: templateId, module: n.template, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
  }
  return { warnings, frames, unlaid, toFlow };
}
