/**
 * Content warnings of composed pages (#854, DESIGN §3.2, §5.7): a page
 * fence naming no template, a slot the template lacks, a template frame
 * that receives nothing. Pure: read from the parsed pages and the
 * configuration, before any layout.
 */
import type { ContentWarning } from '../vdt';
import type { ParsedComposedPage } from './document';
import type { ComposedPagesConfigKeys, FrameConfig, PageTemplate } from './types';

/** The composed-page warnings, as {@link checkComposedSlots} returns them
 *  (source offsets as in the pages it read). */
export type ComposedSlotWarning = Extract<ContentWarning, { kind: 'templateUnknown' | 'slotUnknown' | 'slotEmpty' }>;

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
 *   which fills only when they overflow.
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
  for (const page of pages) {
    const template = byId.get(page.template);
    if (!template) {
      const at = page.attrSources.template ?? page.fence;
      out.push({ kind: 'templateUnknown', template: page.template, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
      continue;
    }
    const frames = templateFrames(template, byId);
    const known = new Set(frames.map((f) => f.name));
    const variants = variantFrameNames(template);
    let strayContent = false;
    for (const slot of Object.keys(page.slots)) {
      if (known.has(slot) || variants.has(slot)) continue;
      strayContent = true;
      const at = page.slotSources[slot] ?? page.fence;
      out.push({ kind: 'slotUnknown', template: template.id, slot, fenceIndex: page.fenceIndex, sourceStart: at.sourceStart, sourceEnd: at.sourceEnd });
    }
    // Headings a `takes` frame receives leave the flow frame's share.
    const taken = new Set<number>();
    for (const f of frames) {
      const idx = f.takes ? page.firstHeadings[f.takes] : undefined;
      if (idx !== undefined) taken.add(idx);
    }
    const flowContent = strayContent || page.unassigned.some((i) => !taken.has(i));
    const continued = new Set<string>();
    for (const f of frames) {
      if (f.next) continued.add(f.next);
      const to = f.overflow?.continueIn;
      if (typeof to === 'string' && to.startsWith('#')) continued.add(to.slice(1));
    }
    for (const f of frames) {
      if (f.optional || continued.has(f.name)) continue;
      const filled = page.slots[f.name] !== undefined
        || (f.takes !== undefined && page.firstHeadings[f.takes] !== undefined)
        || (f.flow === true && flowContent);
      if (filled) continue;
      out.push({ kind: 'slotEmpty', template: template.id, frame: f.name, fenceIndex: page.fenceIndex, sourceStart: page.fence.sourceStart, sourceEnd: page.fence.sourceEnd });
    }
  }
  return out;
}
