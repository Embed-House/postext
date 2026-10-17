/**
 * Content warnings of composed pages (#854, DESIGN §3.2, §5.7): a page
 * fence naming no template, a slot the template lacks, a template frame
 * that receives nothing, a fence and a template that disagree about
 * spreads (#861). Pure: read from the parsed pages and the
 * configuration, before any layout.
 */
import type { ContentWarning } from '../vdt';
import { takenBlocks, type ParsedComposedPage } from './document';
import type { ComposedPagesConfigKeys, FrameConfig, PageTemplate } from './types';
import { continueInPage, resolveContinueIn } from './templates';

/** The composed-page warnings, as {@link checkComposedSlots} returns them
 *  (source offsets as in the pages it read). */
export type ComposedSlotWarning = Extract<ContentWarning, { kind: 'templateUnknown' | 'slotUnknown' | 'slotEmpty' | 'spreadMismatch' }>;

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
    // The template decides how the page is laid; the fence says so too.
    const spread = templateSpread(template, byId);
    if (spread !== page.spread) {
      const at = page.attrSources.spread ?? page.attrSources.template ?? page.fence;
      out.push({ kind: 'spreadMismatch', template: template.id, fenceIndex: page.fenceIndex, fence: page.spread, templateSpread: spread, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    const frames = templateFrames(template, byId);
    const known = new Set(frames.map((f) => f.name));
    const variants = variantFrameNames(template);
    let strayContent = false;
    // The frame stray content goes to (#858: named in the warning).
    const flowFrame = frames.find((f) => f.flow === true)?.name;
    for (const slot of Object.keys(page.slots)) {
      if (known.has(slot) || variants.has(slot)) continue;
      strayContent = true;
      const at = page.slotSources[slot] ?? page.fence;
      out.push({ kind: 'slotUnknown', template: template.id, slot, ...(flowFrame !== undefined ? { frame: flowFrame } : {}), fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    // Headings a `takes` frame receives leave the flow frame's share.
    const taken = new Set<number>();
    for (const f of frames) {
      for (const idx of takenBlocks(page, f.takes)) taken.add(idx);
    }
    const flowContent = strayContent || page.unassigned.some((i) => !taken.has(i));
    const continued = new Set<string>();
    for (const f of frames) {
      if (f.next) continued.add(f.next);
      const to = f.overflow?.continueIn;
      if (typeof to === 'string' && to.startsWith('#')) continued.add(to.slice(1));
    }
    for (const f of frames) {
      if (f.optional || continued.has(f.name) || jumpedInto.get(page.fenceIndex)?.has(f.name)) continue;
      const filled = page.slots[f.name] !== undefined
        || takenBlocks(page, f.takes).length > 0
        || (f.flow === true && flowContent);
      if (filled) continue;
      out.push({ kind: 'slotEmpty', template: template.id, frame: f.name, fenceIndex: page.fenceIndex, sourceStart: page.fence.sourceStart, sourceEnd: page.fence.sourceEnd });
    }
  }
  return out;
}
